import test from 'node:test';
import assert from 'node:assert/strict';
import type { Project } from '../src/shared/studio';

// Require inside each test so missing implementations produce test failures in RED.
const api = () => require('../src/core/pipelines') as typeof import('../src/core/pipelines');
const project = (data: Record<string, unknown>, kind: Project['kind'] = 'film'): Project =>
  ({ id: 'project', name: 'Phim', kind, data, createdAt: 0, updatedAt: 0 });

test('preserves explicit shot prompts, decimal durations and narration metadata', () => {
  const shots = [{ id: 's1', prompt: 'Ánh sáng Hà Nội', duration: 2.375, dialogue: 'Xin chào', speaker: 'c1', voiceId: 'v1', assetId: 'a1' }];
  assert.deepEqual(api().buildShots({ shots, script: 'must not replace prompt' }), shots);
});

test('derives shots from SRT cues and accented script paragraphs without invented content', () => {
  assert.deepEqual(api().buildShots({ subtitle: '1\n00:00:01,250 --> 00:00:03,750\nCà phê Việt\n\n2\n00:00:04,000 --> 00:00:05,000\nXin chào!' }).map(s => [s.prompt, s.duration]), [['Cà phê Việt', 2.5], ['Xin chào!', 1]]);
  assert.deepEqual(api().buildShots({ script: 'Đà Nẵng\nbiển xanh\n\nHà Nội' }).map(s => s.prompt), ['Đà Nẵng\nbiển xanh', 'Hà Nội']);
  assert.deepEqual(api().buildShots({ product: { name: 'Cà phê', price: 125000, origin: 'Đắk Lắk' } }).map(s => s.prompt), ['name: Cà phê\nprice: 125000\norigin: Đắk Lắk']);
});

test('SRT absolute cue starts survive shot building and every executable step', () => {
  const subtitle = '1\n00:00:01,000 --> 00:00:02,000\nCảnh một\n\n2\n00:00:04,000 --> 00:00:05,000\nCảnh hai';
  assert.deepEqual(api().buildShots({ subtitle }).map(shot => [shot.start, shot.duration]), [[1, 1], [4, 1]]);
  const steps = api().pipelineSteps(project({ subtitle, voiceId: 'narrator' }, 'srt'));
  assert.deepEqual(steps.map(step => [step.kind, step.start, step.duration]), [
    ['image', 1, 1], ['video', 1, 1], ['speech', 1, 1],
    ['image', 4, 1], ['video', 4, 1], ['speech', 4, 1]
  ]);
});

test('raw shots align omitted starts to source subtitles while preserving edited prompts and durations', () => {
  const subtitle = '1\n00:00:01,000 --> 00:00:02,000\nOriginal one\n\n2\n00:00:04,000 --> 00:00:05,000\nOriginal two';
  const shots = [{ id: 'a', prompt: 'Đã sửa một', duration: 0.75, dialogue: 'Xin chào', voiceId: 'voice' }, { id: 'b', prompt: 'Đã sửa hai', duration: 0.5 }];
  assert.deepEqual(api().buildShots({ shots, subtitle }), [{ ...shots[0], start: 1 }, { ...shots[1], start: 4 }]);
  const steps = api().pipelineSteps(project({ shots, subtitle }));
  assert.deepEqual(steps.map(step => [step.prompt, step.start, step.duration]), [
    ['Đã sửa một', 1, 0.75], ['Đã sửa một', 1, 0.75], ['Xin chào', 1, 0.75], ['Đã sửa hai', 4, 0.5], ['Đã sửa hai', 4, 0.5]
  ]);
  assert.throws(() => api().buildShots({ shots: shots.slice(0, 1), subtitle }), /count|match|cue/i);
  assert.throws(() => api().pipelineSteps(project({ shots: shots.slice(0, 1), subtitle })), /count|match|cue/i);
});

test('raw explicit starts override cue starts and invalid or overlapping shot times are rejected', () => {
  const subtitle = '1\n00:00:01,000 --> 00:00:02,000\nOriginal';
  const shots = [{ id: 'a', prompt: 'Edited', duration: 0.5, start: 2.25 }];
  assert.deepEqual(api().buildShots({ shots, subtitle }), shots);
  for (const start of [-1, NaN, Infinity, '1']) assert.throws(() => api().buildShots({ shots: [{ prompt: 'x', duration: 1, start }] }), /start|time|invalid/i);
  for (const starts of [[1, 1.5], [4, 1]]) assert.throws(() => api().buildShots({ shots: starts.map(start => ({ prompt: 'x', duration: 1, start })) }), /overlap|order|time/i);
  const sequential = api().pipelineSteps(project({ shots: [{ prompt: 'x', duration: 1 }, { prompt: 'y', duration: 2 }] }));
  assert.ok(sequential.every(step => !Object.hasOwn(step, 'start')));
});

test('rejects empty, malformed, over-limit narrative input instead of fake generations', () => {
  for (const input of [{}, { script: '  ' }, { shots: {} }, { shots: [] }, { shots: [{ prompt: 'x', duration: NaN }] }, { shots: [{ prompt: 'x', duration: '2' }] }, { shots: [{ prompt: 'x', duration: 0 }] }, { shots: [{ prompt: 'x', duration: Infinity }] }, { product: {} }, { episodeCount: -1, script: 'x' }, { shots: Array.from({ length: 1001 }, () => ({ prompt: 'x', duration: 1 })) }]) {
    assert.throws(() => api().buildShots(input), /invalid|required|limit|duration|shots|product|episode/i);
  }
});

test('validates characters and episodes without changing supplied prose or duplicating ids', () => {
  const characters = [{ id: 'c1', name: 'Mai', description: 'Áo dài', assetId: 'portrait', voiceId: 'voice' }];
  assert.deepEqual(api().validateCharacters(characters), characters);
  assert.deepEqual(api().validateCharacters(undefined), []);
  assert.deepEqual(api().validateEpisodes([{ id: 'e1', name: 'Tập một', script: 'Giữ nguyên\n kịch bản.' }]), [{ id: 'e1', name: 'Tập một', script: 'Giữ nguyên\n kịch bản.' }]);
  for (const value of [{}, [{ name: 'missing id' }], [...characters, ...characters], [{ id: 'c1', name: 'Mai', description: 'x', assetId: 12 }]]) assert.throws(() => api().validateCharacters(value), /character|invalid|duplicate/i);
  for (const value of [undefined, {}, [], [{ id: 'e1', name: 'Tập', script: '' }], [{ id: 'e', name: 'Tập', script: 'x' }, { id: 'e', name: 'Tập', script: 'y' }]]) assert.throws(() => api().validateEpisodes(value), /episode|invalid|duplicate|required/i);
});

test('plans executable image, video and speech steps with references scoped to the speaker', () => {
  const plan = api().pipelineSteps(project({ characters: [
    { id: 'mai', name: 'Mai', description: 'Host', assetId: 'mai-ref', voiceId: 'mai-voice' },
    { id: 'nam', name: 'Nam', description: 'Guest', assetId: 'nam-ref', voiceId: 'nam-voice' }
  ], shots: [
    { id: 'a', prompt: 'Mai bên hồ', duration: 2.5, speaker: 'mai', dialogue: 'Xin chào' },
    { id: 'b', prompt: 'Nam trên phố', duration: 3, speaker: 'nam', dialogue: 'Chào Mai', voiceId: 'override', assetId: 'existing-image' },
    { id: 'c', prompt: 'Cảnh hồ', duration: 1 }
  ] }));
  assert.deepEqual(plan.map(s => [s.kind, s.prompt, s.duration, s.refIds, s.voiceId]), [
    ['image', 'Mai bên hồ', 2.5, ['mai-ref'], undefined],
    ['video', 'Mai bên hồ', 2.5, ['mai-ref'], undefined],
    ['speech', 'Xin chào', 2.5, [], 'mai-voice'],
    ['video', 'Nam trên phố', 3, ['existing-image', 'nam-ref'], undefined],
    ['speech', 'Chào Mai', 3, [], 'override'],
    ['image', 'Cảnh hồ', 1, [], undefined],
    ['video', 'Cảnh hồ', 1, [], undefined]
  ]);
  assert.equal(new Set(plan.map(s => s.id)).size, plan.length);
  assert.deepEqual(api().pipelineSteps(project({ shots: [{ id: 's', prompt: 'x', duration: 1, dialogue: 'y', voiceId: 'v' }] })), api().pipelineSteps(project({ shots: [{ id: 's', prompt: 'x', duration: 1, dialogue: 'y', voiceId: 'v' }] })));
});

test('reads scene shots and series episodes, rejects dangling cast and missing speech voices', () => {
  const scene = { scenes: [{ id: 'scene1', shots: [{ id: 's', prompt: 'Hoàng hôn', duration: 2 }] }] };
  assert.equal(api().pipelineSteps(project(scene))[0].prompt, 'Hoàng hôn');
  const series = api().pipelineSteps(project({ episodes: [{ id: 'e1', name: 'Tập 1', script: 'Biển xanh' }, { id: 'e2', name: 'Tập 2', script: 'Núi cao' }] }, 'series'));
  assert.deepEqual(series.map(s => s.prompt), ['Biển xanh', 'Biển xanh', 'Núi cao', 'Núi cao']);
  for (const data of [{ shots: [{ prompt: 'x', duration: 1, speaker: 'unknown' }] }, { shots: [{ prompt: 'x', duration: 1, dialogue: 'speech without voice' }] }, { scenes: [{}] }, { scenes: [] }]) assert.throws(() => api().pipelineSteps(project(data)), /speaker|character|voice|scene|required/i);
});

test('series honors edited episode scene shots and scene cast without leaking other characters', () => {
  const steps = api().pipelineSteps(project({ characters: [
    { id: 'mai', name: 'Mai', description: 'Host', assetId: 'mai-ref' },
    { id: 'nam', name: 'Nam', description: 'Guest', assetId: 'nam-ref' }
  ], episodes: [{ id: 'e1', name: 'Tập', script: 'Original script', scenes: [{ id: 'scene', characterIds: ['mai'], shots: [{ id: 's', prompt: 'Edited prompt', duration: 2.25 }] }] }] }, 'series'));
  assert.deepEqual(steps.map(step => [step.prompt, step.duration, step.refIds]), [['Edited prompt', 2.25, ['mai-ref']], ['Edited prompt', 2.25, ['mai-ref']]]);
});

test('narrative limits apply to UTF-8 bytes, derived durations and total executable steps', () => {
  assert.throws(() => api().buildShots({ script: 'ế'.repeat(12000) }), /limit|prompt/i);
  assert.throws(() => api().buildShots({ subtitle: '1\n00:00:00,000 --> 02:00:00,000\nLong scene' }), /duration|limit/i);
  assert.throws(() => api().pipelineSteps(project({ shots: Array.from({ length: 501 }, (_, i) => ({ id: String(i), prompt: 'x', duration: 1 })) })), /limit/i);
  assert.throws(() => api().buildShots({ shots: [{ id: 'a', prompt: 'x', duration: 1 }, { id: 'a', prompt: 'y', duration: 2 }] }), /duplicate/i);
  const characters = Array.from({ length: 17 }, (_, index) => ({ id: `c${index}`, name: 'Cast', description: 'Reference', assetId: `a${index}` }));
  assert.throws(() => api().pipelineSteps(project({ characters, scenes: [{ characterIds: characters.map(character => character.id), shots: [{ prompt: 'Group', duration: 1 }] }] })), /reference|limit/i);
});

test('product planning retains supplied structured facts and never fabricates sales claims', () => {
  const shots = api().buildShots({ product: { name: 'Áo', attributes: { color: 'Đỏ', size: 'M' }, images: ['local-image'] } });
  assert.equal(shots[0].prompt, 'name: Áo\nattributes: {"color":"Đỏ","size":"M"}\nimages: ["local-image"]');
  assert.throws(() => api().buildShots({ product: { price: Infinity } }), /product|invalid/i);
});

test('local stress: validates 1000 Unicode shots repeatedly and creates bounded, stable step plans', () => {
  const started = Date.now();
  const shots = Array.from({ length: 1000 }, (_, index) => ({ id: `s${index}`, prompt: `Cảnh Việt ${index}`, duration: 1.25 }));
  for (let round = 0; round < 20; round++) {
    const result = api().buildShots({ shots });
    assert.equal(result.length, 1000); assert.equal(result[999].prompt, 'Cảnh Việt 999');
    const steps = api().pipelineSteps(project({ shots: shots.slice(0, 500) }));
    assert.equal(steps.length, 1000); assert.equal(new Set(steps.map(step => step.id)).size, 1000);
  }
  console.log(JSON.stringify({ stress: 'narrative', rounds: 20, shotsPerRound: 1000, stepsPerRound: 1000, elapsedMs: Date.now() - started }));
});
