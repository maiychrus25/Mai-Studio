import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, createWriteStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { dirname, delimiter, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// speechcheck.pyc/voicematch.pyc recovered contract, /private/tmp/mai-studio-parity/asr-contract.json.
export const ASR_MODEL = Object.freeze({
  name: 'sherpa-onnx-zipformer-vi-int8-2025-04-20',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-zipformer-vi-int8-2025-04-20.tar.bz2',
  bytes: 60181038,
  files: Object.freeze({
    'encoder-epoch-12-avg-8.int8.onnx': 'b3abdef7a660fea7faf5e076b3c7613b0fc98406707103784d018189bb522124',
    'decoder-epoch-12-avg-8.onnx': 'd1d27cca84c824a8acf5ce6edf0f2c0880cfe295d2e69b95134de1707e1d9998',
    'joiner-epoch-12-avg-8.int8.onnx': '38ec49e1c18e4feb0cad4de13e25c83a866cf56f4a66f22e8ff579d591a69a46',
    'tokens.txt': 'f536d03c2e95ebd2930cf0abec88e823bd17d3c1933da7ae6a82db3b80605e15',
  }),
});
export const SPEAKER_MODEL = Object.freeze({
  name: 'wespeaker_en_voxceleb_resnet34.onnx', bytes: 26534365,
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34.onnx',
  sha256: '5ef208a9da1453335308a6b6f4e6dfbd7e183a38b604de0a57664f45d257fe94',
});
export const ASR_MAX_PCM_BYTES = 1800 * 16000 * 2;
const MAX_MODEL_BYTES = 80 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const preparing = new Set<string>();
let workerTail = Promise.resolve();
async function acquireWorker(signal?: AbortSignal): Promise<() => void> {
  signal?.throwIfAborted();
  let release!: () => void;
  const owned = new Promise<void>(resolve => { release = resolve; });
  const previous = workerTail; workerTail = previous.then(() => owned);
  let abort!: () => void;
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => reject(signal?.reason ?? new Error('Offline speech operation aborted'));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      void previous.then(resolve, reject);
    });
    signal?.throwIfAborted(); return release;
  } catch (error) { release(); throw error; }
  finally { signal?.removeEventListener('abort', abort); }
}
export type ModelProgress = (value: number, message: string) => void;
export type SpeechPart = { start: number; end: number };
export type SpeechTranscript = { text: string; segments: Array<SpeechPart & { text: string }> };

export function validateSpeechParts(input: unknown, duration = 1800): SpeechPart[] {
  if (!Array.isArray(input) || !input.length || input.length > 1000 || !Number.isFinite(duration) || duration <= 0 || duration > 1800) throw new Error('Speech parts require 1–1000 measured intervals within a valid duration');
  let previousEnd = 0;
  return input.map(part => {
    if (!part || typeof part !== 'object' || Array.isArray(part) || typeof part.start !== 'number' || typeof part.end !== 'number' || !Number.isFinite(part.start) || !Number.isFinite(part.end) || part.start < previousEnd || part.end <= part.start || part.end > duration) throw new Error('Speech part intervals must be finite, ordered, non-overlapping and within the actual audio duration');
    previousEnd = part.end; return { start: part.start, end: part.end };
  });
}

export function verifyAsrFile(path: string, expected: string): boolean {
  let fd: number | undefined;
  try {
    if (!/^[a-f0-9]{64}$/.test(expected) || !lstatSync(path).isFile()) return false;
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(fd);
    if (!info.isFile() || !info.size || info.size > MAX_MODEL_BYTES) return false;
    const buffer = Buffer.alloc(1024 * 1024); const hash = createHash('sha256'); let offset = 0;
    while (offset < info.size) {
      const n = readSync(fd, buffer, 0, Math.min(buffer.length, info.size - offset), offset);
      if (!n) return false;
      hash.update(buffer.subarray(0, n)); offset += n;
    }
    return fstatSync(fd).size === info.size && hash.digest('hex') === expected;
  } catch { return false; } finally { if (fd !== undefined) closeSync(fd); }
}
function directory(path: string): void {
  if (!lstatSync(path).isDirectory()) throw new Error('Offline model/work directory must not be a file or symbolic link');
}
export function speechModelFiles(root: string, mode?: 'transcribe' | 'embed'): Array<[string, string]> {
  directory(root); directory(join(root, 'models'));
  const files: Array<[string, string]> = [];
  if (mode !== 'embed') {
    const dir = join(root, 'models', ASR_MODEL.name); directory(dir);
    for (const [name, hash] of Object.entries(ASR_MODEL.files)) files.push([join(dir, name), hash]);
  }
  if (mode !== 'transcribe') { const dir = join(root, 'models', 'voice-id'); directory(dir); files.push([join(dir, SPEAKER_MODEL.name), SPEAKER_MODEL.sha256]); }
  return files;
}
async function ensureDirectory(path: string): Promise<void> {
  try { if (!(await lstat(path)).isDirectory()) throw new Error('Owned directory cannot be a symbolic link or file'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; await mkdir(path, { recursive: true, mode: 0o700 }); }
  directory(path);
}
function unpacked(path: string): string { return path.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2'); }
function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill('SIGKILL')); killer.unref();
  } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } }
}
async function processOutput(binary: string, args: string[], options: { signal?: AbortSignal; limit: number; output?: string; input?: string; env?: NodeJS.ProcessEnv; timeout?: number; allowFailure?: boolean }): Promise<{ data: Buffer; code: number | null }> {
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(options.timeout ?? 120000)]);
  signal.throwIfAborted();
  return new Promise((resolveProcess, reject) => {
    const child = spawn(binary, args, { shell: false, detached: process.platform !== 'win32', windowsHide: true, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let failure: Error | undefined; let size = 0, errorBytes = 0; const chunks: Buffer[] = [];
    const stop = (error: Error) => { failure ??= error; killTree(child); };
    const abort = () => stop(new Error('Offline speech operation aborted or timed out'));
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    child.on('error', () => { failure ??= new Error('Cannot start offline speech process; check FFmpeg/tar/native platform installation'); });
    child.stdin.on('error', () => {}); child.stdin.end(options.input);
    child.stderr.on('data', (data: Buffer) => { errorBytes += data.length; if (errorBytes > 65536) stop(new Error('Offline speech stderr exceeded 64 KiB')); });
    const limiter = new Transform({ transform(data: Buffer, _encoding, callback) {
      size += data.length;
      if (size > options.limit) callback(new Error('Offline speech output exceeds byte/duration limit'));
      else { if (!options.output) chunks.push(Buffer.from(data)); callback(null, options.output ? data : undefined); }
    } });
    const sink = options.output ? createWriteStream(options.output, { mode: 0o600, flags: 'wx' }) : new Transform({ transform(_data, _encoding, callback) { callback(); } });
    const copying = pipeline(child.stdout, limiter, sink, { signal }).catch(error => { stop(signal.aborted ? new Error('Offline speech operation aborted or timed out') : error as Error); });
    child.on('close', async code => {
      await copying; signal.removeEventListener('abort', abort); killTree(child);
      if (failure) reject(failure);
      else if (code !== 0 && !options.allowFailure) reject(new Error('Offline speech process failed; check media format/model archive'));
      else resolveProcess({ data: Buffer.concat(chunks), code });
    });
  });
}
async function download(url: string, path: string, bytes: number, signal: AbortSignal | undefined, progress: (fraction: number) => void): Promise<void> {
  const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(180000)]);
  const hosts = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com']);
  let response: Response | undefined;
  try {
    for (let redirects = 0; redirects < 4; redirects++) {
      response = await fetch(url, { signal: bounded, redirect: 'manual', headers: { Accept: 'application/octet-stream' } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location) throw new Error('Official model redirect has no location');
        const next = new URL(location, url);
        if (next.protocol !== 'https:' || !hosts.has(next.hostname) || next.username || next.password) throw new Error('Unsafe official model redirect host');
        url = next.href; response = undefined; continue;
      }
      break;
    }
    if (!response?.ok || !response.body) throw new Error(`Official model download HTTP ${response?.status ?? 'redirect limit'}`);
    const length = response.headers.get('content-length');
    if (length && (Number(length) > MAX_MODEL_BYTES || Number(length) !== bytes)) { await response.body.cancel(); throw new Error('Official model archive size differs from the pinned bytes'); }
    let received = 0, reported = -1;
    const limit = new Transform({ transform(data: Buffer, _encoding, callback) {
      received += data.length;
      if (received > Math.min(bytes, MAX_MODEL_BYTES)) callback(new Error('Official model download exceeds archive byte limit'));
      else { try { const fraction = received / bytes; if (fraction - reported >= 0.02 || received === bytes) { progress(fraction); reported = fraction; } callback(null, data); } catch (e) { callback(e as Error); } }
    } });
    await pipeline(Readable.fromWeb(response.body as never), limit, createWriteStream(path, { mode: 0o600, flags: 'wx' }), { signal: bounded });
    if (received !== bytes) throw new Error('Official model archive has incomplete bytes');
  } catch (e) {
    if (bounded.aborted) throw new Error('Model download aborted or timed out');
    if (e instanceof Error && /model|archive|redirect|HTTP|bytes/i.test(e.message)) throw e;
    throw new Error('Official model download failed; check network access');
  }
}

/** Same pinned Zipformer/WeSpeaker weights as the recovered contracts. Native Sherpa frontend,
 * 20-second chunk boundaries and speaker pooling are not a numeric-equivalence/identity guarantee.
 * ready() caches a validated stat fingerprint; each native worker hashes its required model again.
 * Packager must unpack this file, asr-worker.js, sherpa-onnx-node and its official platform package.
 */
export class OfflineAsr {
  private readonly root: string;
  private readonly ffmpegPath: string;
  private fingerprint = '';
  private validated = false;
  constructor(root: string, ffmpegPath?: string) {
    if (typeof root !== 'string' || !root.trim() || root.includes('\0') || Buffer.byteLength(root) > 4096) throw new Error('Invalid owned offline ASR root');
    this.root = resolve(root);
    this.ffmpegPath = ffmpegPath || unpacked(require('ffmpeg-static') as string);
  }
  ready(): boolean {
    try {
      const files = speechModelFiles(this.root);
      const fingerprint = files.map(([path]) => { const s = lstatSync(path); if (!s.isFile()) throw new Error('Unsafe model file'); return `${path}:${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`; }).join('|');
      if (fingerprint !== this.fingerprint) { this.validated = files.every(([path, hash]) => verifyAsrFile(path, hash)); this.fingerprint = fingerprint; }
      return this.validated;
    } catch { this.fingerprint = ''; this.validated = false; return false; }
  }
  async prepare(signal?: AbortSignal, progress?: ModelProgress): Promise<void> {
    signal?.throwIfAborted();
    if (this.ready()) { progress?.(1, 'Offline speech models already verified'); return; }
    if (preparing.has(this.root)) throw new Error('Offline model preparation is already active');
    preparing.add(this.root); let stage: string | undefined;
    try {
      await ensureDirectory(this.root); const models = join(this.root, 'models'); await ensureDirectory(models);
      for (const name of [ASR_MODEL.name, 'voice-id']) { try { directory(join(models, name)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
      stage = await mkdtemp(join(models, '.speech-')); const asr = join(stage, ASR_MODEL.name), speaker = join(stage, 'voice-id');
      await mkdir(asr, { mode: 0o700 }); await mkdir(speaker, { mode: 0o700 });
      const reusable = Object.entries(ASR_MODEL.files).every(([name, hash]) => verifyAsrFile(join(models, ASR_MODEL.name, name), hash));
      if (reusable) {
        for (const name of Object.keys(ASR_MODEL.files)) await copyFile(join(models, ASR_MODEL.name, name), join(asr, name), constants.COPYFILE_EXCL);
      } else {
        const archive = join(stage, 'model.tar.bz2.part');
        await download(ASR_MODEL.url, archive, ASR_MODEL.bytes, signal, value => progress?.(value * 0.55, 'Downloading Vietnamese Zipformer model'));
        for (const [index, [name, hash]] of Object.entries(ASR_MODEL.files).entries()) {
          const output = join(asr, name);
          await processOutput('tar', ['-xOjf', archive, `${ASR_MODEL.name}/${name}`], { signal, limit: MAX_MODEL_BYTES, output, timeout: 60000 });
          if (!verifyAsrFile(output, hash)) throw new Error('Offline ASR extracted model checksum mismatch');
          progress?.(0.55 + (index + 1) * 0.0375, 'Verifying Vietnamese model files');
        }
        await rm(archive);
      }
      const voice = join(speaker, SPEAKER_MODEL.name);
      if (verifyAsrFile(join(models, 'voice-id', SPEAKER_MODEL.name), SPEAKER_MODEL.sha256)) await copyFile(join(models, 'voice-id', SPEAKER_MODEL.name), voice, constants.COPYFILE_EXCL);
      else {
        await download(SPEAKER_MODEL.url, voice + '.part', SPEAKER_MODEL.bytes, signal, value => progress?.(0.7 + value * 0.29, 'Downloading WeSpeaker voice model'));
        await rename(voice + '.part', voice);
      }
      if (!verifyAsrFile(voice, SPEAKER_MODEL.sha256)) throw new Error('WeSpeaker model checksum mismatch');
      for (const [name, hash] of Object.entries(ASR_MODEL.files)) if (!verifyAsrFile(join(asr, name), hash)) throw new Error('Offline ASR model checksum mismatch');
      signal?.throwIfAborted();
      for (const name of [ASR_MODEL.name, 'voice-id']) {
        const target = join(models, name), previous = join(stage, 'previous-' + name); let displaced = false;
        try { await lstat(target); directory(target); await rename(target, previous); displaced = true; }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        try { await rename(join(stage, name), target); }
        catch (e) { if (displaced) await rename(previous, target); throw e; }
      }
      this.fingerprint = ''; if (!this.ready()) throw new Error('Offline speech model installation did not verify');
      progress?.(1, 'Offline Vietnamese ASR and speaker models verified');
    } finally { try { if (stage) await rm(stage, { recursive: true, force: true }); } finally { preparing.delete(this.root); } }
  }
  transcribe(filePath: string, signal?: AbortSignal): Promise<string> { return this.execute(filePath, 'transcribe', signal) as Promise<string>; }
  embed(filePath: string, signal?: AbortSignal): Promise<number[]> { return this.execute(filePath, 'embed', signal) as Promise<number[]>; }
  async transcribeParts(filePath: string, parts: SpeechPart[], signal?: AbortSignal): Promise<SpeechTranscript> {
    signal?.throwIfAborted();
    return this.execute(filePath, 'parts', signal, validateSpeechParts(parts)) as Promise<SpeechTranscript>;
  }
  private async execute(filePath: string, mode: 'transcribe' | 'embed' | 'parts', signal?: AbortSignal, parts?: SpeechPart[]): Promise<string | number[] | SpeechTranscript> {
    signal?.throwIfAborted();
    if (typeof filePath !== 'string' || !filePath.trim() || filePath.includes('\0')) throw new Error('Invalid audio file path');
    const input = resolve(filePath); const info = await lstat(input);
    if (!info.isFile() || !info.size || info.size > 4 * 1024 ** 3) throw new Error('Audio must be a non-empty regular file, not a symlink, at most 4 GiB');
    if (!this.ready()) throw new Error('Offline speech models unavailable; prepare and verify the models first');
    const release = await acquireWorker(signal);
    let work: string | undefined;
    try {
      signal?.throwIfAborted();
      const jobs = join(this.root, 'asr-work'); await ensureDirectory(jobs); const jobId = randomUUID(); work = join(jobs, jobId); await mkdir(work, { mode: 0o700 });
      const pcm = join(work, 'audio.pcm');
      await processOutput(this.ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', '-threads', '1', '-protocol_whitelist', 'file,pipe', '-i', input, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-t', '1800.001', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'], { signal, limit: ASR_MAX_PCM_BYTES, output: pcm });
      const size = (await stat(pcm)).size;
      if (!size || size % 2 || size > ASR_MAX_PCM_BYTES || (mode === 'embed' && size < 25600)) throw new Error('Invalid PCM duration; embedding needs at least 0.8s, audio maximum is 30 minutes');
      if (mode === 'parts') parts = validateSpeechParts(parts, size / 32000);
      let native: string, js: string;
      try {
        const platform = process.platform === 'win32' ? 'win' : process.platform;
        native = unpacked(dirname(require.resolve(`sherpa-onnx-${platform}-${process.arch}/package.json`)));
        js = unpacked(dirname(require.resolve('sherpa-onnx-node/package.json')));
      } catch { throw new Error('Install sherpa-onnx-node and the official native platform package'); }
      const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1', NODE_PATH: dirname(js), PATH: native + delimiter + (process.env.PATH || '') };
      for (const name of ['HOME', 'USERPROFILE', 'SYSTEMROOT', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP']) if (process.env[name]) env[name] = process.env[name];
      if (process.platform === 'darwin') env.DYLD_LIBRARY_PATH = native;
      if (process.platform === 'linux') env.LD_LIBRARY_PATH = native;
      const result = await processOutput(process.execPath, ['--expose-gc', '--max-old-space-size=256', unpacked(join(__dirname, 'asr-worker.js'))], { signal, limit: 3 * MAX_TEXT_BYTES, input: JSON.stringify({ root: this.root, jobId, mode, ...(parts ? { parts } : {}) }), env, timeout: 300000, allowFailure: true });
      let reply: Record<string, unknown>;
      try { reply = JSON.parse(result.data.toString('utf8')) as Record<string, unknown>; } catch { throw new Error('Invalid native offline speech response'); }
      if (!reply || result.code !== 0 || reply.error) throw new Error(typeof reply?.error === 'string' ? reply.error.slice(0, 4096) : 'Native offline speech worker failed');
      if (mode === 'transcribe') {
        if (typeof reply.text !== 'string' || !reply.text.trim() || Buffer.byteLength(reply.text) > MAX_TEXT_BYTES) throw new Error('Offline ASR returned empty or oversized text');
        return reply.text;
      }
      if (mode === 'parts') {
        if (typeof reply.text !== 'string' || !reply.text.trim() || Buffer.byteLength(reply.text) > MAX_TEXT_BYTES || !Array.isArray(reply.segments) || !reply.segments.length || reply.segments.length > 1000) throw new Error('Invalid native measured speech transcript');
        validateSpeechParts(reply.segments, size / 32000);
        let index = 0;
        for (const segment of reply.segments) {
          while (index < parts!.length && (parts![index].start !== segment.start || parts![index].end !== segment.end)) index++;
          if (index === parts!.length || typeof segment.text !== 'string' || !segment.text.trim()) throw new Error('Native speech segment does not match a provided measured interval');
          index++;
        }
        if (reply.segments.map(segment => segment.text).join(' ') !== reply.text) throw new Error('Native speech segments do not match the transcript');
        return reply as SpeechTranscript;
      }
      if (!Array.isArray(reply.embedding) || reply.embedding.length !== 256 || !reply.embedding.every(x => typeof x === 'number' && Number.isFinite(x))) throw new Error('Invalid native speaker embedding');
      const norm = Math.hypot(...reply.embedding as number[]); if (Math.abs(norm - 1) > 0.001) throw new Error('Invalid speaker embedding normalization');
      return reply.embedding as number[];
    } finally { try { if (work) await rm(work, { recursive: true, force: true }); } finally { release(); } }
  }
}
