import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaTools } from '../src/core/media';
import { createRecap, type RecapInput } from '../src/core/series';
import type { TaskContext } from '../src/shared/studio';

const exec = promisify(execFile);
const ffmpegPath: string = process.env.TEST_FFMPEG_PATH || require('ffmpeg-static');
const ffprobePath = process.env.TEST_FFPROBE_PATH || 'ffprobe';
const media = () => new MediaTools({ ffmpegPath, ffprobePath });
const options = { width: 160, height: 120, fps: 20 };
const context = (signal = AbortSignal.timeout(15000)): TaskContext => ({ signal, progress() {}, checkpoint() {} });
let root: string;
let inputs: Array<{ path: string }>;
let silent: string;
let audio: string;
let speechClip: string;
let longSpeechClip: string;
let speechWav: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'mai-series-tests-'));
  inputs = ['ignored', 'blue-tail', 'green-short', 'white-tail'].map(name => ({ path: join(root, `${name}.mp4`) }));
  for (const [index, input] of inputs.entries()) {
    const short = index === 2; const duration = short ? 1 : 6;
    const color = ['red', 'blue', 'green', 'white'][index];
    const video = short || index === 0 ? `color=c=${color}:s=160x120:r=20:d=${duration}`
      : `color=c=red:s=160x120:r=20:d=1.5[head];color=c=${color}:s=160x120:r=20:d=4.5[tail];[head][tail]concat=n=2:v=1:a=0`;
    await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', video, '-f', 'lavfi', '-i', `sine=frequency=${440 + index * 110}:sample_rate=48000:duration=${short ? 1 : 4.5}`,
      ...(!short ? ['-af', 'adelay=1500:all=1'] : []), '-t', String(duration), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input.path]);
  }
  silent = join(root, 'silent.mp4'); audio = join(root, 'audio.wav');
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=160x120:r=20:d=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', silent]);
  await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=0.2', audio]);
  speechWav = join(root, 'early-speech.wav'); speechClip = join(root, 'early-speech.mp4'); longSpeechClip = join(root, 'long-speech.mp4');
  for (const [wav, clip, tone, start, length] of [[speechWav, speechClip, 990, 0.4, 0.6], [join(root, 'long-speech.wav'), longSpeechClip, 880, 0.2, 5.6]] as const) {
    await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${tone}:sample_rate=48000:duration=${length}`, '-af', `adelay=${start * 1000}:all=1,apad`, '-t', '6', '-c:a', 'pcm_s16le', wav]);
    await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:r=20:d=6', '-i', wav, '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip]);
  }
});
after(async () => { if (root) await rm(root, { recursive: true, force: true }); });

async function rgb(path: string, time: number): Promise<number[]> {
  const frame = (await exec(ffmpegPath, ['-v', 'error', '-ss', String(time), '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer' })).stdout;
  const pixel = (60 * 160 + 80) * 3; return [...frame.subarray(pixel, pixel + 3)];
}
async function pcmAudio(path: string): Promise<Buffer> {
  return (await exec(ffmpegPath, ['-v', 'error', '-i', path, '-map', '0:a:0', '-f', 'f32le', '-ac', '1', '-ar', '48000', 'pipe:1'], { encoding: 'buffer', maxBuffer: 4 * 1024 ** 2 })).stdout;
}
function energy(pcm: Buffer, start: number, end: number): number {
  let sum = 0; const first = Math.round(start * 48000); const last = Math.round(end * 48000);
  for (let sample = first; sample < last; sample++) sum += Math.abs(pcm.readFloatLE(sample * 4));
  return sum / (last - first);
}
function frequency(pcm: Buffer, start: number, end: number): number {
  let crossings = 0;
  for (let sample = Math.round(start * 48000) + 1; sample < Math.round(end * 48000); sample++) {
    if (pcm.readFloatLE((sample - 1) * 4) <= 0 && pcm.readFloatLE(sample * 4) > 0) crossings++;
  }
  return crossings / (end - start);
}

test('recap renders the last three eligible clip tails, keeps short clips and real audio, and fades only the recap edges', async () => {
  const output = join(root, 'recap.mp4'); const tools = media();
  const result = await createRecap(tools, inputs, output, options, context());
  const info = await tools.probe(output); assert.equal(result.path, output); assert.equal(result.duration, info.duration);
  assert.ok(Math.abs(result.duration - 10) < 0.08); assert.equal(info.hasAudio, true); assert.equal(info.width, 160); assert.equal(info.height, 120);
  const blue = await rgb(output, 0.8); const green = await rgb(output, 4.7); const white = await rgb(output, 7);
  assert.ok(blue[2] > 200 && blue[0] < 30, 'take the blue tail, not the red clip head or ignored clip');
  assert.ok(green[1] > 90 && green[0] < 30, 'retain the one-second middle clip without an extra boundary fade');
  assert.ok(white.every(value => value > 220)); assert.ok((await rgb(output, 0)).every(value => value < 5));
  const fadeIn = await rgb(output, 0.15); assert.ok(fadeIn[2] > 60 && fadeIn[2] < blue[2] * 0.7);
  assert.ok((await rgb(output, 9.9)).every(value => value < 90));
  const pcm = await pcmAudio(output);
  assert.ok(energy(pcm, 0, 0.1) < energy(pcm, 0.8, 0.9) * 0.4);
  assert.ok(energy(pcm, 9.9, 10) < energy(pcm, 9, 9.1) * 0.3);
  for (const [start, end, expected] of [[0.8, 1.2, 550], [4.7, 5.1, 660], [7, 7.4, 770]]) {
    assert.ok(Math.abs(frequency(pcm, start, end) - expected) < 20, `preserve the ${expected} Hz excerpt`);
  }
});

test('recap derives clip dimensions when omitted and safely clamps fades for a short silent recap', async () => {
  const output = join(root, 'short.mp4'); const tools = media();
  const result = await createRecap(tools, [{ path: silent }], output, { fps: 20 }, context()); const info = await tools.probe(output);
  assert.ok(Math.abs(result.duration - 0.2) < 0.06); assert.equal(info.width, 160); assert.equal(info.height, 120); assert.equal(info.hasAudio, false);
});

test('recap uses caller output dimensions and preserves chronological order', async () => {
  const output = join(root, 'portrait.mp4'); const tools = media();
  await createRecap(tools, [inputs[2], inputs[1]], output, { width: 120, height: 160, fps: 20 }, context());
  const info = await tools.probe(output); assert.equal(info.width, 120); assert.equal(info.height, 160); assert.ok(Math.abs(info.duration - 5.5) < 0.08);
});

test('recap rejects empty, invalid, symlink and non-video inputs without modifying output', async () => {
  const output = join(root, 'guarded.mp4'); const previous = Buffer.from('previous artifact'); await writeFile(output, previous);
  const link = join(root, 'linked.mp4'); await symlink(inputs[0].path, link);
  for (const candidates of [[], [{ path: root }], [{ path: link }], [{ path: audio }], [{ path: join(root, 'missing.mp4') }], [{ path: '\0' }]]) {
    await assert.rejects(createRecap(media(), candidates, output, options, context())); assert.deepEqual(await readFile(output), previous);
  }
  await assert.rejects(createRecap(media(), inputs, inputs[0].path, options, context()), /overwrite|source/i);
  await assert.rejects(createRecap(media(), inputs, link, options, context()), /regular|symbolic|symlink/i);
  await assert.rejects(createRecap(media(), inputs, root, options, context()), /regular|file/i);
  await assert.rejects(createRecap(media(), inputs, join(root, 'bad.wav'), options, context()), /format|extension/i);
});

test('recap cancellation during a real CPU render preserves an existing output and removes temporary files', async () => {
  const output = join(root, 'cancelled.mp4'); const previous = Buffer.from('previous completed artifact'); await writeFile(output, previous);
  const beforeFiles = (await readdir(root)).sort(); const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let rendering = false;
  try {
    await assert.rejects(createRecap(media(), inputs, output, { width: 1280, height: 720, fps: 60 }, {
      ...context(controller.signal), progress(value) { if (value === 0 && !rendering) { rendering = true; timer = setTimeout(() => controller.abort(), 30); } },
    }), { name: 'AbortError' });
    assert.equal(rendering, true); assert.equal(controller.signal.aborted, true); assert.deepEqual(await readFile(output), previous);
    assert.deepEqual((await readdir(root)).sort(), beforeFiles);
  } finally { clearTimeout(timer); }
});

test('recap abort before work or publication never publishes output and cleans staging directories', async () => {
  const output = join(root, 'late-cancel.mp4'); const previous = Buffer.from('old recap'); await writeFile(output, previous);
  const beforeFiles = (await readdir(root)).sort();
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(createRecap(media(), inputs, output, options, context(stopped.signal)), { name: 'AbortError' });
  const controller = new AbortController();
  await assert.rejects(createRecap(media(), [inputs[2]], output, options, { ...context(controller.signal), progress(value) { if (value === 1) controller.abort(); } }), { name: 'AbortError' });
  assert.deepEqual(await readFile(output), previous); assert.deepEqual((await readdir(root)).sort(), beforeFiles);
});

test('recap FFmpeg failure preserves output and removes its temporary staging', async () => {
  const output = join(root, 'failed.mp4'); const previous = Buffer.from('old completed recap'); await writeFile(output, previous);
  const beforeFiles = (await readdir(root)).sort();
  await assert.rejects(createRecap(new MediaTools({ ffmpegPath: join(root, 'missing-ffmpeg'), ffprobePath }), [inputs[2]], output, options, context()), /Cannot run|ENOENT/);
  assert.deepEqual(await readFile(output), previous); assert.deepEqual((await readdir(root)).sort(), beforeFiles);
});

test('recap retains early QA speech from a real PCM WAV instead of selecting the silent tail', async () => {
  assert.equal((await readFile(speechWav)).toString('ascii', 0, 4), 'RIFF');
  const source = await pcmAudio(speechWav); assert.ok(energy(source, 0.5, 0.8) > 0.05); assert.ok(energy(source, 2, 3) < 0.001);
  const result = await createRecap(media(), [{ path: speechClip, speech: { start: 0.4, end: 1 } }], join(root, 'qa-speech.mp4'), options, context());
  assert.ok(Math.abs(result.duration - 1.2) < 0.06);
  assert.deepEqual(result.segments, [{ inputIndex: 0, trimStart: 0.25, duration: 1.2, start: 0 }]);
  const pcm = await pcmAudio(result.path); assert.ok(energy(pcm, 0.4, 0.6) > 0.04); assert.ok(Math.abs(frequency(pcm, 0.4, 0.6) - 990) < 20);
  assert.ok(energy(pcm, 0, 0.1) < 0.002, 'keep the original 0.15 second lead before speech');
  assert.equal('cues' in result, false, 'window metadata cannot invent word-level captions');
});

test('recap reports original input indices and exact clocks for clamped, minimum and capped speech windows', async () => {
  const result = await createRecap(media(), [inputs[0], { path: speechClip, speech: { start: 0.4, end: 1 } },
    { path: inputs[2].path, speech: { start: 0, end: 1 } }, { path: longSpeechClip, speech: { start: 0.2, end: 5.8 } }], join(root, 'qa-clock.mp4'), options, context());
  assert.deepEqual(result.segments, [
    { inputIndex: 1, trimStart: 0.25, duration: 1.2, start: 0 },
    { inputIndex: 2, trimStart: 0, duration: 1.35, start: 1.2 },
    { inputIndex: 3, trimStart: 0.05, duration: 4.5, start: 2.55 },
  ]);
  assert.ok(Math.abs(result.duration - 7.05) < 0.06);
  const last = result.segments[2]; assert.ok(last.trimStart + last.duration < 5.8, 'the capped window must not imply retention of all dialogue');
  const pcm = await pcmAudio(result.path);
  for (const [start, end, tone] of [[0.4, 0.6, 990], [1.4, 1.8, 660], [3.1, 3.5, 880]]) assert.ok(Math.abs(frequency(pcm, start, end) - tone) < 20);
  assert.ok(energy(pcm, 2.25, 2.5) < 0.002, 'pad the short source through its 0.35 second speech tail');
});

test('recap segment clocks follow rendered frame boundaries without accumulating fractional-window drift', async () => {
  const result = await createRecap(media(), [{ path: speechClip, speech: { start: 0.413, end: 1.123 } },
    { path: speechClip, speech: { start: 0.4, end: 1 } }, { path: speechClip, speech: { start: 0.413, end: 1.123 } }], join(root, 'qa-fractional.mp4'), options, context());
  assert.deepEqual(result.segments.map(segment => [segment.start, segment.duration]), [[0, 1.2], [1.2, 1.2], [2.4, 1.2]]);
  assert.deepEqual(result.segments.map(segment => segment.trimStart), [0.263, 0.25, 0.263]);
  assert.ok(Math.abs(result.duration - 3.6) < 0.06);
  const pcm = await pcmAudio(result.path);
  assert.ok(energy(pcm, 2.42, 2.5) < 0.002); assert.ok(energy(pcm, 2.65, 2.8) > 0.04, 'third speech follows the returned clock');
});

test('recap without QA retains the documented tail fallback and exposes its source window', async () => {
  const result = await createRecap(media(), [{ path: speechClip }], join(root, 'no-qa.mp4'), options, context());
  assert.deepEqual(result.segments, [{ inputIndex: 0, trimStart: 1.5, duration: 4.5, start: 0 }]);
  assert.ok(energy(await pcmAudio(result.path), 0.5, 4) < 0.002);
});

test('invalid supplied QA never silently falls back to the tail or replaces the previous output', async () => {
  const output = join(root, 'bad-qa.mp4'); const previous = Buffer.from('previous completed recap'); await writeFile(output, previous);
  const beforeFiles = (await readdir(root)).sort();
  for (const speech of [null, {}, { start: -0.1, end: 1 }, { start: 1, end: 1 }, { start: 2, end: 1 }, { start: 0, end: 7 },
    { start: NaN, end: 1 }, { start: 0, end: Infinity }, { start: '0', end: 1 }]) {
    await assert.rejects(createRecap(media(), [{ path: speechClip, speech } as RecapInput], output, options, context()), /speech|QA/i);
    assert.deepEqual(await readFile(output), previous);
  }
  assert.deepEqual((await readdir(root)).sort(), beforeFiles);
});
