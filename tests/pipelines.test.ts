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

test('affiliate image steps retain product and host references while video waits for its scene anchor', () => {
  const steps = api().pipelineSteps(project({ productAssetIds: ['product-photo'], characters: [{ id: 'host', name: 'Host', description: 'Presenter', assetId: 'host-photo' }], shots: [{ id: 'one', prompt: 'Demonstrate the product', duration: 2, characterIds: ['host'] }] }, 'affiliate'));
  assert.deepEqual(steps.map(step => step.refIds), [['product-photo', 'host-photo'], []]);
  assert.throws(() => api().pipelineSteps(project({ productAssetIds: 'wrong', script: 'Product' }, 'affiliate')), /product|array|reference/i);
});

test('global visual style and custom style text reach generated frames and clips', () => {
  const steps = api().pipelineSteps(project({ style: 'watercolor', styleText: 'Soft paper texture', shots: [{ id: 'one', prompt: 'A lake', videoPrompt: 'Slow pan', duration: 1 }] }));
  for (const step of steps) { assert.ok(step.prompt.includes('watercolor')); assert.ok(step.prompt.includes('Soft paper texture')); }
});

test('native Affiliate prompts carry the exact edit budget and keep silent inserts free of voice direction', () => {
  const source = project({ affiliate: { hostMode: 'presenter' }, nativeAudio: true,
    characters: [{ id: 'host', name: 'Presenter', description: 'White shirt', voiceProfile: 'Female northern accent' }],
    shots: [{ id: 'spoken', prompt: 'Show the socks', duration: 3.333, dialogue: 'Đây là tất chữ C.', speaker: 'host' },
      { id: 'insert', prompt: 'Turn the sock cuff', duration: 2.375, characterIds: ['host'] }] }, 'affiliate');
  const clips = api().pipelineSteps(source).filter(step => step.kind === 'video');
  assert.match(clips[0].prompt, /3\.333 seconds/);
  assert.match(clips[0].prompt, /action and dialogue immediately/);
  assert.match(clips[0].prompt, /Đây là tất chữ C\./);
  assert.match(clips[0].prompt, /Female northern accent/);
  assert.match(clips[1].prompt, /2\.375 seconds/);
  assert.match(clips[1].prompt, /No human speech/);
  assert.doesNotMatch(clips[1].prompt, /Stable voice:|Only the intended host speaks|Voice: female|final spoken word|requested dialogue/);
  assert.deepEqual(clips.map(step => [step.duration, step.dialogue]), [[3.333, 'Đây là tất chữ C.'], [2.375, undefined]]);
});

test('Affiliate timing changes preserve legacy native Film reference prompts', () => {
  const video = api().pipelineSteps(project({ nativeAudio: true, characters: [{ id: 'host', name: 'Host', description: 'White shirt', voiceProfile: 'Legacy Film voice' }], shots: [{ id: 'silent', prompt: 'A silent reaction', duration: 3, characterIds: ['host'] }] })).find(step => step.kind === 'video')!;
  assert.match(video.prompt, /Stable voice: Legacy Film voice/); assert.match(video.prompt, /Silent visual action/);
  assert.doesNotMatch(video.prompt, /The edit uses 3\.000 seconds/);
});

test('legacy shots retain their requested action when no separate motion prompt was provided', () => {
  for (const data of [
    { shots: [{ id: 'pour', prompt: 'Tilt the teapot and pour tea into the cup', duration: 2 }] },
    { script: 'Tilt the teapot and pour tea into the cup' }
  ]) {
    const video = api().pipelineSteps(project(data)).find(step => step.kind === 'video')!;
    assert.match(video.prompt, /Tilt the teapot and pour tea into the cup/);
    assert.match(video.prompt, /single scene anchor/);
  }
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
  assert.deepEqual(steps.map(step => [step.kind, step.start, step.duration]), [
    ['image', 1, 0.75], ['video', 1, 0.75], ['speech', 1, 0.75], ['image', 4, 0.5], ['video', 4, 0.5]
  ]);
  assert.ok(steps[0].prompt.startsWith('Đã sửa một\n')); assert.ok(steps[3].prompt.startsWith('Đã sửa hai\n'));
  assert.equal(steps[2].prompt, 'Xin chào');
  for (const step of steps.filter(step => step.kind === 'video')) assert.match(step.prompt, /single scene anchor frame/);
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
  assert.deepEqual(plan.map(s => [s.kind, s.duration, s.refIds, s.voiceId]), [
    ['image', 2.5, ['mai-ref'], undefined],
    ['video', 2.5, [], undefined],
    ['speech', 2.5, [], 'mai-voice'],
    ['video', 3, ['existing-image'], undefined],
    ['speech', 3, [], 'override'],
    ['image', 1, [], undefined],
    ['video', 1, [], undefined]
  ]);
  assert.ok(plan[0].prompt.startsWith('Mai bên hồ\n')); assert.ok(plan[5].prompt.startsWith('Cảnh hồ\n'));
  assert.equal(plan[2].prompt, 'Xin chào'); assert.equal(plan[4].prompt, 'Chào Mai');
  for (const step of plan.filter(step => step.kind === 'video')) assert.match(step.prompt, /single scene anchor frame/);
  assert.equal(new Set(plan.map(s => s.id)).size, plan.length);
  assert.deepEqual(api().pipelineSteps(project({ shots: [{ id: 's', prompt: 'x', duration: 1, dialogue: 'y', voiceId: 'v' }] })), api().pipelineSteps(project({ shots: [{ id: 's', prompt: 'x', duration: 1, dialogue: 'y', voiceId: 'v' }] })));
});

test('reads scene shots and series episodes, rejects dangling cast and missing speech voices', () => {
  const scene = { scenes: [{ id: 'scene1', shots: [{ id: 's', prompt: 'Hoàng hôn', duration: 2 }] }] };
  assert.ok(api().pipelineSteps(project(scene))[0].prompt.startsWith('Hoàng hôn\n'));
  const series = api().pipelineSteps(project({ episodes: [{ id: 'e1', name: 'Tập 1', script: 'Biển xanh' }, { id: 'e2', name: 'Tập 2', script: 'Núi cao' }] }, 'series'));
  assert.deepEqual(series.map(s => s.kind), ['image', 'video', 'image', 'video']);
  assert.ok(series[0].prompt.startsWith('Biển xanh\n')); assert.ok(series[2].prompt.startsWith('Núi cao\n'));
  for (const step of series.filter(step => step.kind === 'video')) assert.match(step.prompt, /single scene anchor frame/);
  for (const data of [{ shots: [{ prompt: 'x', duration: 1, speaker: 'unknown' }] }, { shots: [{ prompt: 'x', duration: 1, dialogue: 'speech without voice' }] }, { scenes: [{}] }, { scenes: [] }]) assert.throws(() => api().pipelineSteps(project(data)), /speaker|character|voice|scene|required/i);
});

test('series honors edited episode scene shots and scene cast without leaking other characters', () => {
  const steps = api().pipelineSteps(project({ characters: [
    { id: 'mai', name: 'Mai', description: 'Host', assetId: 'mai-ref' },
    { id: 'nam', name: 'Nam', description: 'Guest', assetId: 'nam-ref' }
  ], episodes: [{ id: 'e1', name: 'Tập', script: 'Original script', scenes: [{ id: 'scene', characterIds: ['mai'], shots: [{ id: 's', prompt: 'Edited prompt', duration: 2.25 }] }] }] }, 'series'));
  assert.deepEqual(steps.map(step => [step.kind, step.duration, step.refIds]), [['image', 2.25, ['mai-ref']], ['video', 2.25, []]]);
  assert.ok(steps[0].prompt.startsWith('Edited prompt\n')); assert.ok(steps[0].prompt.includes('Mai: Host')); assert.ok(!steps[0].prompt.includes('Nam: Guest'));
  assert.match(steps[1].prompt, /single scene anchor frame/);
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

test('rejects a 1000-shot narrated plan whose generation expands beyond the executable step budget', () => {
  const shots = Array.from({ length: 1000 }, (_, index) => ({ id: `s${index}`, prompt: `Scene ${index}`, dialogue: 'Hello', voiceId: 'fixture', duration: 1 }));
  assert.throws(() => api().pipelineSteps(project({ shots })), /step limit/i);
});

test('local stress: validates 1000 Unicode shots repeatedly and creates bounded, stable step plans', () => {
  const started = Date.now();
  const shots = Array.from({ length: 1000 }, (_, index) => ({ id: `s${index}`, prompt: `Cảnh Việt ${index}`, duration: 1.25,
    action: `Bước tới bàn ${index}`, acting: 'Chăm chú', camera: 'Slow push in', environment: 'Hồ lúc bình minh' }));
  for (let round = 0; round < 20; round++) {
    const result = api().buildShots({ shots });
    assert.equal(result.length, 1000); assert.equal(result[999].prompt, 'Cảnh Việt 999');
    assert.deepEqual(result[999], shots[999]);
    const steps = api().pipelineSteps(project({ shots: shots.slice(0, 500) }));
    assert.equal(steps.length, 1000); assert.equal(new Set(steps.map(step => step.id)).size, 1000);
    assert.ok(steps.filter(step => step.kind === 'video').every(step => step.refIds.length === 0 && step.prompt.includes('Hồ lúc bình minh')));
  }
  console.log(JSON.stringify({ stress: 'narrative', rounds: 20, shotsPerRound: 1000, stepsPerRound: 1000, elapsedMs: Date.now() - started }));
});

test('structured shot directions survive validation with bounded UTF-8 strings', () => {
  const directions = { action: 'Mai lifts a red cup', acting: 'A hesitant smile', camera: 'Slow push in', environment: 'Quiet lakeside cafe at dawn' };
  const shot = { id: 'one', prompt: 'Mai at the table', duration: 2.75, ...directions };
  assert.deepEqual(api().buildShots({ shots: [shot] }), [shot]);
  for (const field of Object.keys(directions)) {
    for (const value of [123, null, {}, 'x'.repeat(4001), 'ế'.repeat(1334), 'bad\0text']) {
      assert.throws(() => api().buildShots({ shots: [{ ...shot, [field]: value }] }), new RegExp(field, 'i'));
    }
    assert.doesNotThrow(() => api().buildShots({ shots: [{ ...shot, [field]: 'ế'.repeat(1333) + 'x' }] }));
  }
});

test('image and video prompts independently express the frame and its anchored continuous action', () => {
  const data = { style: 'watercolor', styleText: 'Soft paper texture', product: { name: 'Red cup', material: 'ceramic', price: 125000 }, productAssetIds: ['cup-photo'],
    characters: [{ id: 'mai', name: 'Mai', description: 'Oval face, short black hair, green silk dress', assetId: 'mai-photo' },
      { id: 'nam', name: 'Nam', description: 'Square face, grey hair, white linen shirt', assetId: 'nam-photo' },
      { id: 'other', name: 'Other', description: 'UNSELECTED IDENTITY', assetId: 'other-photo' }],
    scenes: [{ id: 'cafe', location: 'Lakeside cafe', time: 'Dawn', characterIds: ['mai', 'nam'] }],
    shots: [{ id: 'one', sceneId: 'cafe', shotType: 'two', prompt: 'Mai and Nam sit across a table', videoPrompt: 'Raise the cup gently, then set it down',
      action: 'Mai lifts the red cup', acting: 'Mai hesitates; Nam watches calmly', camera: 'Slow push in', environment: 'Steam drifts above the table', duration: 3.25 }] };
  const [image, video] = api().pipelineSteps(project(data));
  assert.deepEqual(image.refIds, ['cup-photo', 'mai-photo', 'nam-photo']); assert.deepEqual(video.refIds, []);
  for (const value of ['Mai and Nam sit across a table', 'Mai lifts the red cup', 'Mai hesitates; Nam watches calmly', 'Lakeside cafe', 'Dawn', 'Oval face, short black hair, green silk dress', 'Square face, grey hair, white linen shirt', 'watercolor', 'Soft paper texture', 'ceramic', '125000', 'Steam drifts above the table']) assert.ok(image.prompt.includes(value), value);
  assert.match(image.prompt, /framing.*two|two.*framing/i);
  assert.ok(!image.prompt.includes('UNSELECTED IDENTITY')); assert.ok(!image.prompt.includes('Raise the cup gently, then set it down'));
  for (const value of ['Raise the cup gently, then set it down', 'Mai lifts the red cup', 'Mai hesitates; Nam watches calmly', 'Slow push in', 'Steam drifts above the table', 'ceramic', '125000']) assert.ok(video.prompt.includes(value), value);
  for (const contract of [/single.*anchor frame/i, /exact.*first frame/i, /face/i, /outfit/i, /background/i, /style/i, /continuous/i, /no (?:extra|additional) people/i, /no cuts/i, /no (?:on-screen )?text/i]) assert.match(video.prompt, contract);
  assert.notEqual(image.prompt, video.prompt);
});

test('video references contain only an explicit scene anchor and supplied video sources skip image generation', () => {
  for (const source of [{ assetId: 'scene-frame' }, { videoAssetId: 'source-video' }, { assetId: 'scene-frame', videoAssetId: 'source-video' }]) {
    const steps = api().pipelineSteps(project({ productAssetIds: ['product'], characters: [{ id: 'mai', name: 'Mai', description: 'Green dress', assetId: 'portrait', voiceId: 'voice' }],
      shots: [{ id: 'source', prompt: 'Mai at the lake', start: 2, duration: 1.5, speaker: 'mai', dialogue: 'Hello', ...source }] }));
    assert.deepEqual(steps.map(step => step.kind), ['video', 'speech']);
    assert.deepEqual(steps[0].refIds, source.assetId ? ['scene-frame'] : []);
    assert.equal(steps[0].videoAssetId, source.videoAssetId);
    assert.deepEqual(steps.map(step => [step.start, step.duration]), [[2, 1.5], [2, 1.5]]);
    assert.equal(steps[1].voiceId, 'voice'); assert.equal(steps[1].prompt, 'Hello');
  }
});

test('nested scenes carry their location, time and cast into the image prompt', () => {
  const [image, video] = api().pipelineSteps(project({ characters: [{ id: 'mai', name: 'Mai', description: 'Green dress', assetId: 'portrait' }],
    scenes: [{ id: 'scene', location: 'Train platform', time: 'Midnight', characterIds: ['mai'], shots: [{ id: 'one', prompt: 'Mai waits', duration: 2 }] }] }));
  for (const value of ['Train platform', 'Midnight', 'Green dress']) assert.ok(image.prompt.includes(value), value);
  assert.deepEqual(image.refIds, ['portrait']); assert.deepEqual(video.refIds, []);
});

test('native audio keeps exact dialogue, stable voices and silent listeners alongside anchor constraints', () => {
  const data = { nativeAudio: true, characters: [{ id: 'mai', name: 'Mai', description: 'Green dress', voiceProfile: 'Low northern voice' }, { id: 'nam', name: 'Nam', description: 'White shirt' }],
    shots: [{ id: 'one', prompt: 'Mai faces Nam', duration: 3, speaker: 'mai', listenerIds: ['nam'], dialogue: 'Anh về rồi à?' }, { id: 'two', prompt: 'Nam thinks', duration: 2, characterIds: ['nam'] }] };
  const steps = api().pipelineSteps(project(data)); const clips = steps.filter(step => step.kind === 'video');
  assert.equal(steps.filter(step => step.kind === 'speech').length, 0);
  for (const value of ['Mai speaks exactly: "Anh về rồi à?"', 'Listeners: Nam react naturally and remain silent.', 'Low northern voice', 'Keep natural scene sound and the requested dialogue.']) assert.ok(clips[0].prompt.includes(value), value);
  assert.match(clips[1].prompt, /Silent visual action; no invented speech/);
});

test('buildShots keeps productVisible', () => {
  const shot = { id: 'one', prompt: 'Presenter talks with empty hands', duration: 3, productVisible: false };
  assert.deepEqual(api().buildShots({ shots: [shot] }), [shot]);
  assert.equal(api().buildShots({ shots: [{ ...shot, productVisible: true }] })[0].productVisible, true);
  for (const productVisible of ['no', 0, null]) assert.throws(() => api().buildShots({ shots: [{ ...shot, productVisible }] }), /productVisible/);
});

const legacyCases = () => JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '../../tests/fixtures/legacy-affiliate-steps.json'), 'utf8')) as Array<{ project: Project; steps: unknown[] }>;
const museProject = (affiliate: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Project => {
  const source = legacyCases()[0].project;
  return { ...source, id: 'muse', data: { ...source.data, affiliate: { ...(source.data.affiliate as object), backgroundAssetId: '', pose: 'auto', ...affiliate }, affiliatePlanVersion: 2, productLook: 'A white slip-on shoe with a thick sole.', ...extra } };
};
const stepOf = (steps: ReturnType<typeof import('../src/core/pipelines').pipelineSteps>, id: string, kind: string) => steps.find(step => step.id === `muse/${id}/${kind}`)!;

test('legacy affiliate project keeps generic prompts', () => {
  for (const { project, steps } of legacyCases()) {
    assert.deepEqual(api().pipelineSteps(project), steps, project.id);
    assert.notDeepEqual(api().pipelineSteps({ ...project, data: { ...project.data, affiliatePlanVersion: 2, productLook: 'A shoe.' } }), steps, `${project.id}: the marker switches paths`);
  }
});

test('v2 project uses Muse templates', () => {
  const steps = api().pipelineSteps(museProject()), legacy = api().pipelineSteps({ ...museProject(), data: { ...museProject().data, affiliatePlanVersion: undefined } });
  for (const step of steps) {
    if (step.kind === 'image') assert.ok(step.prompt.startsWith('Vertical 9:16 frame from a short social-media product video.'), step.prompt.slice(0, 80));
    if (step.kind === 'video') assert.ok(step.prompt.startsWith('Create ONE continuous 10-second'), step.prompt.slice(0, 80));
    assert.ok(!step.prompt.includes('The edit uses'));
  }
  assert.deepEqual(steps.map(({ id, kind, duration, start, dialogue, speaker, shotType, videoAssetId }) => ({ id, kind, duration, start, dialogue, speaker, shotType, videoAssetId })),
    legacy.map(({ id, kind, duration, start, dialogue, speaker, shotType, videoAssetId }) => ({ id: id.replace('legacy-review', 'muse'), kind, duration, start, dialogue, speaker, shotType, videoAssetId })));
  assert.match(stepOf(steps, 'one', 'video').prompt, /ONLY Minh speaks/);
  assert.match(stepOf(steps, 'three', 'video').prompt, /an off-screen voice \(nobody visible speaks\)/);
});

test('v2 reference order follows Muse', () => {
  const steps = api().pipelineSteps(museProject({ backgroundAssetId: 'room' }));
  assert.deepEqual(stepOf(steps, 'one', 'image').refIds, ['p1', 'p2', 'portrait', 'room'], 'presenter with product');
  assert.deepEqual(stepOf(steps, 'three', 'image').refIds, ['p1', 'p2', 'p3', 'room'], 'product shot');
  assert.deepEqual(stepOf(steps, 'two', 'image').refIds, ['room'], 'product shot without the product');
  const hidden = museProject({ backgroundAssetId: 'room' }); (hidden.data.shots as any[])[0].productVisible = false;
  assert.deepEqual(stepOf(api().pipelineSteps(hidden), 'one', 'image').refIds, ['portrait', 'room'], 'presenter without product');
  const look = legacyCases()[1].project, lookbook = { ...look, id: 'muse', data: { ...look.data, affiliatePlanVersion: 2, productLook: 'Linen dresses.', outfitLooks: [{ name: 'Blue', description: 'A blue dress.' }, { name: 'White', description: 'A white dress.' }], affiliate: { ...(look.data.affiliate as object), backgroundAssetId: 'room' } } };
  const looks = api().pipelineSteps(lookbook);
  assert.deepEqual(stepOf(looks, 'look1', 'image').refIds, ['white', 'portrait', 'room'], 'lookbook outfit then presenter');
  assert.match(stepOf(looks, 'look1', 'image').prompt, /LOOK 2 — White/); assert.match(stepOf(looks, 'look1', 'image').prompt, /must look EXACTLY like the garment/);
  for (const step of [...steps, ...looks].filter(step => step.kind === 'video')) assert.deepEqual(step.refIds, []);
});

test('v2 appends background and pose lines only when set', () => {
  const plain = api().pipelineSteps(museProject());
  for (const step of plain.filter(step => step.kind === 'image')) assert.ok(step.prompt.split('\n').at(-1)!.startsWith('Do not add any captions'), step.id);
  const set = api().pipelineSteps(museProject({ backgroundAssetId: 'room', pose: 'sit' }));
  assert.deepEqual(stepOf(set, 'one', 'image').prompt.split('\n').slice(-2), ['Background reference image 4: use this exact room/layout and lighting.', 'Requested model pose: sit.']);
  assert.equal(stepOf(set, 'three', 'image').prompt.split('\n').at(-1), 'Background reference image 4: use this exact room/layout and lighting.');
  assert.equal(stepOf(set, 'two', 'image').prompt.split('\n').at(-1), 'Background reference image 1: use this exact room/layout and lighting.');
  for (const step of set.filter(step => step.kind === 'video')) assert.ok(!/Background reference|Requested model pose/.test(step.prompt));
});

test('v2 clip speaks numbers as words while subtitles keep the written line', () => {
  const steps = api().pipelineSteps(museProject());
  assert.match(stepOf(steps, 'one', 'video').prompt, /"Đế nâng ba xăng-ti-mét, tôn dáng!"/);
  assert.match(stepOf(steps, 'one', 'image').prompt, /"Đế nâng 3cm, tôn dáng!"/);
  assert.equal(stepOf(steps, 'one', 'video').dialogue, 'Đế nâng 3cm, tôn dáng!');
  const english = api().pipelineSteps(museProject({}, { language: 'en' }));
  assert.match(stepOf(english, 'one', 'video').prompt, /"Đế nâng 3cm, tôn dáng!"/); assert.match(stepOf(english, 'one', 'video').prompt, /in English/);
});

test('fashion and lookbook keep garment photos when productVisible is false', () => {
  const source = museProject({ contentStyle: 'fashion' });
  const shots = source.data.shots as any[]; shots[0].productVisible = false; shots[1].productVisible = false;
  const steps = api().pipelineSteps(source);
  assert.deepEqual(stepOf(steps, 'one', 'image').refIds, ['p1', 'p2', 'portrait']);
  assert.deepEqual(stepOf(steps, 'two', 'image').refIds, ['p1', 'p2', 'p3']);
  assert.match(stepOf(steps, 'two', 'image').prompt, /PRODUCT: Giày sục/); assert.ok(!stepOf(steps, 'two', 'image').prompt.includes('The product is absent'));
  const look = legacyCases()[1].project, lookbook = { ...look, id: 'muse', data: { ...look.data, affiliatePlanVersion: 2, productLook: 'Linen dresses.', shots: (look.data.shots as any[]).map(shot => ({ ...shot, productVisible: false })) } };
  const looks = api().pipelineSteps(lookbook);
  assert.deepEqual(stepOf(looks, 'look0', 'image').refIds, ['blue', 'portrait']); assert.match(stepOf(looks, 'look0', 'image').prompt, /must look EXACTLY like the garment/);
});

test('a stale marker on asmr or pov stays legacy', () => {
  const { affiliateV2 } = require('../src/shared/affiliate') as typeof import('../src/shared/affiliate');
  const { clipWindow } = require('../src/core/studio') as typeof import('../src/core/studio');
  const source = legacyCases()[0].project, speech = { duration: 10, voiced: 3, f0: null, parts: [{ start: 0.6, end: 4.4 }, { start: 7.9, end: 8.3 }] } as any;
  for (const contentStyle of ['asmr', 'pov']) {
    const legacy = { ...source, data: { ...source.data, affiliate: { ...(source.data.affiliate as object), contentStyle, hostMode: 'silent' }, shots: (source.data.shots as any[]).map(({ dialogue, speaker, ...shot }) => shot) } };
    const marked = { ...legacy, data: { ...legacy.data, affiliatePlanVersion: 2, productLook: 'A shoe.' } };
    assert.equal(affiliateV2(marked), false);
    assert.deepEqual(api().pipelineSteps(marked), api().pipelineSteps(legacy));
    assert.deepEqual(clipWindow(marked.data, 10, 3.75, speech, true), clipWindow(legacy.data, 10, 3.75, speech, true));
  }
  assert.equal(affiliateV2(museProject()), true); assert.equal(affiliateV2(source), false);
});
