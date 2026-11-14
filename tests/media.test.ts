import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile, readFile, rm, readdir, symlink } from 'node:fs/promises';
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
const options = { width: 160, height: 120, fps: 10 };
const context = (signal = AbortSignal.timeout(5000)): TaskContext => ({ signal, progress() {}, checkpoint() {} });
const tools = () => new (api().MediaTools)({ ffmpegPath, ffprobePath });
async function inspect(path: string) {
  return JSON.parse((await exec(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path])).stdout) as { streams: Array<{ codec_type: string; width?: number; height?: number; codec_name: string }>; format: { duration: string; tags?: { title?: string } } };
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'mai-media-tests-'));
  silent = join(root, 'im lặng $(touch nope).mp4');
  sound = join(root, 'âm thanh.mp4'); audio = join(root, 'giọng.wav'); image = join(root, 'ảnh.ppm');
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x120:r=10', '-t', '0.8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', silent]);
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=120x160:r=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '0.6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sound]);
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', '0.3', audio]);
  await writeFile(image, Buffer.concat([Buffer.from('P6\n16 16\n255\n'), Buffer.alloc(16 * 16 * 3, 150)]));
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
      const output = join(root, `bundled-path-${index}.mp4`);
      await media.slideshow([{ path: image, duration: 0.2 }], output, { width: 64, height: 64, fps: 10 }, context());
      assert.equal((await media.probe(output)).width, 64);
    }
    cached.exports = bundled;
    const media = new MediaTools({ ffmpegPath: configured, ffprobePath });
    cached.exports = saved;
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

test('validation and failed encodes preserve an existing output and reject unbounded input', async () => {
  const output = join(root, 'preserve.mp4'); await writeFile(output, 'original');
  for (const opts of [{ width: 161 }, { fps: Infinity }, { volume: NaN }, { height: 100000 }]) await assert.rejects(tools().merge([{ path: silent }], output, opts, context()), /invalid|width|height|fps|volume/i);
  for (const inputs of [[], [{ path: silent, duration: 0 }], [{ path: silent, duration: NaN }], [{ path: silent, duration: 999999 }], Array.from({ length: 101 }, () => ({ path: silent }))]) await assert.rejects(tools().merge(inputs, output, options, context()), /input|duration|limit/i);
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
