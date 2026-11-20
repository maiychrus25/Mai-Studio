import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, symlink, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

type Analysis = { duration: number; voiced: number; parts: Array<{ start: number; end: number }>; f0: number | null };
type SpeakerPoint = { id: string; speaker: string; embedding: number[] };
type SpeakerResult = { shots: Record<string, { status: 'unknown' | 'consistency_pass' | 'consistency_fail'; similarity: number | null; margin: number | null; ownCount: number }>; closePairs: Array<{ speakers: [string, string]; similarity: number }> };
const api = () => require('../src/core/acoustics') as {
  analyzeSpeech(path: string, ffmpeg: string, signal?: AbortSignal): Promise<Analysis>;
  compareTranscripts(expected: string, heard: string): { match: number; extra: number; ok: boolean };
  compareSpeakers(points: SpeakerPoint[]): SpeakerResult;
};
const ffmpeg: string = process.env.TEST_FFMPEG_PATH || require('ffmpeg-static');
const exec = promisify(execFile);

const unit = (x: number, y: number): number[] => [x, y, ...Array<number>(254).fill(0)];
const point = (id: string, speaker: string, x: number, y: number): SpeakerPoint => ({ id, speaker, embedding: unit(x, y) });

test('speaker cohort reproduces isolated original voice_report vectors with actual leave-one-out counts', () => {
  const pass = (similarity: number, margin: number | null, ownCount: number) => ({ status: 'consistency_pass', similarity, margin, ownCount });
  const fail = (similarity: number, margin: number | null, ownCount: number) => ({ status: 'consistency_fail', similarity, margin, ownCount });
  const unknown = { status: 'unknown', similarity: null, margin: null, ownCount: 0 };
  const fixtures = [
    { points: [point('a1', 'a', 1, 0)], expected: { shots: { a1: unknown }, closePairs: [] } },
    { points: [point('a1', 'a', 1, 0), point('a2', 'a', 0, 1)], expected: { shots: { a1: pass(0, null, 1), a2: pass(0, null, 1) }, closePairs: [] } },
    { points: [point('a1', 'a', 1, 0), point('a2', 'a', 1, 0), point('a3', 'a', 0, 1)], expected: { shots: { a1: pass(0.707, null, 2), a2: pass(0.707, null, 2), a3: fail(0, null, 2) }, closePairs: [] } },
    { points: [point('a1', 'a', 1, 0), point('a2', 'a', 0.6, 0.8), point('b1', 'b', 1, 0), point('b2', 'b', 1, 0)], expected: { shots: { a1: fail(0.6, -0.4, 1), a2: pass(0.6, 0, 1), b1: pass(1, 0.106, 1), b2: pass(1, 0.106, 1) }, closePairs: [{ speakers: ['a', 'b'], similarity: 0.894 }] } },
    { points: [point('a1', 'a', 1, 0), point('b1', 'b', 1, 0), point('b2', 'b', 1, 0)], expected: { shots: { a1: unknown, b1: pass(1, null, 1), b2: pass(1, null, 1) }, closePairs: [] } },
    { points: [point('a1', 'a', 1, 0), point('a2', 'a', 1, 0), point('b1', 'b', 1, 0), point('b2', 'b', 1, 0)], expected: { shots: { a1: pass(1, 0, 1), a2: pass(1, 0, 1), b1: pass(1, 0, 1), b2: pass(1, 0, 1) }, closePairs: [{ speakers: ['a', 'b'], similarity: 1 }] } },
  ];
  for (const fixture of fixtures) assert.deepEqual(api().compareSpeakers(fixture.points), fixture.expected);
  assert.deepEqual(api().compareSpeakers([]), { shots: {}, closePairs: [] });
});

test('speaker thresholds use raw scores before reporting rounded values and warn on published close-pair scores', () => {
  for (const [score, status] of [[0.5, 'consistency_pass'], [0.4996, 'consistency_fail']] as const) {
    const result = api().compareSpeakers([point('a1', 'a', 1, 0), point('a2', 'a', score, Math.sqrt(1 - score ** 2)), point('a3', 'a', score, Math.sqrt(1 - score ** 2))]);
    assert.equal(result.shots.a1.similarity, 0.5); assert.equal(result.shots.a1.status, status);
  }
  for (const [nearest, status] of [[0.6196, 'consistency_pass'], [0.6204, 'consistency_fail']] as const) {
    const result = api().compareSpeakers([point('a1', 'a', 1, 0), point('a2', 'a', 0.6, 0.8), point('b1', 'b', nearest, Math.sqrt(1 - nearest ** 2)), point('b2', 'b', nearest, Math.sqrt(1 - nearest ** 2))]);
    assert.equal(result.shots.a1.margin, -0.02); assert.equal(result.shots.a1.status, status); assert.equal(result.shots.a1.ownCount, 1);
  }
  for (const [score, warned] of [[0.8194, false], [0.8196, true], [0.82, true]] as const) {
    const result = api().compareSpeakers([point('b1', 'b', score, Math.sqrt(1 - score ** 2)), point('b2', 'b', score, Math.sqrt(1 - score ** 2)), point('a1', 'a', 1, 0), point('a2', 'a', 1, 0)]);
    assert.deepEqual(result.closePairs, warned ? [{ speakers: ['a', 'b'], similarity: 0.82 }] : []);
  }
});

test('speaker centroids are rebuilt from all peers, preserve caller data, and keep degenerate references unknown', () => {
  const points = [point('a1', 'a', 1, 0), point('a2', 'a', 0, 1), point('a3', 'a', 0, 1)];
  const before = structuredClone(points); const result = api().compareSpeakers(points);
  assert.equal(result.shots.a1.status, 'consistency_fail', 'the first clip is not an immutable seed');
  assert.equal(result.shots.a2.status, 'consistency_pass'); assert.deepEqual(points, before);
  const reordered = api().compareSpeakers([...points].reverse()); assert.deepEqual(reordered, result);
  const shared = unit(1, 0);
  const aliased = api().compareSpeakers(['a1', 'a2', 'a3'].map(id => ({ id, speaker: 'a', embedding: shared })));
  assert.ok(Object.values(aliased.shots).every(shot => shot.ownCount === 2), 'count peer clips, not distinct embedding values or array objects');
  const degenerate = api().compareSpeakers([point('a1', 'a', 0, 1), point('a2', 'a', 1, 0), point('a3', 'a', -1, 0)]);
  assert.deepEqual(degenerate.shots.a1, { status: 'unknown', similarity: null, margin: null, ownCount: 2 });
  const special = api().compareSpeakers([point('__proto__', '__proto__', 1, 0)]);
  assert.equal(Object.hasOwn(special.shots, '__proto__'), true); assert.equal(special.shots['__proto__'].status, 'unknown');
});

test('speaker input rejects duplicate shot IDs, malformed dimensions, nonfinite, unnormalized and oversized data', () => {
  const valid = point('a1', 'a', 1, 0); const compare = api().compareSpeakers;
  for (const points of [null, {}, [null], [{ ...valid, id: '' }], [{ ...valid, speaker: ' ' }], [{ ...valid, id: 'x\0' }], [{ ...valid, speaker: 'x'.repeat(257) }], [valid, valid], [{ ...valid, embedding: [1, 0] }], [{ ...valid, embedding: Array(256).fill(0) }], [{ ...valid, embedding: unit(NaN, 0) }], [{ ...valid, embedding: unit(Infinity, 0) }], [{ ...valid, embedding: unit(2, 0) }], [{ ...valid, embedding: unit(0.5, 0) }], [{ ...valid, embedding: Array(256) }], Array.from({ length: 1001 }, (_, i) => ({ ...valid, id: String(i) }))]) {
    assert.throws(() => compare(points as SpeakerPoint[]), /speaker|embedding|dimension|finite|normalized|limit|duplicate|ID/i);
  }
});

function wave(duration: number, bursts: Array<[number, number, number, number]> = [], noise = false): Buffer {
  const samples = Math.round(duration * 16000); const output = Buffer.alloc(44 + samples * 4);
  output.write('RIFF'); output.writeUInt32LE(output.length - 8, 4); output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16); output.writeUInt16LE(3, 20); output.writeUInt16LE(1, 22);
  output.writeUInt32LE(16000, 24); output.writeUInt32LE(64000, 28); output.writeUInt16LE(4, 32); output.writeUInt16LE(32, 34);
  output.write('data', 36); output.writeUInt32LE(samples * 4, 40);
  let seed = 42;
  for (let index = 0; index < samples; index++) {
    const time = index / 16000; let value = 0;
    for (const [start, end, frequency, level] of bursts) if (time >= start && time < end) value += level * Math.sin(2 * Math.PI * frequency * time);
    if (noise) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; value += (seed / 2 ** 32 - 0.5) * 0.3; }
    output.writeFloatLE(value, 44 + index * 4);
  }
  return output;
}

test('transcript scores follow ordered SequenceMatcher blocks and inclusive source thresholds', () => {
  // Fixtures calculated with Python difflib.SequenceMatcher(None, exp, got, autojunk=False).
  const fixtures: Array<[string, string, number, number, boolean]> = [
    ['Xin chào, Đà Nẵng!', 'xin chao da nang', 1, 0, true],
    ['a b c d e', 'a b c', 0.6, 0, true],
    ['a b c d e', 'a b c x y z w', 0.6, 0.8, true],
    ['a b c d e', 'a b c d e x y z w q', 1, 1, false],
    ['a b a b c', 'a b c a b', 0.6, 0.4, true],
    ['ab cd ef gh', 'ef gh ab cd', 0.5, 0.5, false],
    ['', '', 1, 0, true], ['', 'xin chào', 0, 0, false], ['xin chào', '', 0, 0, false],
  ];
  for (const [expected, heard, match, extra, ok] of fixtures) assert.deepEqual(api().compareTranscripts(expected, heard), { match, extra, ok });
  assert.deepEqual(api().compareTranscripts('Đà Nẵng'.normalize('NFD'), 'da nang'), { match: 1, extra: 0, ok: true });
});

test('expected numeric prices, sizes, decimals and units are spoken before comparison instead of discarded', () => {
  for (const [expected, heard] of [
    ['Giá 1.180.360 đồng', 'giá một triệu một trăm tám mươi nghìn ba trăm sáu mươi đồng'],
    ['24 x 10 x 18 cm', 'hai mươi tư nhân mười nhân mười tám xăng ti mét'],
    ['1,25 kg', 'một phẩy hai mươi lăm ki lô gam'],
    ['Giảm 20%', 'giảm hai mươi phần trăm'],
    ['Mã 0012', 'mã không không một hai'],
    ['Từ 5–10 cm', 'từ năm đến mười xăng ti mét'],
    ['Giá ١٢ đồng', 'giá mười hai đồng'],
  ]) assert.deepEqual(api().compareTranscripts(expected, heard), { match: 1, extra: 0, ok: true }, expected);
  assert.equal(api().compareTranscripts('Giá 1.180.360 đồng', 'giá đồng').ok, false);
  assert.equal(api().compareTranscripts('Mã A１２', 'mã A12').ok, false, 'digits inside identifiers are not spoken or silently normalized');
});

test('transcript limits bound expensive alignment and reject invalid input', () => {
  assert.throws(() => api().compareTranscripts('x'.repeat(32769), 'x'), /limit|bytes|size/i);
  assert.throws(() => api().compareTranscripts('x', null as never), /text|string/i);
  assert.throws(() => api().compareTranscripts('a '.repeat(4097), 'a'), /word|token|limit/i);
});

test('real FFmpeg mono Float32 decoding measures separated voiced lines and median pitch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mai-acoustics-'));
  try {
    const file = join(root, 'giọng $(not a command).wav');
    await writeFile(file, wave(4.6, [[0.5, 1.3, 180, 0.3], [1.65, 2.45, 180, 0.3], [3.2, 4, 180, 0.3]]));
    const result = await api().analyzeSpeech(file, ffmpeg);
    assert.equal(result.duration, 4.6); assert.equal(result.parts.length, 2);
    assert.ok(Math.abs(result.parts[0].start - 0.5) < 0.07); assert.ok(Math.abs(result.parts[0].end - 2.45) < 0.07);
    assert.ok(Math.abs(result.parts[1].start - 3.2) < 0.07); assert.ok(Math.abs(result.parts[1].end - 4) < 0.07);
    assert.ok(result.voiced > 2.4 && result.voiced < 3);
    assert.ok(result.f0 !== null && Math.abs(result.f0 - 180) < 10, `measured pitch ${result.f0}`);
    // Independently reconstructed source rules with stdlib direct autocorrelation, not original app execution.
    assert.deepEqual(result, { duration: 4.6, voiced: 2.89, parts: [{ start: 0.456, end: 2.476 }, { start: 3.156, end: 4.026 }], f0: 182 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('short audio has no full-frame evidence and keeps Python duration rounding', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mai-acoustics-short-'));
  try {
    const file = join(root, 'short.wav'); await writeFile(file, wave(0.031));
    assert.deepEqual(await api().analyzeSpeech(file, ffmpeg), { duration: 0.031, voiced: 0, parts: [], f0: null });
    await writeFile(file, wave(0.0625));
    assert.equal((await api().analyzeSpeech(file, ffmpeg)).duration, 0.062, 'Python rounds this exact binary tie to even');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('silence, low-level hum and nonperiodic noise produce no invented speech or pitch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mai-acoustics-quiet-'));
  try {
    for (const [name, content] of [['silence', wave(1)], ['hum', wave(2, [[0.5, 1.5, 180, 0.0001]])], ['noise', wave(2, [], true)]] as const) {
      const file = join(root, `${name}.wav`); await writeFile(file, content);
      const result = await api().analyzeSpeech(file, ffmpeg);
      assert.deepEqual({ parts: result.parts, voiced: result.voiced, f0: result.f0 }, { parts: [], voiced: 0, f0: null }, name);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('relative level filtering removes quiet periodic lead-ins while continuous-tone floor behavior stays source-compatible', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mai-acoustics-floor-'));
  try {
    const file = join(root, 'levels.wav');
    await writeFile(file, wave(4, [[0.2, 0.8, 180, 0.003], [1.4, 2.6, 180, 0.3]]));
    const result = await api().analyzeSpeech(file, ffmpeg);
    assert.equal(result.parts.length, 1); assert.ok(result.parts[0].start > 1.3);
    await writeFile(file, wave(1, [[0, 1, 180, 0.3]]));
    assert.equal((await api().analyzeSpeech(file, ffmpeg)).parts.length, 0, 'source floor+9 dB rejects a constant-level tone without a quiet baseline');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('find_lines splits a long group at its largest internal pause and never guesses an uninterrupted split', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mai-acoustics-lines-'));
  try {
    const file = join(root, 'long.wav');
    await writeFile(file, wave(11, [[0.4, 2.4, 180, 0.3], [2.7, 4.7, 180, 0.3], [5.15, 7.15, 180, 0.3], [7.45, 9.45, 180, 0.3]]));
    const result = await api().analyzeSpeech(file, ffmpeg);
    assert.equal(result.parts.length, 2); assert.ok(Math.abs(result.parts[0].end - 4.7) < 0.07); assert.ok(Math.abs(result.parts[1].start - 5.15) < 0.07);
    await writeFile(file, wave(16, [[2.5, 13.5, 180, 0.3]]));
    const uninterrupted = await api().analyzeSpeech(file, ffmpeg);
    assert.equal(uninterrupted.parts.length, 1); assert.ok(uninterrupted.parts[0].end - uninterrupted.parts[0].start > 9);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('actual FFmpeg resamples 48 kHz stereo and ignores no-media or malformed files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mai-acoustics-formats-'));
  try {
    const file = join(root, 'stereo.wav');
    await exec(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=if(between(t\\,0.5\\,1.5)\\,0.3*sin(2*PI*220*t)\\,0):s=48000:d=2', '-ac', '2', file]);
    const result = await api().analyzeSpeech(file, ffmpeg);
    assert.equal(result.duration, 2); assert.equal(result.parts.length, 1); assert.ok(result.f0 !== null && Math.abs(result.f0 - 220) < 10);
    await writeFile(file, 'not audio'); await assert.rejects(api().analyzeSpeech(file, ffmpeg), /FFmpeg|audio|decode/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('regular-file, size, symlink, missing binary and cancellation boundaries reject safely', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mai-acoustics-boundaries-'));
  try {
    const file = join(root, 'audio.wav'); await writeFile(file, wave(60, [[10, 40, 180, 0.3]]));
    const link = join(root, 'link.wav'); await symlink(file, link);
    await assert.rejects(api().analyzeSpeech(link, ffmpeg), /regular|symbolic|symlink/i);
    await assert.rejects(api().analyzeSpeech(root, ffmpeg), /regular|file/i);
    await assert.rejects(api().analyzeSpeech(file, join(root, 'missing-ffmpeg')), /FFmpeg|ENOENT|binary/i);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(api().analyzeSpeech(file, ffmpeg, controller.signal), /abort/i);
    const active = new AbortController(); const operation = api().analyzeSpeech(file, ffmpeg, active.signal);
    const timer = setTimeout(() => active.abort(), 15); const start = Date.now();
    try { await assert.rejects(operation, /abort/i); assert.ok(Date.now() - start < 2000); } finally { clearTimeout(timer); }
    await writeFile(file, ''); await assert.rejects(api().analyzeSpeech(file, ffmpeg), /empty|size|limit/i);
    await truncate(file, 2 * 1024 ** 3 + 1); await assert.rejects(api().analyzeSpeech(file, ffmpeg), /size|limit/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('spokenVietnamese reproduces Muse spoken lines', () => {
  const { spokenVietnamese } = require('../src/core/acoustics') as typeof import('../src/core/acoustics');
  for (const [written, spoken] of [
    ['Đế nâng 3cm, tôn dáng ngay khi xỏ vào!', 'Đế nâng ba xăng-ti-mét, tôn dáng ngay khi xỏ vào!'],
    ['Đế độn khoảng 3cm giúp tôn dáng người đi.', 'Đế độn khoảng ba xăng-ti-mét giúp tôn dáng người đi.'],
    ['Shop đạt 4.7 trên 5 từ 3925 lượt đánh giá.', 'Shop đạt bốn phẩy bảy trên năm từ ba nghìn chín trăm hai mươi lăm lượt đánh giá.'],
    ['Có ba màu trắng, đen, nâu, size 36 đến 39.', 'Có ba màu trắng, đen, nâu, size ba mươi sáu đến ba mươi chín.'],
    ['Giá trên shop từ 69.990 đồng đến 93.000 đồng.', 'Giá trên shop từ sáu mươi chín nghìn chín trăm chín mươi đồng đến chín mươi ba nghìn đồng.'],
    ['Chạm link sản phẩm trong giỏ hàng để mua nhé!', 'Chạm link sản phẩm trong giỏ hàng để mua nhé!'],
  ]) assert.equal(spokenVietnamese(written), spoken);
});
