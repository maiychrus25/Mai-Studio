import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ASR_MODEL, SPEAKER_MODEL, ASR_MAX_PCM_BYTES, speechModelFiles, verifyAsrFile, validateSpeechParts, type SpeechTranscript } from './offline-asr';

type NativeStream = { acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void; inputFinished(): void };
type Recognizer = { createStream(): NativeStream; decode(stream: NativeStream): void; getResult(stream: NativeStream): { text: unknown } };
type Extractor = { createStream(): NativeStream; isReady(stream: NativeStream): boolean; compute(stream: NativeStream, enableExternalBuffer: boolean): Float32Array; dim: number };

// Official native API: https://github.com/k2-fsa/sherpa-onnx/blob/master/nodejs-addon-examples/test_asr_non_streaming_transducer.js
// Installed pinned 2.0.1 non-streaming-asr.js and speaker-identification.js. No Python/Numpy/frontend port.
async function recognize(input: unknown): Promise<{ text: string } | { embedding: number[] } | SpeechTranscript> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid ASR worker request');
  const request = input as Record<string, unknown>; const { root, jobId, mode } = request;
  if (Object.keys(request).some(k => !['root', 'jobId', 'mode', ...(mode === 'parts' ? ['parts'] : [])].includes(k)) || typeof root !== 'string' || !root || root.includes('\0') || Buffer.byteLength(root) > 4096 || resolve(root) !== root || typeof jobId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(jobId) || typeof mode !== 'string' || !['transcribe', 'embed', 'parts'].includes(mode)) throw new Error('Invalid ASR worker request');
  if (mode === 'parts') validateSpeechParts(request.parts);
  for (const [path, hash] of speechModelFiles(root, mode === 'embed' ? 'embed' : 'transcribe')) if (!verifyAsrFile(path, hash)) throw new Error('Offline speech model checksum mismatch');
  const jobs = join(root, 'asr-work'), work = join(jobs, jobId), pcm = join(work, 'audio.pcm');
  for (const dir of [jobs, work]) if (!lstatSync(dir).isDirectory()) throw new Error('Unsafe offline speech work directory');
  if (!lstatSync(pcm).isFile()) throw new Error('PCM input must be a regular file, not a symbolic link');
  const fd = openSync(pcm, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const size = fstatSync(fd).size;
    if (!size || size % 2 || size > ASR_MAX_PCM_BYTES || (mode === 'embed' && size < 25600)) throw new Error('Invalid offline speech PCM duration');
    const intervals = mode === 'parts' ? validateSpeechParts(request.parts, size / 32000) : [{ start: 0, end: size / 32000 }];
    const sherpa = require('sherpa-onnx-node') as { OfflineRecognizer: new (config: unknown) => Recognizer; SpeakerEmbeddingExtractor: new (config: unknown) => Extractor };
    const model = join(root, 'models', ASR_MODEL.name);
    const recognizer = mode !== 'embed' ? new sherpa.OfflineRecognizer({ featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig: { transducer: { encoder: join(model, 'encoder-epoch-12-avg-8.int8.onnx'), decoder: join(model, 'decoder-epoch-12-avg-8.onnx'), joiner: join(model, 'joiner-epoch-12-avg-8.int8.onnx') }, tokens: join(model, 'tokens.txt'), numThreads: 2, provider: 'cpu', debug: false }, decodingMethod: 'greedy_search' }) : undefined;
    const extractor = mode === 'embed' ? new sherpa.SpeakerEmbeddingExtractor({ model: join(root, 'models', 'voice-id', SPEAKER_MODEL.name), numThreads: 2, provider: 'cpu', debug: false }) : undefined;
    if (extractor && extractor.dim !== 256) throw new Error('Unexpected WeSpeaker embedding dimension');
    const chunkBytes = 20 * 16000 * 2;
    const buffer = Buffer.alloc(chunkBytes); const parts: string[] = []; let textBytes = 0;
    const pooled = new Float64Array(256); let pooledSamples = 0;
    function decode(samples: Float32Array, sampleCount: number): void {
      // Digital silence can produce native decoder hallucinations; this is not a speech/VAD classifier.
      if (!samples.some(value => value !== 0)) return;
      if (recognizer) {
        const padded = new Float32Array(samples.length + 4800); padded.set(samples);
        const stream = recognizer.createStream(); stream.acceptWaveform({ sampleRate: 16000, samples: padded }); recognizer.decode(stream);
        const result = recognizer.getResult(stream);
        if (typeof result.text !== 'string') throw new Error('Invalid native ASR result');
        const text = result.text.trim(); if (text) { textBytes += Buffer.byteLength(text) + 1; if (textBytes > 1024 * 1024) throw new Error('Offline ASR transcript exceeds 1 MiB'); parts.push(text); }
      } else if (extractor && sampleCount >= 12800) {
        const stream = extractor.createStream(); stream.acceptWaveform({ sampleRate: 16000, samples }); stream.inputFinished();
        if (!extractor.isReady(stream)) throw new Error('Speaker waveform is too short');
        // Electron forbids external ArrayBuffers; the official API's false option copies into V8 memory.
        const values = extractor.compute(stream, false);
        if (values.length !== 256 || !values.every(Number.isFinite)) throw new Error('Invalid native speaker embedding');
        for (let i = 0; i < 256; i++) pooled[i] += values[i] * sampleCount;
        pooledSamples += sampleCount;
      }
    }
    const segments: SpeechTranscript['segments'] = [];
    for (const interval of intervals) {
      const before = parts.length, end = Math.min(size, Math.ceil(interval.end * 16000) * 2);
      for (let offset = Math.floor(interval.start * 16000) * 2; offset < end;) {
        const needed = Math.min(buffer.length, end - offset); let bytes = 0;
        while (bytes < needed) { const n = readSync(fd, buffer, bytes, needed - bytes, offset + bytes); if (!n) throw new Error('PCM input changed while decoding'); bytes += n; }
        const samples = new Float32Array(bytes / 2);
        for (let i = 0; i < samples.length; i++) samples[i] = buffer.readInt16LE(i * 2) / 32768;
        decode(samples, samples.length); offset += bytes;
        await new Promise<void>(done => setImmediate(done)); (globalThis as typeof globalThis & { gc?: () => void }).gc?.();
      }
      if (mode === 'parts') { const text = parts.slice(before).join(' '); if (text) segments.push({ ...interval, text }); }
    }
    if (fstatSync(fd).size !== size) throw new Error('PCM input changed while decoding');
    if (recognizer) { const text = parts.join(' ').trim(); if (!text) throw new Error('Offline ASR recognized no speech; transcript is empty'); return mode === 'parts' ? { text, segments } : { text }; }
    const norm = Math.hypot(...pooled); if (!pooledSamples || !Number.isFinite(norm) || norm < 1e-12) throw new Error('Speaker model returned an empty embedding');
    return { embedding: Array.from(pooled, value => value / norm) };
  } finally { closeSync(fd); }
}

if (require.main === module) {
  let size = 0; const chunks: Buffer[] = [];
  const fail = (message: string) => { process.stdout.write(JSON.stringify({ error: message.slice(0, 4096) })); process.exitCode = 1; };
  process.stdin.on('data', (data: Buffer) => { size += data.length; if (size > 128 * 1024) { process.stdin.destroy(); fail('ASR worker request exceeds 128 KiB'); } else chunks.push(data); });
  process.stdin.on('end', () => {
    if (size > 128 * 1024) return;
    let input: unknown; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('Invalid ASR worker JSON request'); return; }
    void recognize(input).then(result => { process.stdout.write(JSON.stringify(result)); }).catch(error => fail(error instanceof Error ? error.message : 'Native offline speech failed'));
  });
}
