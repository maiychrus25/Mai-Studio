import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, mkdtemp, writeFile, readFile, rm, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { TaskContext } from '../src/shared/studio';

const exec = promisify(execFile);
const ffmpegPath: string = process.env.TEST_FFMPEG_PATH || require('ffmpeg-static');
const ffprobePath = process.env.TEST_FFPROBE_PATH || 'ffprobe';
const api = () => require('../src/core/media') as typeof import('../src/core/media');
let root: string;
let silent: string;
let sound: string;
let audio: string;
let image: string;
let trimSource: string;
const options = { width: 160, height: 120, fps: 10 };
const context = (signal = AbortSignal.timeout(5000)): TaskContext => ({ signal, progress() {}, checkpoint() {} });
const tools = () => new (api().MediaTools)({ ffmpegPath, ffprobePath });
async function inspect(path: string) {
  return JSON.parse((await exec(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path])).stdout) as { streams: Array<{ codec_type: string; width?: number; height?: number; codec_name: string; channels?: number; sample_rate?: string }>; format: { duration: string; tags?: { title?: string } } };
}
async function rgbFrame(path: string, time: number) {
  return (await exec(ffmpegPath, ['-v', 'error', '-ss', String(time), '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer' })).stdout;
}
async function pcmAudio(path: string) {
  return (await exec(ffmpegPath, ['-v', 'error', '-i', path, '-map', '0:a:0', '-f', 'f32le', '-ac', '1', '-ar', '48000', 'pipe:1'], { encoding: 'buffer', maxBuffer: 8 * 1024 ** 2 })).stdout;
}
function pcmEnergy(pcm: Buffer, start: number, end: number): number {
  let sum = 0;
  const first = Math.round(start * 48000); const last = Math.round(end * 48000);
  for (let sample = first; sample < last; sample++) sum += Math.abs(pcm.readFloatLE(sample * 4));
  return sum / (last - first);
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'mai-media-tests-'));
  silent = join(root, 'im lặng $(touch nope).mp4');
  sound = join(root, 'âm thanh.mp4'); audio = join(root, 'giọng.wav'); image = join(root, 'ảnh.ppm');
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x120:r=10', '-t', '0.8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', silent]);
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=120x160:r=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '0.6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sound]);
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', '0.3', audio]);
  await writeFile(image, Buffer.concat([Buffer.from('P6\n16 16\n255\n'), Buffer.alloc(16 * 16 * 3, 150)]));
  trimSource = join(root, 'trim-source.mp4');
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x120:r=20:d=0.4[r];color=c=blue:s=160x120:r=20:d=0.4[b];[r][b]concat=n=2:v=1:a=0', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=0.4', '-af', 'adelay=400:all=1', '-t', '0.8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', trimSource]);
});
after(async () => { if (root) await rm(root, { recursive: true, force: true }); });

test('default bundled FFmpeg runs from app.asar.unpacked while dev and configured paths stay unchanged', async () => {
  const resources = join(root, 'Mai Studio Việt.app', 'Contents', 'Resources');
  const bundled = join(resources, 'app.asar', 'node_modules', 'ffmpeg-static', 'ffmpeg');
  const unpacked = join(resources, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg');
  await mkdir(join(resources, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static'), { recursive: true });
  await writeFile(join(resources, 'app.asar'), 'archive fixture');
  await symlink(ffmpegPath, unpacked);
  const configured = join(root, 'custom', 'app.asar', 'ffmpeg');
  const lookalike = join(root, 'app.asar-tools', 'ffmpeg');
  await mkdir(join(root, 'custom', 'app.asar'), { recursive: true });
  await mkdir(join(root, 'app.asar-tools'), { recursive: true });
  await symlink(ffmpegPath, configured); await symlink(ffmpegPath, lookalike);
  const cached = require.cache[require.resolve('ffmpeg-static')]!;
  const saved = cached.exports;
  try {
    const { MediaTools } = api();
    for (const [index, path] of [bundled, ffmpegPath, unpacked, lookalike].entries()) {
      cached.exports = path;
      const media = new MediaTools({ ffprobePath });
      cached.exports = saved;
      assert.equal(media.executablePath, index === 0 ? unpacked : path);
      const output = join(root, `bundled-path-${index}.mp4`);
      await media.slideshow([{ path: image, duration: 0.2 }], output, { width: 64, height: 64, fps: 10 }, context());
      assert.equal((await media.probe(output)).width, 64);
    }
    cached.exports = bundled;
    const media = new MediaTools({ ffmpegPath: configured, ffprobePath });
    cached.exports = saved;
    assert.equal(media.executablePath, configured);
    const output = join(root, 'configured-path.mp4');
    await media.slideshow([{ path: image, duration: 0.2 }], output, { width: 64, height: 64, fps: 10 }, context());
    assert.equal((await media.probe(output)).width, 64);
  } finally { cached.exports = saved; }
});

test('SRT round trips Unicode, BOM, CRLF and decimal times without losing cue indexes', () => {
  const cues = api().parseSrt('\uFEFF2\r\n00:00:01,250 --> 00:00:03,750\r\nChào anh!\r\nDòng hai.\r\n\r\n5\r\n00:01:00,000 --> 00:01:01,001\r\nKết thúc.\r\n');
  assert.deepEqual(cues, [{ index: 2, start: 1.25, end: 3.75, text: 'Chào anh!\nDòng hai.' }, { index: 5, start: 60, end: 61.001, text: 'Kết thúc.' }]);
  assert.deepEqual(api().parseSrt(api().formatSrt(cues)), cues);
  assert.match(api().formatSrt([{ index: 1, start: 59.9996, end: 60.2, text: 'x' }]), /00:01:00,000 --> 00:01:00,200/);
  assert.throws(() => api().formatSrt([{ index: 1, start: 0, end: 1, text: 'ế'.repeat(12000) }]), /cue text|limit/i);
});

test('SRT rejects malformed, reversed, overlapping, duplicate and non-finite cues', () => {
  for (const text of ['', 'hello', '1\n00:61:00,000 --> 00:62:00,000\nx', '1\n00:00:02,000 --> 00:00:01,000\nx', '1\n00:00:00,000 --> 00:00:01,000\n', '1\n00:00:00,000 --> 00:00:02,000\nx\n\n2\n00:00:01,000 --> 00:00:03,000\ny']) assert.throws(() => api().parseSrt(text), /SRT|cue|time|empty/i);
  for (const cues of [[{ index: 1, start: NaN, end: 1, text: 'x' }], [{ index: 1, start: 0, end: Infinity, text: 'x' }], [{ index: 1, start: 0, end: 1, text: 'x' }, { index: 1, start: 2, end: 3, text: 'y' }]]) assert.throws(() => api().formatSrt(cues), /cue|time|index/i);
});

test('probe reads actual streams and falls back to real ffmpeg metadata if ffprobe is missing', async () => {
  assert.deepEqual(await tools().probe(silent), { duration: 0.8, width: 160, height: 120, hasAudio: false });
  const wav = await tools().probe(audio);
  assert.equal(wav.hasAudio, true); assert.ok(Math.abs(wav.duration - 0.3) < 0.03); assert.equal(wav.width, undefined);
  const fallback = new (api().MediaTools)({ ffmpegPath, ffprobePath: join(root, 'missing-ffprobe') });
  assert.deepEqual(await fallback.probe(silent), { duration: 0.8, width: 160, height: 120, hasAudio: false });
  await assert.rejects(tools().probe(root), /regular|file/i);
  await assert.rejects(tools().probe(join(root, 'missing')), /exist|ENOENT|file/i);
});

test('fallback probe classifies malformed media metadata as invalid and preserves ffprobe guidance', async () => {
  const malformed = join(root, 'fallback-malformed.mp4');
  await writeFile(malformed, 'not valid media');
  const fallback = new (api().MediaTools)({ ffmpegPath, ffprobePath: join(root, 'absent-ffprobe') });
  const invalidMetadata = (error: unknown) => error instanceof Error && /Invalid media metadata/i.test(error.message) && /ffprobePath/i.test(error.message);
  await assert.rejects(fallback.probe(malformed), invalidMetadata);
  const output = join(root, 'fallback-preserved.mp4');
  await writeFile(output, 'previous');
  await assert.rejects(fallback.merge([{ path: malformed }], output, options, context()), invalidMetadata);
  assert.equal(await readFile(output, 'utf8'), 'previous');
});

test('merge normalizes sizes and frame rates, pads silent clips and can discard source audio', async () => {
  const output = join(root, 'merged.mp4');
  const progress: number[] = [];
  await tools().merge([{ path: silent }, { path: sound }], output, { ...options, title: 'Phim Việt' }, { ...context(), progress: v => progress.push(v) });
  const result = await inspect(output);
  assert.equal(result.streams.find(s => s.codec_type === 'video')?.width, 160);
  assert.equal(result.streams.find(s => s.codec_type === 'video')?.height, 120);
  assert.equal(result.streams.find(s => s.codec_type === 'audio')?.codec_name, 'aac');
  assert.ok(Math.abs(Number(result.format.duration) - 1.4) < 0.15);
  assert.equal(result.format.tags?.title, 'Phim Việt'); assert.equal(progress.at(-1), 1);
  assert.ok(progress.every(value => value >= 0 && value <= 1));
  const muted = join(root, 'muted.mp4');
  await tools().merge([{ path: sound, duration: 0.3 }], muted, { ...options, keepAudio: false }, context());
  assert.equal((await tools().probe(muted)).hasAudio, false);
});

test('slideshow uses numeric durations, music mixing and safely handles subtitle filter punctuation', { timeout: 10000 }, async () => {
  const subtitle = join(root, "phụ đề ' : [,];\\.srt");
  await writeFile(subtitle, '1\n00:00:00,000 --> 00:00:00,800\nXin chào anh!\n');
  const output = join(root, 'slides.mp4');
  await tools().slideshow([{ path: image, duration: 0.4 }, { path: image, duration: 0.5 }], output, { ...options, musicPath: audio, volume: 0.2, subtitlePath: subtitle }, context());
  const result = await tools().probe(output);
  assert.ok(Math.abs(result.duration - 0.9) < 0.15); assert.equal(result.hasAudio, true);
  const plain = join(root, 'slides-silent.mp4');
  await tools().slideshow([{ path: image, duration: 0.3 }], plain, options, context());
  assert.equal((await tools().probe(plain)).hasAudio, false);
  const frame = async (path: string) => (await exec(ffmpegPath, ['-v', 'error', '-ss', '0.1', '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer' })).stdout;
  assert.notDeepEqual(await frame(output), await frame(plain));
});

test('PNG overlay replaces red source pixels and keeps merge, slideshow, dub and music input indexes correct', async () => {
  const overlayPath = join(root, 'blue overlay.png');
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120', '-frames:v', '1', '-c:v', 'png', overlayPath]);
  const cases = [
    { name: 'silent', hasAudio: false, render: (output: string) => tools().merge([{ path: silent }], output, { ...options, overlayPath }, context()) },
    { name: 'music', hasAudio: true, render: (output: string) => tools().merge([{ path: silent }, { path: sound }], output, { ...options, overlayPath, musicPath: audio, volume: 0.2 }, context()) },
    { name: 'slides', hasAudio: true, render: (output: string) => tools().slideshow([{ path: image, duration: 0.5 }], output, { ...options, overlayPath, musicPath: audio }, context()) },
    { name: 'dub', hasAudio: true, render: (output: string) => tools().dub(silent, [{ path: audio, start: 0.1, duration: 0.2 }], output, { ...options, overlayPath, musicPath: audio }, context()) }
  ];
  for (const entry of cases) {
    const output = join(root, `overlay-${entry.name}.mp4`);
    await entry.render(output);
    assert.equal((await tools().probe(output)).hasAudio, entry.hasAudio);
    const pixels = (await exec(ffmpegPath, ['-v', 'error', '-ss', '0.3', '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer' })).stdout;
    assert.equal(pixels.length, 160 * 120 * 3);
    let red = 0; let green = 0; let blue = 0;
    for (let i = 0; i < pixels.length; i += 3) { red += pixels[i]; green += pixels[i + 1]; blue += pixels[i + 2]; }
    const count = pixels.length / 3;
    assert.ok(red / count < 20 && green / count < 20 && blue / count > 200, `${entry.name}: output must show the blue PNG overlay`);
    if (entry.hasAudio) {
      const pcm = (await exec(ffmpegPath, ['-v', 'error', '-i', output, '-map', '0:a:0', '-f', 'f32le', '-ac', '1', '-ar', '48000', 'pipe:1'], { encoding: 'buffer' })).stdout;
      let energy = 0;
      for (let i = 0; i < pcm.length; i += 4) energy += Math.abs(pcm.readFloatLE(i));
      assert.ok(energy / (pcm.length / 4) > 0.005, `${entry.name}: audio must remain audible`);
    }
  }
});

test('invalid PNG overlay paths and video masquerading as an overlay preserve existing output', async () => {
  const output = join(root, 'overlay-preserved.mp4');
  const malformed = join(root, 'invalid-overlay.png');
  await writeFile(malformed, 'not a PNG'); await writeFile(output, 'previous');
  for (const overlayPath of [join(root, 'absent-overlay.png'), root, malformed, silent]) {
    await assert.rejects(tools().merge([{ path: silent }], output, { ...options, overlayPath }, context()), /file|ENOENT|invalid|PNG|Media process/i);
    assert.equal(await readFile(output, 'utf8'), 'previous');
  }
  await assert.rejects(tools().merge([{ path: silent }], output, { ...options, overlayPath: output }, context()), /overlay|overwrite/i);
  assert.equal(await readFile(output, 'utf8'), 'previous');
});

test('cancellation while rendering with a PNG overlay preserves the previous output', { timeout: 10000 }, async () => {
  const overlayPath = join(root, 'cancel-overlay.png');
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120', '-frames:v', '1', '-c:v', 'png', overlayPath]);
  const output = join(root, 'cancel-overlay.mp4'); await writeFile(output, 'previous');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await assert.rejects(tools().slideshow([{ path: image, duration: 3600 }], output, { ...options, fps: 60, overlayPath, musicPath: audio }, {
      ...context(controller.signal), progress(value) { if (value === 0) timer = setTimeout(() => controller.abort(), 25); }
    }), /abort|cancel/i);
  } finally { if (timer) clearTimeout(timer); }
  assert.equal(await readFile(output, 'utf8'), 'previous');
});

test('dub places audio at its timestamp, trims it and pads to video end', async () => {
  const output = join(root, 'dubbed.mp4');
  await tools().dub(silent, [{ path: audio, start: 0.2, duration: 0.2 }], output, { ...options, keepAudio: false }, context());
  const result = await tools().probe(output);
  assert.ok(Math.abs(result.duration - 0.8) < 0.1); assert.equal(result.hasAudio, true);
  const pcm = (await exec(ffmpegPath, ['-v', 'error', '-i', output, '-map', '0:a', '-f', 'f32le', '-ac', '1', '-ar', '48000', 'pipe:1'], { encoding: 'buffer' })).stdout;
  const energy = (start: number, end: number) => {
    let sum = 0; for (let i = start * 48000; i < end * 48000; i++) sum += Math.abs(pcm.readFloatLE(i * 4));
    return sum / ((end - start) * 48000);
  };
  assert.ok(energy(0.02, 0.1) < 0.005); assert.ok(energy(0.23, 0.35) > 0.01); assert.ok(energy(0.5, 0.7) < 0.005);
});

test('voice fit retains the distinct final sound, pitch, slot offset and video duration while false keeps legacy trimming', async () => {
  const video = join(root, 'fit-video.mp4'); const voice = join(root, 'fit-voice.wav');
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x120:r=10:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=0.2*sin(2*PI*if(lt(t\\,2.01)\\,440\\,1760)*t):s=48000:d=2.2', voice]);
  const fitted = join(root, 'fit-result.mp4'); const legacy = join(root, 'fit-legacy.mp4'); const disabled = join(root, 'fit-disabled.mp4');
  const input = [{ path: voice, start: 0.4, duration: 2 }];
  await tools().dub(video, input, fitted, { ...options, keepAudio: false, fitVoice: true }, context());
  await tools().dub(video, input, legacy, { ...options, keepAudio: false }, context());
  await tools().dub(video, input, disabled, { ...options, keepAudio: false, fitVoice: false }, context());
  const pcm = await pcmAudio(fitted); const trimmed = await pcmAudio(legacy);
  const amplitude = (data: Buffer, frequency: number, start: number, end: number) => {
    let real = 0; let imaginary = 0; const first = Math.round(start * 48000); const last = Math.round(end * 48000);
    for (let i = first; i < last; i++) { const value = data.readFloatLE(i * 4); const angle = 2 * Math.PI * frequency * i / 48000; real += value * Math.cos(angle); imaginary += value * Math.sin(angle); }
    return 2 * Math.hypot(real, imaginary) / (last - first);
  };
  assert.ok(amplitude(pcm, 1760, 2.29, 2.35) > 0.08, 'final source segment beyond the old trim boundary must survive at its original pitch');
  assert.ok(amplitude(trimmed, 1760, 2.29, 2.35) < 0.005, 'legacy trim loses this final segment');
  assert.ok(amplitude(pcm, 440, 0.55, 0.7) > 0.08);
  assert.ok(pcmEnergy(pcm, 0.1, 0.3) < 0.002); assert.ok(pcmEnergy(pcm, 2.5, 2.8) < 0.002);
  assert.ok(Math.abs((await tools().probe(fitted)).duration - 3) < 0.03);
  assert.deepEqual(await pcmAudio(disabled), trimmed, 'explicit false must preserve the exact legacy samples');
});

test('voice fit uses recovered tempo bounds, pads short voices, and rejects invalid flags or unfit rates atomically', async () => {
  // Isolated original dubalign.align: dt/dp=1.1 -> 1.1; 0.5 -> 0.85; 1.2 -> 1.15.
  // Local slot policy rejects the last case rather than clipping the overlong result after clamping.
  const recorded = await recordedMerge('fit-bounds-ffmpeg'); const output = join(root, 'fit-bounds.mp4');
  await recorded.media.dub(silent, [{ path: audio, start: 0.1, duration: 0.6 }], output, { ...options, keepAudio: false, fitVoice: true }, context());
  const calls = await recorded.calls(); const args = calls.find(call => call.includes('-af'))!;
  assert.ok(args); assert.match(args[args.indexOf('-af') + 1], /atempo=0\.85(?:0*\b)?/);
  const pcm = await pcmAudio(output); assert.ok(pcmEnergy(pcm, 0.12, 0.3) > 0.01); assert.ok(pcmEnergy(pcm, 0.55, 0.7) < 0.005);
  await writeFile(output, 'previous');
  for (const flag of ['true', 1, null]) await assert.rejects(tools().dub(silent, [{ path: audio, start: 0.1, duration: 0.6 }], output, { ...options, fitVoice: flag as never }, context()), /fitVoice|boolean/i);
  for (const duration of [0.2, 0, NaN, Infinity]) await assert.rejects(tools().dub(silent, [{ path: audio, start: 0.1, duration }], output, { ...options, fitVoice: true }, context()), /tempo|duration|fit/i);
  assert.equal(await readFile(output, 'utf8'), 'previous');
  const preaborted = new AbortController(); preaborted.abort();
  await assert.rejects(tools().dub(silent, [{ path: audio, start: 0.1 }], output, { ...options, fitVoice: true }, context(preaborted.signal)), /abort|cancel/i);
  for (const stage of ['Rendering fitted voice', 'Rendering CPU media', 'Publishing rendered media']) {
    const controller = new AbortController();
    await assert.rejects(recorded.media.dub(silent, [{ path: audio, start: 0.1, duration: 0.6 }], output, { ...options, fitVoice: true }, { ...context(controller.signal), progress(_value, message) { if (message === stage) controller.abort(); } }), /abort|cancel/i);
    assert.equal(await readFile(output, 'utf8'), 'previous');
  }
  const failed = await recordedMerge('fit-failure-ffmpeg', true);
  await assert.rejects(failed.media.dub(silent, [{ path: audio, start: 0.1, duration: 0.6 }], output, { ...options, fitVoice: true }, context()), /Media process exited 9/);
  assert.equal(await readFile(output, 'utf8'), 'previous');
  for (const call of [...await recorded.calls(), ...await failed.calls()]) if (call.includes('-af') || call.includes('-filter_complex')) {
    await assert.rejects(readFile(call.at(-1)!), /ENOENT/, 'fitted WAV and render intermediates must be removed');
    await assert.rejects(readdir(join(call.at(-1)!, '..')), /ENOENT/);
  }
  assert.equal((await readdir(root)).some(name => name.startsWith('.mai-')), false);
});

test('validation and failed encodes preserve an existing output and reject unbounded input', async () => {
  const output = join(root, 'preserve.mp4'); await writeFile(output, 'original');
  for (const opts of [{ width: 161 }, { fps: Infinity }, { volume: NaN }, { height: 100000 }]) await assert.rejects(tools().merge([{ path: silent }], output, opts, context()), /invalid|width|height|fps|volume/i);
  for (const inputs of [[], [{ path: silent, duration: 0 }], [{ path: silent, duration: NaN }], [{ path: silent, duration: 999999 }], Array.from({ length: 1003 }, () => ({ path: silent }))]) await assert.rejects(tools().merge(inputs, output, options, context()), /input|duration|limit/i);
  await assert.rejects(tools().dub(silent, [{ path: audio, start: -1 }], output, options, context()), /start|invalid/i);
  await assert.rejects(tools().dub(silent, [{ path: audio, start: 1 }], output, options, context()), /duration|start|timeline/i);
  await assert.rejects(tools().merge([{ path: audio }], output, options, context()), /video/i);
  await assert.rejects(new (api().MediaTools)({ ffmpegPath: join(root, 'missing-ffmpeg'), ffprobePath }).merge([{ path: silent }], output, options, context()), /ffmpeg|ENOENT/i);
  await assert.rejects(tools().merge([{ path: silent }], output, { ...options, subtitlePath: join(root, 'missing.srt') }, context()), /file|ENOENT|exist/i);
  assert.equal(await readFile(output, 'utf8'), 'original');
  assert.equal((await readdir(root)).some(p => p.startsWith('.mai-')), false);
});

test('cancellation terminates an active render and leaves output intact', { timeout: 15000 }, async () => {
  const output = join(root, 'cancel.mp4'); await writeFile(output, 'keep');
  const controller = new AbortController();
  const operation = tools().slideshow([{ path: image, duration: 3600 }], output, { width: 1920, height: 1080, fps: 30 }, context(controller.signal));
  const timer = setTimeout(() => controller.abort(), 150);
  const started = Date.now();
  try { await assert.rejects(operation, /abort|cancel/i); } finally { clearTimeout(timer); }
  assert.ok(Date.now() - started < 5000); assert.equal(await readFile(output, 'utf8'), 'keep');
  await assert.rejects(tools().probe(silent, controller.signal), /abort|cancel/i);
});

test('process concurrency is bounded across instances and cancellation kills stubborn children', { timeout: 10000 }, async t => {
  const binary = join(root, 'controlled-probe');
  const pids = join(root, 'pids');
  await writeFile(binary, `#!${process.execPath}\nconst fs = require('node:fs'); process.on('SIGTERM', () => {}); setTimeout(() => fs.appendFileSync(${JSON.stringify(pids)}, process.pid + '\\n'), 1200); setInterval(() => {}, 1000);\n`, { mode: 0o700 });
  const controllers = Array.from({ length: 3 }, () => new AbortController());
  const jobs = controllers.map(controller => new (api().MediaTools)({ ffmpegPath, ffprobePath: binary }).probe(silent, controller.signal).then(() => 'unexpected success', error => String(error)));
  try {
    let ids: number[] = [];
    while (ids.length < 2) {
      ids = await readFile(pids, 'utf8').then(s => s.trim().split('\n').map(Number), () => []);
      if (ids.length >= 2) break;
      await delay(10, undefined, { signal: t.signal });
    }
    assert.equal(ids.length, 2);
    controllers[2].abort();
    assert.match(await jobs[2], /abort|cancel/i);
    controllers[0].abort(); controllers[1].abort();
    for (const result of await Promise.all(jobs)) assert.match(result, /abort|cancel/i);
    for (const pid of ids) assert.throws(() => process.kill(pid, 0), /ESRCH/);
    assert.equal((await readFile(pids, 'utf8')).trim().split('\n').length, 2);
  } finally { for (const controller of controllers) controller.abort(); await Promise.all(jobs); }
});

test('a noisy process is stopped at the capture bound and malformed media does not publish', { timeout: 10000 }, async () => {
  const binary = join(root, 'noisy-probe');
  await writeFile(binary, `#!${process.execPath}\nprocess.stdout.write('x'.repeat(2 * 1024 * 1024)); setInterval(() => {}, 1000);\n`, { mode: 0o700 });
  await assert.rejects(new (api().MediaTools)({ ffmpegPath, ffprobePath: binary }).probe(silent), /output limit/i);
  const invalid = join(root, 'not-video.mp4'); await writeFile(invalid, 'not media');
  const output = join(root, 'invalid-output.mp4'); await writeFile(output, 'keep original');
  await assert.rejects(tools().merge([{ path: invalid }], output, options, context()), /Media process|invalid/i);
  assert.equal(await readFile(output, 'utf8'), 'keep original');
  await assert.rejects(tools().merge([{ path: silent }], silent, options, context()), /source|overwrite/i);
});

test('render errors preserve outputs and source audio with music remains audible', { timeout: 10000 }, async () => {
  const output = join(root, 'mix.mp4');
  await tools().merge([{ path: sound }], output, { ...options, musicPath: audio, volume: 0 }, context());
  assert.equal((await tools().probe(output)).hasAudio, true);
  const pcm = (await exec(ffmpegPath, ['-v', 'error', '-i', output, '-f', 'f32le', '-ac', '1', '-ar', '48000', 'pipe:1'], { encoding: 'buffer' })).stdout;
  let sum = 0; for (let i = 0; i < pcm.length; i += 4) sum += Math.abs(pcm.readFloatLE(i));
  assert.ok(sum / (pcm.length / 4) > 0.01);
  const invalidImage = join(root, 'not-image.ppm'); await writeFile(invalidImage, 'bad image');
  await writeFile(output, 'previous');
  await assert.rejects(tools().slideshow([{ path: invalidImage, duration: 0.2 }], output, options, context()), /Media process/i);
  assert.equal(await readFile(output, 'utf8'), 'previous');
  assert.equal((await readdir(root)).some(p => p.startsWith('.mai-')), false);
});

test('requested clip and speech slots can extend short sources with held frames and silence', async () => {
  const extended = join(root, 'extended.mp4');
  await tools().merge([{ path: silent, duration: 1.1 }], extended, options, context());
  assert.ok(Math.abs((await tools().probe(extended)).duration - 1.1) < 0.1);
  const dubbed = join(root, 'padded-dub.mp4');
  await tools().dub(silent, [{ path: audio, start: 0.1, duration: 0.5 }], dubbed, { ...options, keepAudio: false }, context());
  assert.ok(Math.abs((await tools().probe(dubbed)).duration - 0.8) < 0.1);
});

test('source trims are end-exclusive, reset video and audio timestamps and bound explicit duration slots', async () => {
  const output = join(root, 'trimmed.mp4');
  await tools().merge([{ path: trimSource, trimStart: 0.4, trimEnd: 0.7 }], output, { ...options, fps: 20 }, context());
  assert.ok(Math.abs((await tools().probe(output)).duration - 0.3) < 0.03);
  const blue = await rgbFrame(output, 0.1);
  assert.ok(blue[0] < 20 && blue[2] > 200, 'Trimming must remove the red opening');
  assert.ok(pcmEnergy(await pcmAudio(output), 0.05, 0.15) > 0.01, 'Audio must be trimmed and reset with video');
  const red = join(root, 'trimmed-silent.mp4');
  await tools().merge([{ path: trimSource, trimStart: 0.1, trimEnd: 0.3 }], red, { ...options, fps: 20 }, context());
  assert.ok(Math.abs((await tools().probe(red)).duration - 0.2) < 0.03);
  const pixels = await rgbFrame(red, 0.05);
  assert.ok(pixels[0] > 200 && pixels[2] < 20);
  assert.ok(pcmEnergy(await pcmAudio(red), 0.03, 0.15) < 0.005);
  const padded = join(root, 'trimmed-padded.mp4');
  await tools().merge([{ path: trimSource, trimStart: 0.4, trimEnd: 0.6, duration: 0.5 }], padded, { ...options, fps: 20 }, context());
  assert.ok(Math.abs((await tools().probe(padded)).duration - 0.5) < 0.03);
  assert.ok((await rgbFrame(padded, 0.4))[2] > 200);
  assert.ok(pcmEnergy(await pcmAudio(padded), 0.3, 0.45) < 0.005, 'Padding must not read audio beyond trimEnd');
  const short = join(root, 'trimmed-short.mp4');
  await tools().merge([{ path: trimSource, trimStart: 0.4, trimEnd: 0.7, duration: 0.1 }], short, { ...options, fps: 20 }, context());
  assert.ok(Math.abs((await tools().probe(short)).duration - 0.1) < 0.03);
  const timed = join(root, 'trimmed-timeline.mp4');
  await tools().merge([{ path: trimSource, trimStart: 0.4, trimEnd: 0.7, start: 1 }, { path: trimSource, trimStart: 0.4, trimEnd: 0.7, start: 4 }], timed, { ...options, fps: 20 }, context());
  assert.ok(Math.abs((await tools().probe(timed)).duration - 4.3) < 0.03);
  assert.ok((await rgbFrame(timed, 2))[2] < 2);
  assert.ok(pcmEnergy(await pcmAudio(timed), 2, 2.1) < 0.005);
});

test('fit crop fills the canvas from its center while default pad retains black letterboxing', async () => {
  const source = join(root, 'wide-color.ppm');
  const rgb = Buffer.alloc(64 * 32 * 3);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) rgb[(y * 64 + x) * 3 + (x >= 16 && x < 48 ? 2 : 0)] = 255;
  await writeFile(source, Buffer.concat([Buffer.from('P6\n64 32\n255\n'), rgb]));
  const padded = join(root, 'fit-pad.mp4'); const cropped = join(root, 'fit-crop.mp4');
  await tools().slideshow([{ path: source, duration: 0.3 }], padded, { width: 64, height: 64, fps: 10 }, context());
  await tools().slideshow([{ path: source, duration: 0.3 }], cropped, { width: 64, height: 64, fps: 10, fit: 'crop' }, context());
  const padPixels = await rgbFrame(padded, 0.1); const cropPixels = await rgbFrame(cropped, 0.1);
  const topCenter = 32 * 3;
  assert.ok(padPixels[topCenter] < 2 && padPixels[topCenter + 2] < 2);
  assert.ok(cropPixels[topCenter] < 20 && cropPixels[topCenter + 2] > 200, 'Center crop must fill the top border with source content');
  assert.equal((await tools().probe(cropped)).width, 64);
  assert.equal((await tools().probe(cropped)).height, 64);
});

test('video and audio fades apply to the whole composited output after PNG, subtitles and music', async () => {
  const overlayPath = join(root, 'fade-overlay.png'); const subtitlePath = join(root, 'fade-subtitle.srt');
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120', '-frames:v', '1', '-c:v', 'png', overlayPath]);
  await writeFile(subtitlePath, '1\n00:00:00,000 --> 00:00:01,200\nFade me\n');
  const output = join(root, 'faded.mp4');
  await tools().merge([{ path: silent, duration: 1.2 }], output, { ...options, fps: 20, keepAudio: false, overlayPath, subtitlePath, musicPath: audio, fadeIn: 0.4, fadeOut: 0.4, audioFadeIn: 0.4, audioFadeOut: 0.4 }, context());
  assert.ok(Math.abs((await tools().probe(output)).duration - 1.2) < 0.03);
  const first = await rgbFrame(output, 0); const middle = await rgbFrame(output, 0.6); const last = await rgbFrame(output, 1.15);
  assert.ok(first.reduce((sum, value) => sum + value, 0) / first.length < 5, 'The overlay and captions must fade from black');
  assert.ok(middle[2] > 200);
  assert.ok(last[2] < 80 && last[2] > 5, 'Output must fade toward black at the end');
  const pcm = await pcmAudio(output); const mid = pcmEnergy(pcm, 0.55, 0.65);
  assert.ok(mid > 0.01);
  assert.ok(pcmEnergy(pcm, 0, 0.05) < mid * 0.25);
  assert.ok(pcmEnergy(pcm, 1.15, 1.2) < mid * 0.25);
});

test('ducking lowers music RMS during narration and preserves voice and legacy disabled mixing', async () => {
  const narration = join(root, 'duck-voice.wav'); const music = join(root, 'duck-music.wav'); const native = join(root, 'duck-native.mp4');
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1760:sample_rate=48000:duration=0.7', '-af', 'volume=2,adelay=600:all=1,apad', '-t', '2', '-ac', '2', narration]);
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=2', music]);
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x120:r=10:d=2', '-i', narration, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '2', native]);
  const bandRms = async (path: string, filter: string, start: number, end: number) => {
    const pcm = (await exec(ffmpegPath, ['-v', 'error', '-i', path, '-map', '0:a:0', '-af', filter, '-f', 'f32le', '-ar', '48000', '-ac', '1', 'pipe:1'], { encoding: 'buffer' })).stdout;
    let squares = 0; const first = Math.round(start * 48000); const last = Math.round(end * 48000);
    for (let i = first; i < last; i++) squares += pcm.readFloatLE(i * 4) ** 2;
    return Math.sqrt(squares / (last - first));
  };
  for (const kind of ['merge', 'dub'] as const) {
    const render = async (output: string, ducking?: boolean) => kind === 'merge'
      ? tools().merge([{ path: native }], output, { ...options, musicPath: music, volume: 0.8, ducking }, context())
      : tools().dub(native, [{ path: narration, start: 0 }], output, { ...options, keepAudio: false, musicPath: music, volume: 0.8, ducking }, context());
    const enabled = join(root, `duck-${kind}-on.mp4`); const disabled = join(root, `duck-${kind}-off.mp4`); const legacy = join(root, `duck-${kind}-legacy.mp4`);
    await render(enabled, true); await render(disabled, false); await render(legacy);
    assert.deepEqual(await pcmAudio(disabled), await pcmAudio(legacy), 'False and omitted ducking must retain the legacy mix');
    const before = await bandRms(enabled, 'lowpass=f=350:p=2', 0.2, 0.4);
    const during = await bandRms(enabled, 'lowpass=f=350:p=2', 0.85, 1.1);
    const after = await bandRms(enabled, 'lowpass=f=350:p=2', 1.75, 1.9);
    const unchanged = await bandRms(disabled, 'lowpass=f=350:p=2', 0.85, 1.1);
    assert.ok(during < before * 0.5 && during < unchanged * 0.5, `${kind}: music must duck during the voice`);
    assert.ok(after > during * 1.5 && after > before * 0.7, `${kind}: music must recover after narration`);
    const voice = await bandRms(enabled, 'highpass=f=1000:p=2', 0.85, 1.1);
    const original = await bandRms(disabled, 'highpass=f=1000:p=2', 0.85, 1.1);
    assert.ok(voice / original > 0.9 && voice / original < 1.1, `${kind}: sidechain detection must not consume or attenuate the voice`);
    assert.ok(Math.abs((await tools().probe(enabled)).duration - 2) < 0.03);
  }
});

test('fitted voice speed changes the complete audible duration while preserving pitch and rejecting overflow', async () => {
  const voice = join(root, 'voice-speed.wav'), native = join(root, 'voice-speed.mp4');
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=400:sample_rate=48000:duration=1.4', voice]);
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=10:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', native]);
  const spans: number[] = [];
  for (const speed of [0.8, 1, 1.25]) {
    const output = join(root, `voice-speed-${speed}.mp4`);
    await tools().dub(native, [{ path: voice, start: 0, duration: 2 }], output, { width: 64, height: 64, fps: 10, keepAudio: false, fitVoice: true, voiceSpeed: speed }, context());
    const pcm = await pcmAudio(output); let last = 0, crossings = 0;
    for (let i = 1; i < pcm.length / 4; i++) {
      const current = pcm.readFloatLE(i * 4), prior = pcm.readFloatLE((i - 1) * 4);
      if (Math.abs(current) > 0.01) last = i / 48000;
      if (i >= 4800 && i < 24000 && prior < 0 && current >= 0) crossings++;
    }
    assert.ok(crossings >= 155 && crossings <= 165, `speed ${speed} retains 400Hz pitch: ${crossings / 0.4}`);
    spans.push(last);
  }
  assert.ok(spans[0] > spans[1] * 1.12 && spans[1] > spans[2] * 1.15, `actual audible endpoints: ${spans}`);
  await assert.rejects(tools().dub(native, [{ path: voice, start: 0, duration: 0.5 }], join(root, 'voice-speed-overflow.mp4'), { ...options, fitVoice: true, voiceSpeed: 0.8 }, context()), /Voice fit/);
});

test('voiceVolume scales native source and dubbed speech before music without changing legacy defaults', async () => {
  const native = join(root, 'voice-volume-native.mp4'), voice = join(root, 'voice-volume.wav'), music = join(root, 'voice-volume-music.wav');
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1600:sample_rate=48000:duration=2', voice]);
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=150:sample_rate=48000:duration=2', music]);
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=10:d=2', '-i', voice, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', native]);
  const rms = async (path: string, filter: string) => {
    const pcm = (await exec(ffmpegPath, ['-v', 'error', '-i', path, '-af', filter, '-f', 'f32le', '-ac', '1', '-ar', '8000', 'pipe:1'], { encoding: 'buffer' })).stdout;
    let sum = 0; for (let i = 0; i < pcm.length; i += 4) sum += pcm.readFloatLE(i) ** 2;
    return Math.sqrt(sum / (pcm.length / 4));
  };
  for (const kind of ['merge', 'dub'] as const) {
    const outputs: string[] = [];
    for (const volume of [undefined, 1, 0.25, 0]) {
      const output = join(root, `voice-volume-${kind}-${volume}.mp4`); outputs.push(output);
      const settings = { width: 64, height: 64, fps: 10, musicPath: music, volume: 0.8, voiceVolume: volume };
      if (kind === 'merge') await tools().merge([{ path: native }], output, settings, context());
      else await tools().dub(native, [{ path: voice, start: 0 }], output, { ...settings, keepAudio: false }, context());
    }
    const levels = await Promise.all(outputs.map(path => rms(path, 'highpass=f=900:p=2')));
    assert.ok(Math.abs(levels[0] / levels[1] - 1) < 0.02, `${kind}: omitted volume preserves unity`);
    assert.ok(Math.abs(levels[2] / levels[1] - 0.25) < 0.025, `${kind}: quarter volume affects actual PCM`);
    assert.ok(levels[3] < levels[1] * 0.04, `${kind}: zero mutes the source/voice`);
    const musicLevels = await Promise.all(outputs.map(path => rms(path, 'lowpass=f=250:p=2')));
    assert.ok(musicLevels.every(level => Math.abs(level / musicLevels[0] - 1) < 0.04), `${kind}: music volume stays independent`);
    for (const invalid of [-0.1, 1.1, NaN]) await assert.rejects(tools().merge([{ path: native }], outputs[0], { ...options, voiceVolume: invalid }, context()), /voiceVolume/);
  }
});

test('ducking is inactive without music or foreground audio and invalid flags preserve output', async () => {
  const on = join(root, 'duck-no-base-on.mp4'); const off = join(root, 'duck-no-base-off.mp4');
  for (const render of ['merge', 'slideshow'] as const) {
    const inputs = [{ path: render === 'merge' ? silent : image, duration: 0.5 }];
    await tools()[render](inputs, on, { ...options, musicPath: audio, ducking: true }, context());
    await tools()[render](inputs, off, { ...options, musicPath: audio, ducking: false }, context());
    assert.deepEqual(await pcmAudio(on), await pcmAudio(off));
  }
  await tools().merge([{ path: sound }], on, { ...options, ducking: true }, context());
  await tools().merge([{ path: sound }], off, { ...options, ducking: false }, context());
  assert.deepEqual(await pcmAudio(on), await pcmAudio(off));
  await writeFile(on, 'previous');
  await assert.rejects(tools().merge([{ path: sound }], on, { ...options, ducking: 'true' as never }, context()), /ducking|invalid/i);
  assert.equal(await readFile(on, 'utf8'), 'previous');
});

test('opt-in Ken Burns animates nonuniform slideshow pixels while legacy and none remain static', async () => {
  const source = join(root, 'motion-checker.ppm'); const rgb = Buffer.alloc(160 * 120 * 3);
  for (let y = 0; y < 120; y++) for (let x = 0; x < 160; x++) rgb[(y * 160 + x) * 3 + ((Math.floor(x / 12) + Math.floor(y / 12)) % 2 ? 0 : 2)] = 255;
  await writeFile(source, Buffer.concat([Buffer.from('P6\n160 120\n255\n'), rgb]));
  const moving = join(root, 'kenburns.mp4'); const legacy = join(root, 'motion-legacy.mp4'); const none = join(root, 'motion-none.mp4');
  await tools().slideshow([{ path: source, start: 0.2, duration: 1 }], moving, { ...options, fps: 20, motion: 'kenburns' }, context());
  await tools().slideshow([{ path: source, start: 0.2, duration: 1 }], legacy, { ...options, fps: 20 }, context());
  await tools().slideshow([{ path: source, start: 0.2, duration: 1 }], none, { ...options, fps: 20, motion: 'none' }, context());
  const difference = (left: Buffer, right: Buffer) => {
    assert.equal(left.length, 160 * 120 * 3); assert.equal(right.length, left.length);
    return left.reduce((sum, value, index) => sum + Math.abs(value - right[index]), 0) / left.length;
  };
  const first = await rgbFrame(moving, 0.2); const last = await rgbFrame(moving, 1.15);
  assert.ok(difference(first, last) > 5, 'Nonuniform source content must move, rather than only re-encode');
  const staticFirst = await rgbFrame(legacy, 0.2); const staticLast = await rgbFrame(legacy, 1.15);
  assert.ok(difference(staticFirst, staticLast) < 2, 'Unset motion must remain static');
  assert.equal(difference(staticLast, await rgbFrame(none, 1.15)), 0);
  assert.ok(Math.abs((await tools().probe(moving)).duration - 1.2) < 0.03);
  const gap = await rgbFrame(moving, 0.1); assert.ok(gap.every(value => value < 2));
});

test('Ken Burns is restricted to slideshow images and invalid motion never replaces an output', async () => {
  const on = join(root, 'video-motion-on.mp4'); const off = join(root, 'video-motion-off.mp4');
  const source = join(root, 'native-video-pattern.mp4');
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x120:r=10:d=0.8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
  await tools().merge([{ path: source }], on, { ...options, motion: 'kenburns' }, context());
  await tools().merge([{ path: source }], off, options, context());
  assert.deepEqual(await rgbFrame(on, 0.3), await rgbFrame(off, 0.3));
  await writeFile(on, 'previous');
  await assert.rejects(tools().slideshow([{ path: image, duration: 0.3 }], on, { ...options, motion: 'unknown' as never }, context()), /motion|invalid/i);
  assert.equal(await readFile(on, 'utf8'), 'previous');
});

test('invalid trim, fit and fade settings reject without replacing an existing output', async () => {
  const output = join(root, 'invalid-edit.mp4'); await writeFile(output, 'previous');
  for (const input of [
    { path: trimSource, trimStart: -1 }, { path: trimSource, trimStart: NaN }, { path: trimSource, trimEnd: Infinity },
    { path: trimSource, trimStart: 0.5, trimEnd: 0.4 }, { path: trimSource, trimStart: 0.8 }, { path: trimSource, trimEnd: 1 }
  ]) await assert.rejects(tools().merge([input], output, options, context()), /trim|invalid|source/i);
  await assert.rejects(tools().slideshow([{ path: image, trimStart: 0.1 }], output, options, context()), /trim|image/i);
  for (const edits of [{ fit: 'stretch' }, { fadeIn: NaN }, { fadeOut: Infinity }, { fadeIn: -1 }, { audioFadeIn: -1 }, { audioFadeOut: 1 }, { fadeOut: 1 }]) {
    await assert.rejects(tools().merge([{ path: silent }], output, { ...options, ...edits } as never, context()), /fit|fade|invalid/i);
  }
  assert.equal(await readFile(output, 'utf8'), 'previous');
});

test('extractAudio writes verified PCM WAV with optional audio fades and works without a task context', async () => {
  const output = join(root, 'extracted.wav');
  const info = await tools().extractAudio(sound, output, {});
  assert.equal(info.hasAudio, true); assert.equal(info.width, undefined);
  assert.ok(Math.abs(info.duration - 0.6) < 0.03);
  const probe = await inspect(output);
  assert.equal(probe.streams.length, 1); assert.equal(probe.streams[0].codec_name, 'pcm_s16le');
  const faded = join(root, 'extracted-faded.wav');
  await tools().extractAudio(sound, faded, { audioFadeIn: 0.2, audioFadeOut: 0.2 }, context());
  const pcm = await pcmAudio(faded); const mid = pcmEnergy(pcm, 0.25, 0.35);
  assert.ok(mid > 0.01); assert.ok(pcmEnergy(pcm, 0, 0.025) < mid * 0.25); assert.ok(pcmEnergy(pcm, 0.575, 0.6) < mid * 0.25);
});

test('extractAudio rejects silent, invalid and cancelled sources and preserves existing output on publish errors', async () => {
  const output = join(root, 'extract-preserved.wav'); await writeFile(output, 'previous');
  await assert.rejects(tools().extractAudio(silent, output, {}), /audio/i);
  await assert.rejects(tools().extractAudio(sound, join(root, 'unsupported.mp3'), {}), /WAV|format|extension/i);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(tools().extractAudio(sound, output, {}, { signal: cancelled.signal }), /abort|cancel/i);
  await assert.rejects(tools().extractAudio(sound, output, {}, { progress(value) { if (value === 1) throw new Error('Cannot publish extraction'); } }), /Cannot publish extraction/);
  assert.equal(await readFile(output, 'utf8'), 'previous');
});

test('mixAudio renders real PCM samples at offsets with silence gaps, trimmed slots and an explicit tail', async () => {
  const output = join(root, 'mixed-timeline.wav');
  const info = await tools().mixAudio([{ path: audio, start: 0.2 }, { path: audio, start: 0.8, duration: 0.1 }], output, { duration: 1.2 });
  assert.equal(info.hasAudio, true); assert.equal(info.width, undefined); assert.ok(Math.abs(info.duration - 1.2) < 1 / 48000);
  const metadata = await inspect(output);
  assert.equal(metadata.streams.length, 1); assert.equal(metadata.streams[0].codec_name, 'pcm_s16le');
  assert.equal(metadata.streams[0].sample_rate, '48000'); assert.equal(metadata.streams[0].channels, 2);
  const pcm = await pcmAudio(output);
  let firstAudible = -1;
  for (let sample = 0; sample < pcm.length / 4; sample++) if (Math.abs(pcm.readFloatLE(sample * 4)) > 0.00001) { firstAudible = sample; break; }
  assert.ok(Math.abs(firstAudible - 9601) <= 1, `Expected the first source at sample 9600, got ${firstAudible}`);
  for (const [start, end] of [[0.02, 0.15], [0.55, 0.7], [0.95, 1.15]]) assert.ok(pcmEnergy(pcm, start, end) < 0.0001);
  assert.ok(pcmEnergy(pcm, 0.25, 0.35) > 0.01); assert.ok(pcmEnergy(pcm, 0.82, 0.88) > 0.01);
  const padded = join(root, 'mixed-padded.wav');
  const paddedInfo = await tools().mixAudio([{ path: audio, start: 0.2, duration: 0.5 }], padded, {});
  assert.ok(Math.abs(paddedInfo.duration - 0.7) < 1 / 48000);
  assert.ok(pcmEnergy(await pcmAudio(padded), 0.55, 0.65) < 0.0001);
});

test('mixAudio sums overlapping unordered inputs without normalization and preserves stereo while resampling', async () => {
  const output = join(root, 'mixed-overlap.wav');
  const inputs = [{ path: audio, start: 0.2 }, { path: audio, start: 0.1 }];
  assert.ok(Math.abs((await tools().mixAudio(inputs, output, {})).duration - 0.5) < 1 / 48000);
  const pcm = await pcmAudio(output); const single = pcmEnergy(pcm, 0.12, 0.17); const overlap = pcmEnergy(pcm, 0.25, 0.3);
  assert.ok(single > 0.05); assert.ok(overlap / single > 1.8 && overlap / single < 2.2);
  const quieter = join(root, 'mixed-volume.wav');
  await tools().mixAudio(inputs, quieter, { volume: 0.5, fit: 'crop', fadeIn: 0.5, audioFadeIn: 0.5 });
  const gain = pcmEnergy(await pcmAudio(quieter), 0.25, 0.3) / overlap;
  assert.ok(gain > 0.48 && gain < 0.52, 'Only duration and volume affect audio assembly');
  const stereo = join(root, 'stereo-44100.wav');
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=0.1*sin(2*PI*440*t)|0.05*sin(2*PI*880*t):s=44100:d=0.3', stereo]);
  const resampled = join(root, 'mixed-stereo.wav');
  await tools().mixAudio([{ path: stereo, start: 0.1 }], resampled, {});
  const frames = (await exec(ffmpegPath, ['-v', 'error', '-i', resampled, '-f', 'f32le', '-ar', '48000', '-ac', '2', 'pipe:1'], { encoding: 'buffer' })).stdout;
  let left = 0; let right = 0;
  for (let i = 5760; i < 8640; i++) { left += Math.abs(frames.readFloatLE(i * 8)); right += Math.abs(frames.readFloatLE(i * 8 + 4)); }
  assert.ok(left / right > 1.8 && left / right < 2.2, 'Stereo channels must retain their relative levels');
});

test('mixAudio validates count, offsets, duration, sources and WAV destinations before replacing output', async () => {
  const output = join(root, 'mix-invalid.wav'); await writeFile(output, 'previous');
  for (const inputs of [[], Array.from({ length: 101 }, () => ({ path: audio, start: 0 })), [{ path: audio, start: -1 }], [{ path: audio, start: NaN }], [{ path: audio, start: Infinity }], [{ path: audio, start: 21600 }], [{ path: audio, start: 0, duration: 0 }], [{ path: audio, start: 0, duration: Infinity }], [{ path: silent, start: 0 }], [{ path: root, start: 0 }], [{ path: join(root, 'absent.wav'), start: 0 }]]) {
    await assert.rejects(tools().mixAudio(inputs, output, {}), /input|start|duration|audio|file|ENOENT|invalid/i);
  }
  for (const settings of [{ duration: 0.2 }, { duration: NaN }, { duration: Infinity }, { duration: 21601 }, { volume: NaN }, { volume: -1 }, { volume: 5 }]) await assert.rejects(tools().mixAudio([{ path: audio, start: 0.1 }], output, settings), /duration|timeline|volume|invalid/i);
  await assert.rejects(tools().mixAudio([{ path: audio, start: 0 }], join(root, 'mix.mp3'), {}), /WAV|format/i);
  await assert.rejects(tools().mixAudio([{ path: audio, start: 0 }], audio, {}), /source|overwrite/i);
  assert.equal(await readFile(output, 'utf8'), 'previous');
});

test('mixAudio cancellation, process errors and publication failure leave the old output intact', { timeout: 10000 }, async () => {
  const output = join(root, 'mix-cancel.wav'); await writeFile(output, 'previous');
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await assert.rejects(tools().mixAudio([{ path: audio, start: 0 }], output, { duration: 21600 }, { signal: controller.signal, progress(value) { if (value === 0) timer = setTimeout(() => controller.abort(), 25); } }), /abort|cancel/i);
  } finally { if (timer) clearTimeout(timer); }
  assert.equal(await readFile(output, 'utf8'), 'previous');
  await assert.rejects(tools().mixAudio([{ path: audio, start: 0 }], output, {}, { signal: controller.signal }), /abort|cancel/i);
  await assert.rejects(tools().mixAudio([{ path: audio, start: 0 }], output, {}, { progress(value) { if (value === 1) throw new Error('Publication unavailable'); } }), /Publication unavailable/);
  await assert.rejects(new (api().MediaTools)({ ffmpegPath: join(root, 'missing-mix-ffmpeg'), ffprobePath }).mixAudio([{ path: audio, start: 0 }], output, {}), /ffmpeg|ENOENT/i);
  assert.equal(await readFile(output, 'utf8'), 'previous');
  assert.equal((await readdir(root)).some(path => path.startsWith('.mai-publish-')), false);
});

test('mixAudio accepts 100 real inputs for parent batching and dub accepts a full narration track beyond one hour', { timeout: 15000 }, async () => {
  const output = join(root, 'mix-batch.wav');
  const info = await tools().mixAudio(Array.from({ length: 100 }, (_, index) => ({ path: audio, start: index * 0.01, duration: 0.005 })), output, { duration: 1 }, { signal: AbortSignal.timeout(10000) });
  assert.ok(Math.abs(info.duration - 1) < 1 / 48000);
  assert.ok(pcmEnergy(await pcmAudio(output), 0.995, 1) < 0.0001);
  const longVideo = join(root, 'long-still.mp4');
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=1/4000', '-frames:v', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', longVideo]);
  assert.ok((await tools().probe(longVideo)).duration >= 4000);
  const cancelled = new AbortController();
  const target = join(root, 'long-dub.mp4'); await writeFile(target, 'previous');
  await assert.rejects(tools().dub(longVideo, [{ path: audio, start: 0, duration: 4000 }], target, { width: 64, height: 64, fps: 10 }, { ...context(cancelled.signal), progress(value) { if (value === 0) cancelled.abort(); } }), /abort|cancel/i);
  assert.equal(await readFile(target, 'utf8'), 'previous');
});

test('slideshow absolute starts render leading and inter-shot black gaps through the last cue end', async () => {
  const output = join(root, 'absolute-slides.mp4');
  await tools().slideshow([{ path: image, start: 1, duration: 1 }, { path: image, start: 4, duration: 1 }], output, { width: 64, height: 64, fps: 10 }, context());
  const info = await inspect(output);
  assert.ok(Math.abs(Number(info.format.duration) - 5) < 0.03, `Expected 5 seconds, got ${info.format.duration}`);
  for (const [time, black] of [[0.5, true], [1.5, false], [2.5, true], [3.5, true], [4.5, false]] as const) {
    const pixels = (await exec(ffmpegPath, ['-v', 'error', '-ss', String(time), '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer' })).stdout;
    assert.equal(pixels.length, 64 * 64 * 3);
    const mean = pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
    assert.ok(black ? mean < 2 : mean > 50, `At ${time}s expected ${black ? 'black gap' : 'source image'}, mean=${mean}`);
  }
  assert.equal((await tools().probe(output)).hasAudio, false);
});

test('fractional cue gaps do not accumulate frame rounding and erase the last shot', async () => {
  const output = join(root, 'fractional-timeline.mp4');
  await tools().slideshow(Array.from({ length: 10 }, (_, index) => ({ path: image, start: 0.15 + index * 0.25, duration: 0.1 })), output, { width: 64, height: 64, fps: 10 }, context());
  assert.ok(Math.abs((await tools().probe(output)).duration - 2.5) < 0.03);
  const pixels = (await exec(ffmpegPath, ['-v', 'error', '-ss', '2.4', '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer' })).stdout;
  assert.equal(pixels.length, 64 * 64 * 3);
  assert.ok(pixels.reduce((sum, value) => sum + value, 0) / pixels.length > 50, 'The final cue must still display its source image at its absolute start');
});

test('merge absolute starts fill gaps with black and silence while preserving clip audio placement', async () => {
  const output = join(root, 'absolute-merge.mp4');
  await tools().merge([{ path: sound, start: 1, duration: 1 }, { path: sound, start: 4, duration: 1 }], output, { width: 64, height: 64, fps: 10 }, context());
  const info = await tools().probe(output);
  assert.ok(Math.abs(info.duration - 5) < 0.03, `Expected 5 seconds, got ${info.duration}`);
  assert.equal(info.hasAudio, true);
  const pcm = (await exec(ffmpegPath, ['-v', 'error', '-i', output, '-map', '0:a:0', '-f', 'f32le', '-ac', '1', '-ar', '48000', 'pipe:1'], { encoding: 'buffer' })).stdout;
  for (const [start, audible] of [[0.2, false], [1.1, true], [2.5, false], [3.5, false], [4.1, true]] as const) {
    let energy = 0;
    for (let i = Math.round(start * 48000); i < Math.round((start + 0.1) * 48000); i++) energy += Math.abs(pcm.readFloatLE(i * 4));
    energy /= 4800;
    assert.ok(audible ? energy > 0.01 : energy < 0.005, `At ${start}s expected ${audible ? 'audio' : 'silence'}, energy=${energy}`);
  }
  const pixels = (await exec(ffmpegPath, ['-v', 'error', '-ss', '2.5', '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer' })).stdout;
  assert.ok(pixels.length > 0 && pixels.every(value => value < 2));
});

test('media rejects invalid, overlapping or reversed starts and keeps mixed sequential timing intact', async () => {
  const output = join(root, 'invalid-timeline.mp4');
  await writeFile(output, 'previous');
  for (const render of ['merge', 'slideshow'] as const) {
    const path = render === 'merge' ? silent : image;
    for (const start of [-1, NaN, Infinity, 21600]) await assert.rejects(tools()[render]([{ path, duration: 1, start }], output, options, context()), /start|duration|timeline|invalid/i);
    for (const starts of [[1, 1.5], [4, 1]]) await assert.rejects(tools()[render](starts.map(start => ({ path, duration: 1, start })), output, options, context()), /overlap|order|time/i);
    await assert.rejects(tools()[render]([{ path, duration: 0.001, start: 1 }], output, options, context()), /frame|fps/i);
  }
  assert.equal(await readFile(output, 'utf8'), 'previous');
  await tools().slideshow([{ path: image, duration: 0.2, start: 0.5 }, { path: image, duration: 0.3 }, { path: image, duration: 0.3, start: 1.2 }], output, options, context());
  assert.ok(Math.abs((await tools().probe(output)).duration - 1.5) < 0.03);
});

test('publication callback errors and cancellation preserve an existing destination', async () => {
  const output = join(root, 'publish-cancel.mp4');
  await writeFile(output, 'keep');
  await assert.rejects(tools().merge([{ path: silent }], output, options, { ...context(), progress(value) { if (value === 1) throw new Error('Progress unavailable'); } }), /Progress unavailable/);
  assert.equal(await readFile(output, 'utf8'), 'keep');
  const controller = new AbortController();
  await assert.rejects(tools().merge([{ path: silent }], output, options, { ...context(controller.signal), progress(value) { if (value === 1) controller.abort(); } }), /abort|cancel/i);
  assert.equal(await readFile(output, 'utf8'), 'keep');
});

async function recordedMerge(name: string, failFinal = false) {
  const log = join(root, name + '.jsonl'); const binary = join(root, name);
  await writeFile(binary, `#!${process.execPath}\nconst fs = require('node:fs'); const {spawn} = require('node:child_process'); const args = process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n'); if (${failFinal} && args.includes('libx264')) process.exit(9); const child = spawn(${JSON.stringify(ffmpegPath)}, args, {stdio:'inherit'}); process.on('SIGTERM', () => child.kill('SIGTERM')); child.on('close', code => process.exit(code ?? 1));\n`, { mode: 0o700 });
  return { media: new (api().MediaTools)({ ffmpegPath: binary, ffprobePath }), calls: async () => (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[]) };
}

test('hierarchical merge renders 101 real clips with frame-aligned gaps, trims, silent chunks and native audio', { timeout: 30000 }, async () => {
  const inputs = [];
  for (let index = 0; index < 101; index++) {
    const path = join(root, `hierarchy-source-${index}.mp4`);
    await copyFile(index === 100 ? trimSource : silent, path);
    inputs.push(index === 100 ? { path, start: 11.36, duration: 0.35, trimStart: 0.4, trimEnd: 0.8 } : { path, start: 0.13 + index * 0.11, duration: 0.11 });
  }
  const recorded = await recordedMerge('hierarchy-ffmpeg'); const output = join(root, 'hierarchy.mp4'); const progress: number[] = [];
  await recorded.media.merge(inputs, output, { width: 64, height: 64, fps: 20, title: '101 clips — title' }, { ...context(AbortSignal.timeout(25000)), progress(value) { progress.push(value); } });
  const info = await inspect(output);
  assert.ok(Math.abs(Number(info.format.duration) - 11.7) < 0.03, info.format.duration);
  assert.equal(info.format.tags?.title, '101 clips — title');
  const frame = async (time: number) => { const data = await rgbFrame(output, time); assert.equal(data.length, 64 * 64 * 3); return data; };
  assert.ok((await frame(0.05)).every(value => value < 2));
  assert.ok((await frame(0.2))[(32 * 64 + 32) * 3] > 200, 'The first/title clip remains red inside the padded canvas');
  assert.ok((await frame(11.2)).every(value => value < 2), 'The gap across the chunk boundary remains black');
  assert.ok((await frame(11.5))[(32 * 64 + 32) * 3 + 2] > 200, 'The trimmed final source remains blue inside the padded canvas');
  const pcm = await pcmAudio(output);
  assert.ok(pcmEnergy(pcm, 10.8, 10.9) < 0.001, 'A chunk without source audio must retain silence');
  assert.ok(pcmEnergy(pcm, 11.2, 11.3) < 0.001);
  assert.ok(pcmEnergy(pcm, 11.45, 11.55) > 0.01, 'Native audio must stay at its absolute start');
  assert.equal(progress.at(-1), 1); assert.ok(progress.every((value, index) => value >= 0 && value <= 1 && (!index || value >= progress[index - 1])));
  const calls = await recorded.calls(); assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(args => args.filter(arg => arg === '-i').length), [100, 1, 2]);
  for (const args of calls.slice(0, 2)) { assert.ok(args.includes('ffv1')); assert.ok(args.includes('pcm_s16le')); assert.equal(args.includes('-metadata'), false); }
  const finalGraph = calls[2][calls[2].indexOf('-filter_complex') + 1];
  assert.doesNotMatch(finalGraph, /scale=|fps=|crop=|tpad=/, 'Source transforms must not run again after chunk normalization');
  for (const args of calls) await assert.rejects(readFile(args.at(-1)!), /ENOENT/, 'Temporary renders must be cleaned');
});

test('hierarchical merge applies overlay, subtitles, music and fades only once on the final timeline', { timeout: 30000 }, async () => {
  const overlayPath = join(root, 'hierarchy-overlay.png'); const subtitlePath = join(root, 'hierarchy.srt');
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue@0.4:s=160x120,format=rgba', '-frames:v', '1', '-c:v', 'png', overlayPath]);
  await writeFile(subtitlePath, '1\n00:00:09,800 --> 00:00:10,100\nFINAL\n');
  const output = join(root, 'hierarchy-effects.mp4'); const reference = join(root, 'hierarchy-effects-reference.mp4');
  const effects = { ...options, overlayPath, subtitlePath, musicPath: audio, volume: 0.2, fadeIn: 0.4, fadeOut: 0.4, audioFadeIn: 0.4, audioFadeOut: 0.4, title: 'Final effects' };
  const recorded = await recordedMerge('hierarchy-effects-ffmpeg');
  await recorded.media.merge(Array.from({ length: 101 }, () => ({ path: silent, duration: 0.1 })), output, effects, context(AbortSignal.timeout(25000)));
  await tools().merge([{ path: silent, duration: 10.1 }], reference, effects, context());
  for (const time of [0, 0.5, 9.7, 9.9, 10]) {
    const actual = await rgbFrame(output, time); const expected = await rgbFrame(reference, time);
    assert.equal(actual.length, expected.length); assert.ok(actual.length > 0);
    assert.ok(actual.reduce((sum, value, index) => sum + Math.abs(value - expected[index]), 0) / actual.length < 3, `Effects must match a single composition at ${time}s`);
  }
  const actual = await pcmAudio(output); const expected = await pcmAudio(reference);
  for (const [start, end] of [[0, 0.05], [0.5, 0.6], [9.6, 9.7], [10, 10.05]]) assert.ok(Math.abs(pcmEnergy(actual, start, end) - pcmEnergy(expected, start, end)) < 0.002);
  const calls = await recorded.calls(); assert.equal(calls.length, 3);
  for (const args of calls.slice(0, 2)) assert.doesNotMatch(args.join(' '), /overlay=|subtitles=|fade=|afade=|aloop=|title=/);
  const final = calls[2]; assert.equal(final.filter(arg => arg === '-i').length, 4);
  assert.match(final[final.indexOf('-filter_complex') + 1], /\[3:v:0\]overlay=/);
  assert.equal((await inspect(output)).format.tags?.title, effects.title);
});

test('hierarchical slideshow renders 101 SRT-timed images with Ken Burns, gaps and final-only captions and fades', { timeout: 30000 }, async () => {
  const rgb = Buffer.alloc(80 * 60 * 3);
  for (let y = 0; y < 60; y++) for (let x = 0; x < 80; x++) rgb[(y * 80 + x) * 3 + ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 0 : 2)] = 255;
  const cues = api().parseSrt(api().formatSrt(Array.from({ length: 101 }, (_, index) => ({ index: index + 1, start: index === 100 ? 10.5 : (150 + index * 100) / 1000, end: index === 100 ? 11.3 : (250 + index * 100) / 1000, text: index === 100 ? 'LAST' : String(index + 1) }))));
  const inputs = [];
  for (const cue of cues) {
    const path = join(root, `hierarchy-image-${cue.index}.ppm`);
    await writeFile(path, Buffer.concat([Buffer.from('P6\n80 60\n255\n'), rgb]));
    inputs.push({ path, start: cue.start, duration: cue.end - cue.start });
  }
  const subtitlePath = join(root, 'hierarchy-images.srt'); await writeFile(subtitlePath, api().formatSrt(cues));
  const output = join(root, 'hierarchy-slideshow.mp4'); const recorded = await recordedMerge('hierarchy-slideshow-ffmpeg');
  await recorded.media.slideshow(inputs, output, { ...options, fps: 20, motion: 'kenburns', subtitlePath, fadeIn: 0.3, fadeOut: 0.2, musicPath: audio, volume: 0.2 }, context(AbortSignal.timeout(25000)));
  const info = await recorded.media.probe(output); assert.ok(Math.abs(info.duration - 11.3) < 0.03); assert.equal(info.hasAudio, true);
  const leading = await rgbFrame(output, 0.05); assert.ok(leading.every(value => value < 2));
  const gap = await rgbFrame(output, 10.25); assert.ok(gap.every(value => value < 2));
  const first = await rgbFrame(output, 10.5); const moved = await rgbFrame(output, 11); const faded = await rgbFrame(output, 11.25);
  assert.equal(first.length, 160 * 120 * 3); assert.equal(moved.length, first.length);
  assert.ok(first.reduce((sum, value, index) => sum + Math.abs(value - moved[index]), 0) / first.length > 5, 'Ken Burns must animate the image in the second chunk');
  assert.ok(moved.some((value, index) => index % 3 === 1 && value > 150), 'The final SRT caption must add white text to the red/blue image');
  const brightness = (frame: Buffer) => frame.reduce((sum, value) => sum + value, 0) / frame.length;
  assert.ok(brightness(faded) < brightness(moved) * 0.4, 'Fade-out must use the final timeline end');
  const early = await rgbFrame(output, 0.2); assert.ok(brightness(early) < brightness(moved) * 0.8, 'Fade-in must use the start of the entire timeline');
  const calls = (await recorded.calls()).filter(args => args.includes('-filter_complex'));
  assert.deepEqual(calls.map(args => args.filter(value => value === '-i').length), [100, 1, 3]);
  for (const args of calls.slice(0, 2)) {
    const graph = args[args.indexOf('-filter_complex') + 1]; assert.match(graph, /zoompan=/); assert.doesNotMatch(graph, /subtitles=|fade=|afade=|aloop=/);
  }
  const graph = calls[2][calls[2].indexOf('-filter_complex') + 1];
  assert.doesNotMatch(graph, /zoompan=|scale=|fps=/); assert.equal(graph.match(/subtitles=/g)?.length, 1);
  for (const args of calls) await assert.rejects(readFile(args.at(-1)!), /ENOENT/);
  await assert.rejects(recorded.media.slideshow(Array.from({ length: 1003 }, () => ({ path: image })), output, options, context()), /input count|1002/i);
});

test('hierarchical sequence cancellation and final encode failure preserve output and remove all intermediates', { timeout: 45000 }, async () => {
  for (const render of ['merge', 'slideshow'] as const) for (const failFinal of [false, true]) {
    const inputs = Array.from({ length: 101 }, () => ({ path: render === 'merge' ? silent : image, duration: 0.1 }));
    const recorded = await recordedMerge(`hierarchy-failure-${render}-${failFinal}`, failFinal);
    const output = join(root, `hierarchy-failure-${render}-${failFinal}.mp4`); await writeFile(output, 'previous');
    const controller = new AbortController(); let rendering = 0;
    await assert.rejects(recorded.media[render](inputs, output, options, { ...context(controller.signal), progress(_value, message) { if (!failFinal && /Rendering CPU media/.test(message) && ++rendering === 2) controller.abort(); } }), failFinal ? /Media process exited 9/ : /abort|cancel/i);
    assert.equal(await readFile(output, 'utf8'), 'previous');
    const calls = (await recorded.calls()).filter(args => args.includes('-filter_complex')); assert.ok(calls.length >= 1 && calls.length <= 3);
    for (const args of calls) { assert.ok(args.filter(arg => arg === '-i').length <= 100); await assert.rejects(readFile(args.at(-1)!), /ENOENT/); }
    await assert.rejects(readdir(join(calls[0].at(-1)!, '..')), /ENOENT/, 'Render staging directory must be removed after failure');
    for (const args of calls) for (const [index, value] of args.entries()) if (value === '-i' && args[index + 1].includes('mai-merge-')) await assert.rejects(readdir(join(args[index + 1], '..')), /ENOENT/, 'Chunk staging root must be removed after failure');
    assert.equal((await readdir(root)).some(name => name.startsWith('.mai-')), false);
  }
});

test('local stress: concurrent real renders, queued cancellation and repeated narrative-free media jobs', { timeout: 20000 }, async () => {
  const started = Date.now(); const baseline = process.memoryUsage().rss; let peak = baseline;
  const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 10);
  const controllers = Array.from({ length: 8 }, () => new AbortController());
  const outputs = controllers.map((_, i) => join(root, `stress-${i}.mp4`));
  try {
    await Promise.all(outputs.map(output => writeFile(output, 'previous')));
    const jobs = controllers.map(async (controller, index) => {
      try {
        await tools().merge([{ path: silent }, { path: sound }], outputs[index], { ...options, keepAudio: index % 2 === 0 }, context(controller.signal));
        return 'success';
      } catch (error) { assert.match(String(error), /abort|cancel/i); return 'cancelled'; }
    });
    controllers[2].abort(); controllers[5].abort();
    const results = await Promise.all(jobs);
    assert.equal(results.filter(result => result === 'success').length, 6);
    assert.equal(results.filter(result => result === 'cancelled').length, 2);
    for (const [index, result] of results.entries()) {
      if (result === 'cancelled') assert.equal(await readFile(outputs[index], 'utf8'), 'previous');
      else {
        const info = await tools().probe(outputs[index]);
        assert.ok(Math.abs(info.duration - 1.4) < 0.15); assert.equal(info.hasAudio, index % 2 === 0);
      }
    }
    console.log(JSON.stringify({ stress: 'media', jobs: 8, succeeded: 6, cancelled: 2, elapsedMs: Date.now() - started, nodeRssBaseline: baseline, nodeRssPeak: peak }));
  } finally { clearInterval(sampler); for (const controller of controllers) controller.abort(); }
});


test('Affiliate captions stay below the face and above the dialogue and footer in portrait video', async () => {
  const captionPath = join(root, 'affiliate-position.srt'), output = join(root, 'affiliate-position.mp4');
  await writeFile(captionPath, '1\n00:00:00,000 --> 00:00:01,000\nXem sản phẩm trong giỏ hàng\n');
  await tools().merge([{ path: silent, duration: 1 }], output, { width: 240, height: 426, fps: 10, captionPath }, context());
  const result = await exec(ffmpegPath, ['-v', 'error', '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1024 ** 2 });
  const pixels = result.stdout, rows: number[] = [];
  for (let y = 0; y < 426; y++) for (let x = 0; x < 240; x++) { const offset = (y * 240 + x) * 3; if (pixels[offset] > 200 && pixels[offset + 1] > 200 && pixels[offset + 2] > 200) { rows.push(y); break; } }
  assert.ok(rows.length > 5, 'caption glyphs are present in the rendered frame');
  assert.ok(Math.min(...rows) > 426 * 0.5 && Math.max(...rows) < 426 * 0.75, 'scene caption stays in the lower third, away from face, dialogue and footer');
});


test('a reserved subtitle margin keeps spoken words above the Affiliate price footer', async () => {
  const subtitlePath = join(root, 'affiliate-dialogue.srt'), output = join(root, 'affiliate-dialogue.mp4');
  await writeFile(subtitlePath, '1\n00:00:00,000 --> 00:00:01,000\nNative dialogue\n');
  const safeOptions = { width: 240, height: 426, fps: 10, subtitlePath, subtitleMarginV: 52 };
  await tools().merge([{ path: silent, duration: 1 }], output, safeOptions, context());
  const result = await exec(ffmpegPath, ['-v', 'error', '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1024 ** 2 });
  const pixels = result.stdout, rows: number[] = [];
  for (let y = 0; y < 426; y++) for (let x = 0; x < 240; x++) { const offset = (y * 240 + x) * 3; if (pixels[offset] > 200 && pixels[offset + 1] > 200 && pixels[offset + 2] > 200) { rows.push(y); break; } }
  assert.ok(rows.length > 5); assert.ok(Math.min(...rows) > 426 * 0.7 && Math.max(...rows) < 426 * 0.83, 'spoken subtitle has a dedicated band above the footer');
});
