import test from 'node:test';
import assert from 'node:assert/strict';
import type { Project } from '../src/shared/studio';

const project = (data: Record<string, unknown> = {}): Project => ({ id: 'film', name: 'Film', kind: 'film', data, createdAt: 1, updatedAt: 1 });
const planner = () => require('../src/core/planning') as { planningPrompt(project: Project): string; parsePlan(value: string, project: Project): Record<string, unknown> };
const result = () => ({
  name: 'Cuộc gặp', summary: 'Mai gặp Nam tại hồ.',
  characters: [{ id: 'mai', name: 'Mai', description: 'Áo dài xanh, tóc đen', voiceProfile: 'Nữ trẻ, giọng Bắc trong trẻo' }, { id: 'nam', name: 'Nam', description: 'Áo sơ mi trắng', voiceProfile: 'Nam trung niên, giọng Bắc trầm' }],
  scenes: [{ id: 'lake', name: 'Bên hồ', location: 'Hồ Hà Nội', time: 'Sáng', characterIds: ['mai', 'nam'] }],
  shots: [{ id: 'one', sceneId: 'lake', shotType: 'single', prompt: 'Mai bên hồ, Nam ở phía phải khung hình', duration: 3.7, speaker: 'mai', listenerIds: ['nam'], characterIds: ['mai', 'nam'], dialogue: 'Xin chào Nam.' }, { id: 'two', sceneId: 'lake', shotType: 'reaction', prompt: 'Nam quay sang Mai', duration: 2.4, characterIds: ['nam'] }],
});

test('AI plan is structured, preserves cast/voice/listener/scene metadata and produces native-dialogue steps', () => {
  const data = planner().parsePlan('```json\n' + JSON.stringify(result()) + '\n```', project({ script: 'Mai gặp Nam', ratio: '9:16', style: 'cinematic' }));
  assert.equal((data.shots as Array<{ duration: number }>)[0].duration, 3.7);
  assert.equal((data.characters as Array<{ voiceProfile: string }>)[0].voiceProfile, 'Nữ trẻ, giọng Bắc trong trẻo');
  assert.equal(data.ratio, '9:16'); assert.equal(data.nativeAudio, true);
  const steps = (require('../src/core/pipelines') as typeof import('../src/core/pipelines')).pipelineSteps(project(data));
  assert.equal(steps.filter(step => step.kind === 'speech').length, 0, 'native Muse dialogue must not require a TTS API');
  const clip = steps.find(step => step.kind === 'video')!;
  assert.ok(clip.prompt.includes('Xin chào Nam.')); assert.ok(clip.prompt.includes('Nữ trẻ, giọng Bắc trong trẻo'));
});

test('planning request includes supplied story/product settings and demands a reviewable JSON plan rather than local text splitting', () => {
  const prompt = planner().planningPrompt(project({ script: 'Một câu chuyện', minutes: 2, language: 'vi', ratio: '9:16', keepScript: true, product: { name: 'Áo', price: '250.000đ' } }));
  for (const value of ['Một câu chuyện', '250.000đ', '9:16', 'voiceProfile', 'listenerIds', 'characters', 'shots']) assert.ok(prompt.includes(value), value);
  assert.ok(prompt.includes('120')); assert.ok(prompt.includes('JSON'));
});

test('invalid model plans reject unknown cast, unsupported asset/file references, bad timing and malformed output', () => {
  const unknown = result(); unknown.shots[0].speaker = 'outsider';
  const invalidTime = result(); invalidTime.shots[0].duration = -1;
  const missingScene = result(); missingScene.shots[0].sceneId = 'nowhere';
  const rawFile = { ...result(), characters: [{ id: 'mai', name: 'Mai', description: 'x', assetId: '/etc/passwd' }] };
  const fabricatedAsset = { ...result(), shots: [{ id: 'one', prompt: 'x', duration: 2, assetId: '00000000-0000-0000-0000-000000000000' }] };
  for (const input of ['not JSON', '[]', JSON.stringify({ shots: [] }), JSON.stringify(unknown), JSON.stringify(invalidTime), JSON.stringify(missingScene), JSON.stringify(rawFile), JSON.stringify(fabricatedAsset)]) assert.throws(() => planner().parsePlan(input, project()), /JSON|plan|cast|character|speaker|scene|asset|duration|shot|invalid/i);
});

test('keep-script rejects rewritten or reordered dialogue and SRT input retains the original cue timing', () => {
  const source = project({ script: 'Mai: Xin chào Nam.', keepScript: true });
  assert.doesNotThrow(() => planner().parsePlan(JSON.stringify(result()), source));
  const rewritten = result(); rewritten.shots[0].dialogue = 'Tôi đã viết lại câu này.';
  assert.throws(() => planner().parsePlan(JSON.stringify(rewritten), source), /script|dialogue|thoại|kịch bản/i);
  const timed = project({ subtitle: '1\n00:00:02,000 --> 00:00:03,500\nXin chào\n', voiceId: 'voice' });
  const value = { characters: [], scenes: [], shots: [{ id: 'cue-1', prompt: 'Một bông hoa', duration: 99, dialogue: 'changed' }] };
  const data = planner().parsePlan(JSON.stringify(value), timed); const shot = (data.shots as Array<{ start: number; duration: number; dialogue: string }>)[0];
  assert.deepEqual([shot.start, shot.duration, shot.dialogue], [2, 1.5, 'Xin chào']);
});

test('keep-script preserves unlabelled supplied dialogue instead of accepting an unrelated rewrite', () => {
  const source = project({ script: 'Xin chào Nam.', keepScript: true }); const raw = result();
  assert.doesNotThrow(() => planner().parsePlan(JSON.stringify(raw), source));
  raw.shots[0].dialogue = 'Completely different words.';
  assert.throws(() => planner().parsePlan(JSON.stringify(raw), source), /script|dialogue|thoại|kịch bản/i);
  const spoken = 'Xem hướng dẫn: https://example.com.'; raw.shots[0].dialogue = spoken;
  assert.doesNotThrow(() => planner().parsePlan(JSON.stringify(raw), project({ script: spoken, keepScript: true })), 'ordinary punctuation must not be mistaken for a speaker label');
});

test('planner asks for independent still and continuous anchor prompts plus structured directions', () => {
  const prompt = planner().planningPrompt(project());
  for (const field of ['action', 'acting', 'camera', 'environment']) assert.ok(prompt.includes(`"${field}"`), field);
  for (const contract of [/framing/i, /visible action/i, /location/i, /time/i, /full.*character description/i, /single.*anchor frame/i, /face/i, /outfit/i, /background/i, /no cuts/i, /no (?:extra|additional) people/i, /no (?:on-screen )?text/i, /4000/i]) assert.match(prompt, contract);
});

test('parsePlan preserves bounded shot directions and rejects invalid fields before publishing', () => {
  const directions = { action: 'Lift the cup', acting: 'Hesitant smile', camera: 'Slow push in', environment: 'Steam above a quiet table' };
  const raw = result(); Object.assign(raw.shots[0], directions);
  const data = planner().parsePlan(JSON.stringify(raw), project());
  for (const [key, value] of Object.entries(directions)) assert.equal((data.shots as Record<string, unknown>[])[0][key], value);
  for (const field of Object.keys(directions)) {
    for (const value of [null, 42, 'x'.repeat(4001), 'ế'.repeat(1334), 'bad\0text']) {
      const invalid = result(); Object.assign(invalid.shots[0], { [field]: value });
      assert.throws(() => planner().parsePlan(JSON.stringify(invalid), project()), new RegExp(field, 'i'));
    }
  }
});

test('new plans enable bounded image and video review for every studio kind without overriding explicit opt-outs', () => {
  for (const kind of ['film', 'series', 'affiliate', 'srt', 'studio', 'dub'] as Project['kind'][]) {
    const source = project(); source.kind = kind;
    if (kind === 'series') source.data.episodes = [{ id: 'e1', name: 'Episode', script: 'A lake' }];
    const data = planner().parsePlan(JSON.stringify(result()), source);
    assert.deepEqual([data.autoChecks, data.videoReview, data.qualityRetries], [true, true, 1], kind);
    const optedOut = planner().parsePlan(JSON.stringify(result()), { ...source, data: { ...source.data, autoChecks: false, videoReview: false, qualityRetries: 0 } });
    assert.deepEqual([optedOut.autoChecks, optedOut.videoReview, optedOut.qualityRetries], [false, false, 0]);
  }
  for (const qualityRetries of [0, 1, 2]) assert.equal(planner().parsePlan(JSON.stringify(result()), project({ qualityRetries })).qualityRetries, qualityRetries);
  for (const qualityRetries of [-1, 3, 0.5, '1', null, false, Infinity, NaN]) assert.throws(() => planner().parsePlan(JSON.stringify(result()), project({ qualityRetries })), /qualityRetries|quality retries/i);
});
