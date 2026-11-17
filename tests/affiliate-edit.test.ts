import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Project, Shot } from '../src/shared/studio';
import type { Cue } from '../src/core/media';

const api = () => require('../src/core/affiliate-edit') as {
  detectAffiliateBeats(path: string, ffmpegPath: string, signal: AbortSignal): Promise<number[]>;
  alignAffiliateShots(shots: Shot[], beats: number[], totalSeconds: number): Shot[];
  affiliateCaptionCues(project: Project, dialogue: Cue[]): Cue[];
  affiliatePostText(project: Project): string;
};
const ffmpeg: string = process.env.TEST_FFMPEG_PATH || require('ffmpeg-static');
const exec = promisify(execFile);
const shots = (): Shot[] => [0, 1, 2].map(index => ({ id: `shot${index}`, prompt: `Frame ${index}`, start: index * 2, duration: 2, caption: `Chữ ${index}` }));
function project(data: Record<string, unknown> = {}): Project {
  return { id: 'affiliate', name: 'Product video', kind: 'affiliate', createdAt: 1, updatedAt: 1,
    data: { affiliate: { seconds: 15, aiLabel: false, adLabel: false }, shots: shots(), ...data } };
}

test('real FFmpeg PCM pulses yield actual half-second onsets; quiet and constant audio have no invented grid', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'affiliate-beats-'));
  try {
    const samples = 8000 * 4, pulses = Buffer.alloc(samples * 4), quiet = Buffer.alloc(samples * 4), steady = Buffer.alloc(samples * 4);
    const expected = [0.5, 1, 1.5, 2, 2.5, 3, 3.5];
    for (let index = 0; index < samples; index++) {
      const time = index / 8000;
      const wave = Math.sin(2 * Math.PI * 400 * time);
      pulses.writeFloatLE(expected.some(start => time >= start && time < start + 0.06) ? wave * 0.6 : 0, index * 4);
      quiet.writeFloatLE(wave * 0.000001, index * 4); steady.writeFloatLE(wave * 0.3, index * 4);
    }
    for (const [name, pcm] of [['pulses', pulses], ['quiet', quiet], ['steady', steady]] as const) {
      const input = join(dir, `${name}.pcm`), output = join(dir, `${name}.wav`);
      await writeFile(input, pcm);
      await exec(ffmpeg, ['-v', 'error', '-f', 'f32le', '-ar', '8000', '-ac', '1', '-i', input, output], { timeout: 30000 });
      const found = await api().detectAffiliateBeats(output, ffmpeg, new AbortController().signal);
      if (name === 'pulses') {
        assert.equal(found.length, expected.length);
        found.forEach((beat, index) => assert.ok(Math.abs(beat - expected[index]) <= 0.025, `${beat} vs ${expected[index]}`));
      } else assert.deepEqual(found, []);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('beat decoding bounds source duration, rejects unsafe files, and never exposes paths or abort reasons', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'affiliate-bounds-'));
  try {
    const path = join(dir, 'private-token.wav');
    await exec(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '91', path], { timeout: 30000 });
    assert.deepEqual(await api().detectAffiliateBeats(path, ffmpeg, new AbortController().signal), []);
    const link = join(dir, 'linked.wav'); await symlink(path, link);
    await assert.rejects(api().detectAffiliateBeats(link, ffmpeg, new AbortController().signal), error => error instanceof Error && !error.message.includes(dir));
    const controller = new AbortController(); controller.abort(new Error('private-token'));
    await assert.rejects(api().detectAffiliateBeats(path, ffmpeg, controller.signal), error => error instanceof Error && error.name === 'AbortError' && !String(error).includes('private-token'));
    await writeFile(path, 'not media: private-token');
    await assert.rejects(api().detectAffiliateBeats(path, ffmpeg, new AbortController().signal), error => error instanceof Error && !String(error).includes('private-token') && !('cause' in error));
    await assert.rejects(api().detectAffiliateBeats(path, join(dir, 'private-binary'), new AbortController().signal), /decode/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('in-flight FFmpeg cancellation terminates bounded decoding with a sanitized AbortError', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'affiliate-cancel-'));
  try {
    const media = join(dir, 'input.wav'), runner = join(dir, 'slow-ffmpeg');
    await exec(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '5', media], { timeout: 30000 });
    // exec replaces this fixture process with real FFmpeg, paced at input speed for cancellation.
    await writeFile(runner, `#!/bin/sh\nexec '${ffmpeg.replace(/'/g, "'\\''")}' -re "$@"\n`, { mode: 0o700 });
    const controller = new AbortController();
    const pending = api().detectAffiliateBeats(media, runner, controller.signal);
    const timer = setTimeout(() => controller.abort('secret abort reason'), 150);
    try { await assert.rejects(pending, error => error instanceof Error && error.name === 'AbortError' && !String(error).includes('secret')); }
    finally { clearTimeout(timer); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('alignment uses nearby real beats, retains exact total, IDs and text, and leaves sparse beats unchanged', () => {
  const original = shots(), before = structuredClone(original);
  const aligned = api().alignAffiliateShots(original, [0.5, 1.9, 4.2, 5.5], 6);
  assert.deepEqual(aligned.map(shot => shot.start), [0, 1.9, 4.2]);
  assert.equal(aligned.reduce((sum, shot) => sum + shot.duration, 0), 6);
  aligned.forEach((shot, index) => {
    assert.equal(shot.id, original[index].id); assert.equal(shot.prompt, original[index].prompt); assert.equal(shot.caption, original[index].caption);
    if (index) assert.equal(aligned[index - 1].start! + aligned[index - 1].duration, shot.start);
  });
  assert.deepEqual(original, before);
  assert.deepEqual(api().alignAffiliateShots(original, [], 6), original);
  assert.deepEqual(api().alignAffiliateShots(original, [0.5, 5.5], 6), original);
});

test('alignment preserves every cut adjacent to spoken lines and enforces minimum scene length', () => {
  const spoken = shots(); spoken[1].dialogue = 'Lời thoại không được cắt ngắn';
  assert.deepEqual(api().alignAffiliateShots(spoken, [1.7, 4.3], 6), spoken);
  const short: Shot[] = [0, 1, 2].map(index => ({ id: `short${index}`, prompt: 'Still', start: index * 0.7, duration: 0.7 }));
  const aligned = api().alignAffiliateShots(short, [0.61, 1.01, 1.4], 2.1);
  assert.ok(aligned.every(shot => shot.duration >= 0.6));
  assert.equal(aligned.at(-1)!.start! + aligned.at(-1)!.duration, 2.1);
});

test('alignment rejects invalid totals, overlapping/gapped timelines, duplicate IDs and unbounded inputs', () => {
  for (const total of [NaN, Infinity, 0, 61]) assert.throws(() => api().alignAffiliateShots(shots(), [], total));
  for (const beats of [[NaN], [Infinity], [-1], [2, 1], Array<number>(1), Array.from({ length: 257 }, (_, index) => index / 10)]) assert.throws(() => api().alignAffiliateShots(shots(), beats, 6));
  for (const change of [{ start: 1 }, { start: 3 }, { duration: 0.2 }, { duration: Infinity }, { id: 'shot0' }]) {
    const bad = shots(); bad[1] = { ...bad[1], ...change }; assert.throws(() => api().alignAffiliateShots(bad, [], 6));
  }
  assert.throws(() => api().alignAffiliateShots(Array.from({ length: 17 }, (_, index) => ({ id: String(index), prompt: 'Still', duration: 1 })), [], 17));
});

test('two stress rounds preserve timeline continuity, spoken budgets and content across 400 bounded plans', () => {
  for (let round = 0; round < 2; round++) for (let iteration = 0; iteration < 200; iteration++) {
    const count = 1 + iteration % 16, total = [15, 30, 45, 60][iteration % 4];
    const bounds = Array.from({ length: count + 1 }, (_, index) => index * total / count);
    const original: Shot[] = bounds.slice(0, -1).map((start, index) => ({ id: `shot${index}`, prompt: 'Áo Việt', start,
      duration: bounds[index + 1] - start, dialogue: (index + iteration) % 5 ? '' : 'Giữ đủ câu thoại', transition: 'cut' }));
    const beats = bounds.slice(1, -1).map((time, index) => time + ((index + round) % 2 ? -0.28 : 0.31));
    const result = api().alignAffiliateShots(original, beats, total);
    assert.equal(result.length, count); assert.equal(result[0].start, 0);
    assert.equal(result.at(-1)!.start! + result.at(-1)!.duration, total);
    result.forEach((shot, index) => {
      assert.ok(shot.duration >= 0.6); assert.equal(shot.id, original[index].id); assert.equal(shot.prompt, original[index].prompt);
      // Rendering/SRT use milliseconds; decimal beat times can differ by one binary-double ULP.
      if (index) assert.equal(Math.round((result[index - 1].start! + result[index - 1].duration) * 1000), Math.round(shot.start! * 1000));
      if (shot.dialogue) { assert.equal(shot.duration, original[index].duration); assert.equal(shot.start, original[index].start); }
    });
  }
});

test('montages produce one persistent edited caption for the actual plan without layering dialogue', () => {
  const dialogue: Cue[] = [{ index: 1, start: 1, end: 2, text: 'Giọng đọc riêng' }];
  for (const contentStyle of ['asmr', 'pov']) {
    const data = project({ affiliate: { contentStyle }, affiliateCaption: 'Một caption xuyên suốt' });
    assert.deepEqual(api().affiliateCaptionCues(data, dialogue), [{ index: 1, start: 0, end: 6, text: 'Một caption xuyên suốt' }]);
  }
  assert.deepEqual(api().affiliateCaptionCues(project({ affiliate: { contentStyle: 'pov', caption: 'Chữ dự phòng' } }), []), [{ index: 1, start: 0, end: 6, text: 'Chữ dự phòng' }]);
  assert.deepEqual(api().affiliateCaptionCues(project({ affiliate: { contentStyle: 'pov', caption: 'Giọng đọc riêng' } }), dialogue), []);
  assert.deepEqual(dialogue, [{ index: 1, start: 1, end: 2, text: 'Giọng đọc riêng' }]);
});

test('ordinary captions remain disjoint and sanitized; screenText and explicit Affiliate gate all captions', () => {
  const outfits = shots(); outfits[0].caption = 'Bộ xanh'; outfits[1].caption = 'Bộ trắng'; outfits[2].caption = 'Chi tiết';
  assert.deepEqual(api().affiliateCaptionCues(project({ affiliate: { contentStyle: 'lookbook' }, shots: outfits }), []).map((cue: Cue) => cue.text), ['Bộ xanh', 'Bộ trắng', 'Chi tiết']);
  const original = shots(); original[0].caption = '{\\an9}<b>Đẹp</b> \\N\u0000áo Việt'; original[1].caption = 'Chữ 2'; original[2].caption = 'Chữ 2';
  const cues = api().affiliateCaptionCues(project({ shots: original }), [{ index: 1, start: 0, end: 2, text: 'Giọng đọc' }]);
  assert.deepEqual(cues, [{ index: 1, start: 0, end: 2, text: 'Đẹp áo Việt' }, { index: 2, start: 2, end: 6, text: 'Chữ 2' }]);
  assert.ok(!/[{}<>\\\u0000]/.test(cues[0].text));
  assert.deepEqual(api().affiliateCaptionCues(project({ affiliate: { screenText: false } }), []), []);
  assert.deepEqual(api().affiliateCaptionCues(project({ affiliate: undefined }), []), []);
  assert.deepEqual(api().affiliateCaptionCues(project({ shots: [] }), []), []);
  const duplicate = shots(); duplicate[0].caption = 'Giọng đọc';
  assert.ok(!api().affiliateCaptionCues(project({ shots: duplicate }), [{ index: 1, start: 0, end: 2, text: 'Giọng đọc' }]).some(cue => cue.text === 'Giọng đọc'));
  const oversized = shots(); oversized[0].caption = 'ế'.repeat(200);
  assert.throws(() => api().affiliateCaptionCues(project({ shots: oversized }), []), /512/);
  assert.throws(() => api().affiliateCaptionCues(project(), [{ index: 1, start: 0, end: 3, text: 'One' }, { index: 2, start: 2, end: 4, text: 'Two' }]), /timing/);
});

test('post copy separates montage text, uses selected CTA/link/labels and only supplied source date', () => {
  const data = project({ affiliate: { contentStyle: 'pov', caption: 'Overlay only', cta: 'Xem màu áo', affiliateUrl: 'https://s.shopee.vn/abc', aiLabel: true, adLabel: true },
    affiliateCaption: 'Persistent overlay', affiliatePost: { caption: 'Áo thun Việt', hashtags: ['#ÁoThun', '#Style'] },
    product: { name: 'Product name', url: 'https://shopee.vn/product/1/2', price: '112.686₫' }, productSource: { capturedAt: '2026-11-16T09:00:00.000Z', method: 'cached', taskId: 'private-task' } });
  const text = api().affiliatePostText(data);
  for (const value of ['Áo thun Việt', '#ÁoThun', '#Style', 'Xem màu áo', 'https://s.shopee.vn/abc', 'AI', 'Quảng cáo', '2026-11-16']) assert.ok(text.includes(value), value);
  assert.ok(!/Overlay only|Persistent overlay|private-task|cached|capturedAt/.test(text));
  const withoutDate = api().affiliatePostText(project({ summary: 'Tóm tắt thực tế', product: { name: 'Áo', url: 'https://shopee.vn/product/1/2', price: '112.686₫' } }));
  assert.ok(withoutDate.includes('Tóm tắt thực tế')); assert.ok(withoutDate.includes('https://shopee.vn/product/1/2'));
  assert.ok(!/\d{4}-\d{2}-\d{2}|112.686|AI|Quảng cáo/.test(withoutDate));
  assert.ok(api().affiliatePostText(project({ product: { name: 'Áo Việt' } })).includes('Áo Việt'));
  assert.equal(api().affiliatePostText(project({ affiliate: undefined })), '');
  assert.throws(() => api().affiliatePostText(project({ affiliatePost: { caption: 'Fine', hashtags: ['bad\nprivate-json'] } })));
});


test('editing the persistent ASMR or POV caption overrides the previous planned copy in the export', () => {
  for (const contentStyle of ['asmr', 'pov']) {
    const data = project({ affiliate: { contentStyle, caption: 'Caption mới đã duyệt' }, affiliateCaption: 'Caption cũ từ plan' });
    assert.deepEqual(api().affiliateCaptionCues(data, []), [{ index: 1, start: 0, end: 6, text: 'Caption mới đã duyệt' }]);
  }
});
