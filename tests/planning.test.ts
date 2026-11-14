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
