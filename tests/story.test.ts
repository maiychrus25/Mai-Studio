import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Cue } from '../src/core/media';

interface SourceCue { i: number; start: number; end: number; text: string }
const fixture = JSON.parse(readFileSync(join(__dirname, '../../tests/fixtures/storyvoice.json'), 'utf8')) as {
  sourceSha256: { storyvoice: string; srt: string };
  split: Array<{ input: string; expected: string[] }>;
  timings: Array<{ lines: string[]; durations: number[]; expected: { cues: SourceCue[]; offsets: number[]; total: number } }>;
  groups: Array<{ cues: SourceCue[]; target: number; expected: Array<{ id: number; cue_from: number; cue_to: number; start: number; end: number; text: string }> }>;
  align: Array<{ name: string; sentences: string[]; segs: Array<{ start: number; end: number }>; asrTexts?: string[]; expected: SourceCue[] }>;
  alignStress: Array<{ anchored: boolean; sentences: number; sha256: string }>;
};
const story = () => require('../src/core/story') as { splitStory(value: string): string[]; cuesFromDurations(lines: string[], durations: number[]): { cues: Cue[]; offsets: number[]; total: number }; groupNarration(cues: Cue[], target: number): Array<{ id: number; cueFrom: number; cueTo: number; start: number; end: number; text: string }>; alignScript(sentences: string[], segs: Array<{ start: number; end: number }>, asrTexts?: string[]): Cue[] };

test('story sentence splitting matches isolated replay of the original pure Python function, including Unicode and soft length limits', () => {
  assert.equal(fixture.sourceSha256.storyvoice, 'e65e93ebbf206c969773ad9b317c4ecb999dfd5dff0200dafa00cc8581c0e482');
  for (const item of fixture.split) assert.deepEqual(story().splitStory(item.input), item.expected);
});

test('measured narration timings match original lead-in, sentence gaps, millisecond rounding and tail', () => {
  for (const item of fixture.timings) {
    const actual = story().cuesFromDurations(item.lines, item.durations);
    assert.deepEqual(actual, { ...item.expected, cues: item.expected.cues.map(({ i, ...cue }) => ({ index: i, ...cue })) });
  }
  assert.throws(() => story().cuesFromDurations(['one'], []), /duration|count|khớp/i);
  assert.throws(() => story().cuesFromDurations(['one'], [NaN]), /duration|finite|invalid/i);
});

test('visual groups match original SRT groups while preserving the separate narration cue clock', () => {
  for (const item of fixture.groups) {
    const cues = item.cues.map(({ i, ...cue }) => ({ index: i, ...cue }));
    assert.deepEqual(story().groupNarration(cues, item.target), item.expected.map(({ cue_from, cue_to, ...shot }) => ({ ...shot, cueFrom: cue_from, cueTo: cue_to })));
    assert.equal(cues[0].start, 0.25, 'visual lead-in must not move actual subtitle timing');
  }
});

test('source script alignment matches original speech-clock fallback and matching-block anchors', () => {
  assert.equal(typeof story().alignScript, 'function', 'alignScript must be exported');
  for (const item of fixture.align) {
    const before = JSON.stringify(item);
    assert.deepEqual(story().alignScript(item.sentences, item.segs, item.asrTexts), item.expected.map(({ i, ...cue }) => ({ index: i, ...cue })), item.name);
    assert.equal(JSON.stringify(item), before, 'alignment must not mutate script, speech spans or ASR text');
  }
});

test('source alignment rejects invalid timelines and bounds transcript matching work', () => {
  const align = story().alignScript;
  assert.equal(typeof align, 'function', 'alignScript must be exported');
  for (const segs of [[{ start: NaN, end: 1 }], [{ start: -1, end: 1 }], [{ start: 1, end: 1 }], [{ start: 0, end: 2 }, { start: 1, end: 3 }], [{ start: 0, end: Infinity }]]) {
    assert.throws(() => align(['xin'], segs), /invalid|speech|timeline/i);
  }
  assert.throws(() => align(['xin\0'], [{ start: 0, end: 1 }]), /invalid|script|text/i);
  assert.throws(() => align(['word '.repeat(4097)], [{ start: 0, end: 1 }]), /token|word|limit/i);
  assert.throws(() => align(['xin'], [{ start: 0, end: 1 }], ['word '.repeat(4097)]), /token|word|limit/i);
  assert.throws(() => align(Array(1001).fill('xin'), [{ start: 0, end: 1 }]), /limit|1000|invalid/i);
});

for (const round of fixture.alignStress) test(`source alignment stress: 1000 sentences with ${round.anchored ? 'ASR anchors' : 'speech-clock fallback'}`, () => {
  assert.equal(typeof story().alignScript, 'function', 'alignScript must be exported');
  const sentences = Array<string>(round.sentences).fill('xin');
  const segs = sentences.map((_, index) => ({ start: index * 2, end: index * 2 + 1 }));
  const actual = story().alignScript(sentences, segs, round.anchored ? sentences : undefined);
  assert.equal(actual.length, round.sentences);
  const digest = createHash('sha256').update(JSON.stringify(actual.map(cue => [cue.index, cue.start, cue.end, cue.text]))).digest('hex');
  assert.equal(digest, round.sha256, 'all 1000 cue timings must match the controlled original replay');
});
