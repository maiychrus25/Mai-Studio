import test from 'node:test';
import assert from 'node:assert/strict';

type Span = { start: number; end: number };
const api = () => require('../src/core/affiliate-fast-edit') as {
  affiliateFastEdit(shots: Array<{ clipDuration: number; window: { start: number; duration: number }; parts: Span[]; dialogue?: string }>, speed: number): {
    segments: Array<{ shot: number; trimStart: number; trimEnd: number; duration: number }>; cuts: number[]; cues: Array<{ index: number; start: number; end: number; text: string }> };
  phraseCues(text: string, parts: Span[], maxWords?: number): Array<Span & { text: string }>;
};
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const nearAll = (actual: number[], expected: number[]) => { assert.equal(actual.length, expected.length, `${actual} vs ${expected}`); actual.forEach((value, i) => near(value, expected[i])); };
const shot = (window: { start: number; duration: number }, parts: Span[], dialogue: string | undefined = 'Lời thoại') => ({ clipDuration: 10, window, parts, dialogue });
const WEAK = 'hay được để từ với × - của những là x rất có thì cho mà các một đến và không hoặc – khi'.split(' ');

test('jump cut keeps 0.08 seconds around a silence over 0.3', () => {
  const { segments } = api().affiliateFastEdit([shot({ start: 0.38, duration: 4.42 }, [{ start: 0.5, end: 1.6 }, { start: 2.4, end: 4.5 }])], 1);
  nearAll(segments.flatMap(s => [s.trimStart, s.trimEnd]), [0.38, 1.68, 2.32, 4.8]);
  assert.ok(segments.every(s => !('punch' in s) && !('pop' in s)), 'no zoom effects');
});

test('gaps up to 0.3 seconds are not cut', () => {
  const { segments } = api().affiliateFastEdit([shot({ start: 0.38, duration: 4.42 }, [{ start: 0.5, end: 1.6 }, { start: 1.9, end: 3 }])], 1);
  nearAll([segments[0].trimStart, segments.at(-1)!.trimEnd], [0.38, 4.8]);
  assert.equal(segments.length, 1);
});

test('long continuous speech stays one segment', () => {
  const { segments } = api().affiliateFastEdit([shot({ start: 0.4, duration: 8.2 }, [{ start: 0.5, end: 8.3 }])], 1);
  assert.equal(segments.length, 1);
  nearAll([segments[0].trimStart, segments[0].trimEnd], [0.4, 8.6]);
  const fast = api().affiliateFastEdit([shot({ start: 0.4, duration: 8.2 }, [{ start: 0.5, end: 8.3 }])], 1.1).segments;
  assert.equal(fast.length, 1);
  near(fast[0].duration, 8.2 / 1.1);
});

test('tiny pieces are dropped', () => {
  const { segments } = api().affiliateFastEdit([shot({ start: 0.38, duration: 4.42 }, [{ start: 0.5, end: 1.6 }, { start: 4.78, end: 6 }])], 1);
  assert.equal(segments.length, 1);
  nearAll([segments[0].trimStart, segments[0].trimEnd], [0.38, 1.68]);
});

test('silent shot is one piece and speed applies', () => {
  const { segments } = api().affiliateFastEdit([{ clipDuration: 5, window: { start: 0, duration: 3 }, parts: [] }], 1.1);
  assert.equal(segments.length, 1);
  near(segments[0].duration, 3 / 1.1);
});

test('cuts follow the output timeline', () => {
  const { segments, cuts } = api().affiliateFastEdit([shot({ start: 0, duration: 2 }, [{ start: 0.1, end: 1.9 }]), shot({ start: 0, duration: 3 }, [{ start: 0.1, end: 2.9 }])], 1.1);
  assert.equal(cuts.length, 3);
  near(cuts[0], 0);
  near(cuts[2], segments.reduce((sum, s) => sum + s.duration, 0));
  near(cuts[1], segments.filter(s => s.shot === 0).reduce((sum, s) => sum + s.duration, 0));
});

test('parts outside the window are ignored', () => {
  const { segments, cues } = api().affiliateFastEdit([shot({ start: 0.38, duration: 4.42 }, [{ start: 0.5, end: 1.6 }, { start: 7.9, end: 8.3 }], 'Một hai ba bốn')], 1);
  nearAll([segments[0].trimStart, segments.at(-1)!.trimEnd], [0.38, 4.8]);
  assert.ok(segments.every(s => s.trimEnd > s.trimStart));
  assert.equal(cues.length, 1);
  assert.ok(cues[0].end <= 1.3 + 1e-9);
});

test('phrase cues hold 2 to 6 words and follow speech parts', () => {
  const text = 'Đế nâng 3cm, tôn dáng ngay khi xỏ vào!', parts = [{ start: 0, end: 1 }, { start: 1.2, end: 2.4 }];
  const cues = api().phraseCues(text, parts);
  cues.forEach(cue => { const n = cue.text.split(' ').length; assert.ok(n >= 2 && n <= 6, cue.text); assert.ok(parts.some(p => cue.start >= p.start - 1e-9 && cue.end <= p.end + 1e-9)); });
  assert.equal(cues.map(c => c.text).join(' '), text);
});

test('phrase cuts avoid numbers, x and weak words', () => {
  const cues = api().phraseCues('Kích thước 24 x 10 x 18 cm rất gọn', [{ start: 0, end: 4 }]);
  assert.equal(cues.map(c => c.text).join(' '), 'Kích thước 24 x 10 x 18 cm rất gọn');
  cues.forEach(cue => { const last = cue.text.split(' ').pop()!; assert.ok(!/^[\d.,]+$/.test(last) && !WEAK.includes(last.toLowerCase()), cue.text); });
  const comma = api().phraseCues('Mềm, thoáng, co giãn bốn chiều thoải mái cả ngày', [{ start: 0, end: 4 }]);
  assert.ok(comma.length > 1 && /,$/.test(comma[0].text), comma.map(c => c.text).join('|'));
});

test('overlapping cues end before the next starts', () => {
  const cues = api().phraseCues('Một hai ba bốn năm sáu', [{ start: 0, end: 2 }, { start: 1.5, end: 3 }]);
  near(cues[0].end, 1.48);
  const tight = api().phraseCues('Một hai ba bốn', [{ start: 0, end: 1 }, { start: 0.1, end: 1 }]);
  near(tight[0].end, 0.2);
  const { cues: timeline } = api().affiliateFastEdit([shot({ start: 0, duration: 3 }, [{ start: 0, end: 3 }], 'Một hai ba bốn năm sáu bảy')], 1);
  assert.deepEqual(timeline.map(c => c.index), [1, 2]);
});

test('invalid input throws', () => {
  const ok = shot({ start: 0, duration: 3 }, [{ start: 0.1, end: 2 }]);
  assert.throws(() => api().affiliateFastEdit([ok], 3));
  assert.throws(() => api().affiliateFastEdit([shot({ start: 0, duration: 3 }, [{ start: NaN, end: 2 }])], 1));
  assert.throws(() => api().affiliateFastEdit([shot({ start: 8, duration: 3 }, [])], 1));
});

test('segments are whole output frames and still cover every speech part', () => {
  const edit = (api().affiliateFastEdit as unknown as (shots: unknown[], speed: number, fps: number) => ReturnType<ReturnType<typeof api>['affiliateFastEdit']>);
  const parts = [{ start: 0.5, end: 3.9 }, { start: 4.5, end: 7.58 }];
  const { segments, cuts } = edit([shot({ start: 0.38, duration: 7.5 }, parts)], 1.1, 24);
  const whole = (seconds: number) => Math.abs(seconds * 24 - Math.round(seconds * 24)) < 1e-6;
  segments.forEach(s => { assert.ok(whole(s.duration), `${s.duration * 24} frames`); near(s.duration, (s.trimEnd - s.trimStart) / 1.1); });
  cuts.forEach(cut => assert.ok(whole(cut), String(cut)));
  const spans: Span[] = [];
  for (const s of segments) { const last = spans.at(-1); if (last && Math.abs(last.end - s.trimStart) < 1e-9) last.end = s.trimEnd; else spans.push({ start: s.trimStart, end: s.trimEnd }); }
  for (const part of parts) assert.ok(spans.some(span => span.start <= part.start && span.end >= part.end), `${JSON.stringify(part)} in ${JSON.stringify(spans)}`);
  assert.equal(segments.length, 2, 'one jump cut, no zoom splits');
  for (const fps of [0, 23.976, NaN]) assert.throws(() => edit([shot({ start: 0.38, duration: 7.5 }, parts)], 1.1, fps), /fps/);
});

test('phrase cues never leave a single word alone', () => {
  const text = 'Mềm thoáng co giãn bốn chiều thoải mái cả ngày dài';
  const cues = api().phraseCues(text, [{ start: 0, end: 0.15 }, { start: 0.6, end: 3.5 }]);
  cues.forEach(cue => assert.ok(cue.text.split(' ').length >= 2, cue.text));
  assert.equal(cues.map(c => c.text).join(' '), text);
  assert.deepEqual(api().phraseCues('Mua', [{ start: 0, end: 0.3 }, { start: 0.6, end: 1 }]).map(c => c.text), ['Mua']);
});

test('the word split between speech parts keeps compound words together', () => {
  const cues = api().phraseCues('Rất tiện lợi khi đi du lịch', [{ start: 0, end: 0.6 }, { start: 0.8, end: 2.8 }]);
  assert.ok(cues.some(cue => / ?tiện lợi/.test(cue.text)), cues.map(c => c.text).join('|'));
  assert.equal(cues.map(c => c.text).join(' '), 'Rất tiện lợi khi đi du lịch');
});
