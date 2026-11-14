import test from 'node:test';
import assert from 'node:assert/strict';
import { budget, extractJson, cleanLines, defaultCamera, direct, DirectorIncomplete, toPlan } from '../src/core/director';
import type { IO, Shot, State } from '../src/core/director';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { StudioService } from '../src/core/studio';
import type { Project, Task, TaskContext } from '../src/shared/studio';

// Contract recovered from MuseStudio 1.13.12 (filmstudio.pyc / app.js fmScenes, fmActs, clean_lines, FM_CAM_DEFAULT).

test('budget follows the recovered shot formula and scene ranges per pace', () => {
  assert.deepEqual(budget(2, 'flow'), { shots: 25, scenes: [1, 2] });   // ceil(120/4.8)=25; 120s → 1–2 scenes
  assert.deepEqual(budget(1, 'flow'), { shots: 13, scenes: [1, 1] });   // ceil(60/4.8)=13
  assert.deepEqual(budget(5, 'drama'), { shots: 84, scenes: [4, 6] });  // ceil(300/3.6)=84; 300s → round(300/75)..round(300/50)
  assert.deepEqual(budget(3, 'tight').shots, 40);                        // ceil(180/4.6)=40
});

test('extractJson finds the object whose key is a list inside prose and code fences', () => {
  assert.deepEqual(extractJson('Đây:\n```json\n{"shots":[{"id":1}]}\n```', 'shots'), { shots: [{ id: 1 }] });
  assert.deepEqual(extractJson('trước {"a":1} rồi {"shots":[]} xong', 'shots'), { shots: [] });
  assert.deepEqual(extractJson('[{"id":1}]', 'shots'), { shots: [{ id: 1 }] });
  assert.equal(extractJson('{"note":"x"}', 'shots'), null);
  assert.equal(extractJson('không có json', 'shots'), null);
  assert.deepEqual(extractJson('{"shots":[{"t":"a } b"}]}', 'shots'), { shots: [{ t: 'a } b' }] }, 'braces inside strings');
});

test('extractJson bounds malformed reply work and rejects oversized UTF-8 before accepting a prefix', () => {
  const start = performance.now();
  assert.equal(extractJson('['.repeat(40000), 'shots'), null);
  assert.ok(performance.now() - start < 750, 'unclosed delimiters must not rescan every suffix');
  assert.equal(extractJson('{"shots":[]}' + '中'.repeat(180000), 'shots'), null, 'the entire reply must fit the 512 KiB UTF-8 bound');
  assert.deepEqual(extractJson('broken {oops} then {"shots":[{"text":"quoted \\\" [ }"}]}', 'shots'), { shots: [{ text: 'quoted " [ }' }] });
});

test('cleanLines accepts recovered aliases, truncates and repairs speakers/listeners', () => {
  const cast = new Set(['mai', 'nam']);
  assert.deepEqual(cleanLines([{ dialogue: 'Xin chào', character: 'mai', listener: 'nam', delivery: 'vui' }], cast, false),
    [{ speaker: 'mai', to: 'nam', text: 'Xin chào', emotion: 'vui' }]);
  assert.equal(cleanLines([{ text: 'x'.repeat(300), speaker: 'mai' }], cast, false)[0].text.length, 220);
  assert.equal(cleanLines([{ text: 'a', speaker: 'mai', emotion: 'e'.repeat(200) }], cast, false)[0].emotion!.length, 120);
  assert.equal(cleanLines([{ text: 'Ai đó', speaker: 'ghost' }], cast, false)[0].speaker, 'mai', 'unknown speaker falls back to a known character');
  assert.equal(cleanLines([{ text: 'Tự nói', speaker: 'mai', to: 'mai' }], cast, false)[0].to, '', 'self listener cleared');
  assert.equal(cleanLines([{ text: 'Kể', speaker: 'narrator' }], cast, true)[0].speaker, 'narrator');
  assert.equal(cleanLines(Array.from({ length: 5 }, (_, i) => ({ text: `L${i}`, speaker: 'mai' })), cast, false).length, 3, 'recovered MAX_LINES+1 bound');
  assert.deepEqual(cleanLines([{ text: '   ', speaker: 'mai' }, 'chỉ có chữ'], cast, false), [{ speaker: 'mai', to: '', text: 'chỉ có chữ' }]);
});

test('defaultCamera mirrors the recovered per-type defaults', () => {
  assert.deepEqual(['establish', 'two', 'single', 'reaction', 'pov', 'insert'].map(t => defaultCamera(t as never)),
    ['pan_r', 'static', 'static', 'push', 'push', 'static']);
});

// ---- orchestration: a scripted completer stands in for Muse only inside automated tests (no paid calls in `make test`).
type Reply = unknown;
function makeIO(replies: Record<string, Reply>) {
  const turns: string[] = []; const saves: State[] = [];
  const io: IO = {
    async complete(turn) {
      turns.push(turn);
      if (!(turn in replies)) throw new Error(`unexpected turn ${turn}`);
      const r = replies[turn]; return typeof r === 'string' ? r : JSON.stringify(r);
    },
    save(state) { saves.push(structuredClone(state)); },
  };
  return { io, turns, saves };
}
const shot = (id: number, extra: Record<string, unknown> = {}) => ({ id, type: 'single', visual: `v${id}`, motion: `m${id}`, face: `f${id}`, characters: ['mai'], lines: [{ speaker: 'mai', to: 'nam', text: `L${id}` }], ...extra });
const shots = (a: number, b: number) => ({ shots: Array.from({ length: b - a + 1 }, (_, i) => shot(a + i)) });
const cast = [{ id: 'mai', name: 'Mai', look: 'áo dài xanh', voice: 'nữ trẻ' }, { id: 'nam', name: 'Nam', look: 'sơ mi trắng', voice: 'nam trầm' }];
const bible = (scenes = [{ id: 's1', title: 'A', characters: ['mai', 'nam'], a: 1, b: 7 }, { id: 's2', title: 'B', characters: ['mai', 'nam'], a: 8, b: 13 }]) =>
  ({ title: 'Hồ Sen', characters: cast, locations: [{ id: 'l1', name: 'Hồ' }], scenes });
const ok = { shots: [], issues: [], fixed: 0 };
const settings = { idea: 'Mai gặp lại Nam bên hồ sau mười năm', minutes: 1, pace: 'flow' as const, lang: 'vi' };
const count = (s: State) => Object.keys(s.shots).length;

test('director writes bible then each scene in order, saving after every step', async () => {
  const { io, turns, saves } = makeIO({ bible: bible(), 'scene:s1': shots(1, 7), 'scene:s2': shots(8, 13), review: ok });
  const state = await direct(settings, io);
  assert.deepEqual(turns, ['bible', 'scene:s1', 'scene:s2', 'review']);
  assert.equal(count(state), 13); assert.equal(state.done, true);
  assert.deepEqual(saves.map(count).slice(0, 3), [0, 7, 13], 'persist after bible and after each scene');
  assert.equal(state.shots['1'].camera, 'static'); assert.equal(state.shots['1'].scene, 's1'); assert.equal(state.shots['9'].scene, 's2');
});

test('resume skips the bible and completed scenes without asking Muse again', async () => {
  const prior: State = { bible: bible() as never, shots: {} };
  for (const s of shots(1, 7).shots) prior.shots[String(s.id)] = { ...s, scene: 's1' } as Shot;
  const { io, turns } = makeIO({ 'scene:s2': shots(8, 13), review: ok });
  const state = await direct(settings, io, prior);
  assert.deepEqual(turns, ['scene:s2', 'review']); assert.equal(count(state), 13);
});

test('missing shot IDs are requested again instead of rewriting the scene', async () => {
  const { io, turns } = makeIO({ bible: bible(), 'scene:s1': shots(1, 5), 'scene:s1:missing:1': shots(6, 7), 'scene:s2': shots(8, 13), review: ok });
  const state = await direct(settings, io);
  assert.ok(turns.includes('scene:s1:missing:1')); assert.equal(count(state), 13);
});

test('a script still incomplete after retries keeps partial progress, skips review and reports missing IDs', async () => {
  const { io, turns, saves } = makeIO({ bible: bible(), 'scene:s1': shots(1, 5), 'scene:s1:missing:1': { shots: [] }, 'scene:s1:missing:2': { shots: [] }, 'scene:s2': shots(8, 13) });
  await assert.rejects(direct(settings, io), (error: unknown) => error instanceof DirectorIncomplete && (error as DirectorIncomplete).missing.join(',') === '6,7');
  assert.equal(count(saves.at(-1)!), 11, 'partial shots persisted before failing');
  assert.equal(turns.includes('review'), false, 'never review/produce media for a truncated script');
});

test('review applies only the changed fields, records fixes and hook, then verifies until clean', async () => {
  const { io, turns } = makeIO({ bible: bible(), 'scene:s1': shots(1, 7), 'scene:s2': shots(8, 13),
    review: { shots: [{ id: 3, visual: 'NEW' }], issues: ['khó hiểu'], fixed: 1, hook: 3 }, 'verify:1': ok });
  const state = await direct(settings, io);
  assert.equal(state.shots['3'].visual, 'NEW'); assert.equal(state.shots['3'].motion, 'm3', 'unchanged fields kept');
  assert.equal(state.shots['4'].visual, 'v4'); assert.equal(state.review!.fixed, 1); assert.equal(state.review!.hook, 3);
  assert.ok(turns.includes('verify:1'));
});

test('verify applies returned corrections even when a positive fixed count is reported', async () => {
  const { io } = makeIO({ bible: bible(), 'scene:s1': shots(1, 7), 'scene:s2': shots(8, 13),
    review: { shots: [], issues: ['repair frame'], fixed: 0 },
    'verify:1': { shots: [{ id: 3, visual: 'VERIFIED FRAME' }], issues: [], fixed: 1 } });
  const state = await direct(settings, io);
  assert.equal(state.shots['3'].visual, 'VERIFIED FRAME'); assert.equal(state.shots['3'].motion, 'm3');
  assert.equal(state.review!.fixed, 1); assert.deepEqual(state.review!.issues, []);
});

test('director keeps every speaker line and requires input instead of publishing a lossy shot', async () => {
  const scene = shots(1, 7); scene.shots[0].lines.push({ speaker: 'nam', to: 'mai', text: 'Important answer' });
  const { io, saves } = makeIO({ bible: bible(), 'scene:s1': scene, 'scene:s2': shots(8, 13), review: ok });
  await assert.rejects(direct(settings, io), (error: Error) => error.name === 'NeedsInputError' && /speaker|người nói|thoại/i.test(error.message));
  const saved = saves.at(-1)!;
  assert.deepEqual(saved.shots['1'].lines.map(line => line.text), ['L1', 'Important answer']);
  assert.notEqual(saved.done, true);
});

test('unparseable review is retried once, then marked skipped while the script is kept', async () => {
  const { io } = makeIO({ bible: bible(), 'scene:s1': shots(1, 7), 'scene:s2': shots(8, 13), review: 'xin lỗi tôi không làm được', 'review:retry': 'vẫn không' });
  const state = await direct(settings, io);
  assert.equal(state.review!.skipped, true); assert.equal(state.shots['3'].visual, 'v3'); assert.equal(state.done, true);
});

test('non-contiguous bible ranges are re-partitioned locally and flagged', async () => {
  const gap = bible([{ id: 's1', title: 'A', characters: ['mai'], a: 1, b: 5 }, { id: 's2', title: 'B', characters: ['mai'], a: 9, b: 13 }]);
  const { io } = makeIO({ bible: gap, 'scene:s1': shots(1, 7), 'scene:s2': shots(8, 13), review: ok });
  const state = await direct(settings, io);
  assert.deepEqual(state.bible!.scenes.map(s => [s.a, s.b]), [[1, 7], [8, 13]]);
  assert.ok(state.lint!.some(w => /scene|cảnh/i.test(w)));
});

test('contiguous short or oversized bible ranges are repaired to exactly the approved shot budget', async () => {
  for (const end of [2, 14, 2 ** 32 + 1]) {
    const input = bible([{ id: 's1', title: 'A', characters: ['mai'], a: 1, b: end }]); const requested: string[] = [];
    const io: IO = { async complete(turn, prompt) {
      requested.push(turn);
      if (turn === 'bible') return JSON.stringify(input);
      if (turn === 'scene:s1') { assert.match(prompt, /shot IDs 1–13/); return JSON.stringify(shots(1, 13)); }
      return JSON.stringify(ok);
    }, save() {} };
    const state = await direct(settings, io);
    assert.equal(count(state), 13); assert.deepEqual(state.bible!.scenes.map(scene => [scene.a, scene.b]), [[1, 13]]);
    assert.deepEqual(requested, ['bible', 'scene:s1', 'review']);
  }
});

test('resumed bible ranges are bounded before another scene request and stale budget changes require input', async () => {
  const prior: State = { bible: bible([{ id: 's1', title: 'A', characters: ['mai'], a: 1, b: 2 ** 32 + 1 }]) as never, shots: {} };
  const { io } = makeIO({ 'scene:s1': shots(1, 13), review: ok });
  const state = await direct(settings, io, prior); assert.equal(count(state), 13); assert.equal(state.bible!.scenes[0].b, 13);
  const stale: State = { budget: { shots: 999999, scenes: [1, 1] }, bible: bible() as never, shots: {} };
  let calls = 0;
  await assert.rejects(direct(settings, { async complete() { calls++; return ''; }, save() {} }, stale), /budget|ngân sách|shot/i);
  assert.equal(calls, 0);
  const overflow: State = { budget: budget(1), bible: bible() as never, shots: { '14': { ...shot(14), scene: 's2' } as Shot } };
  await assert.rejects(direct(settings, { async complete() { calls++; return ''; }, save() {} }, overflow), /budget|ngân sách|shot/i);
  assert.equal(calls, 0, 'old out-of-budget checkpoint shots must not survive a repaired range');
});

test('duplicate scene IDs or more scenes than approved shots stop before scene admission', async () => {
  for (const scenes of [
    [{ id: 's1', title: 'A', characters: ['mai'], a: 1, b: 7 }, { id: 's1', title: 'B', characters: ['mai'], a: 8, b: 13 }],
    Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, title: 'A', characters: ['mai'], a: i + 1, b: i + 1 })),
  ]) {
    const { io, turns } = makeIO({ bible: bible(scenes) });
    await assert.rejects(direct(settings, io), /cảnh|scene|budget/i);
    assert.deepEqual(turns, ['bible']);
  }
});

test('a manually chosen camera survives the camera pass', async () => {
  const prior: State = { bible: bible() as never, shots: {} };
  for (const s of shots(1, 7).shots) prior.shots[String(s.id)] = { ...s, scene: 's1' } as Shot;
  prior.shots['1'] = { ...prior.shots['1'], camera: 'orbit', cameraManual: true };
  const { io } = makeIO({ 'scene:s2': shots(8, 13), review: ok });
  const state = await direct(settings, io, prior);
  assert.equal(state.shots['1'].camera, 'orbit'); assert.equal(state.shots['2'].camera, 'static');
});

// ---- toPlan: directed script → the planner schema that the repo's parsePlan validates
const planState = (): State => ({
  bible: { title: 'Hồ Sen', logline: 'Mai gặp lại Nam', characters: cast, locations: [{ id: 'l1', name: 'Hồ Gươm' }],
    scenes: [{ id: 's1', title: 'Gặp lại', location: 'l1', time: 'Sáng', characters: ['mai', 'nam'], a: 1, b: 3 }] },
  shots: {
    '1': { id: 1, scene: 's1', type: 'establish', visual: 'Hồ buổi sáng', motion: 'lia chậm', face: '', characters: ['mai', 'nam'], lines: [], camera: 'pan_r' },
    '2': { id: 2, scene: 's1', type: 'single', visual: 'Cận Mai', motion: 'Mai quay sang', face: 'mắt mở to', characters: ['mai'], camera: 'static',
      lines: [{ speaker: 'mai', to: 'nam', text: 'Anh về rồi à?' }, { speaker: 'mai', to: 'nam', text: 'Mười năm rồi.' }] },
    '3': { id: 3, scene: 's1', type: 'single', visual: '', motion: 'Nam cúi đầu', face: '', characters: ['nam'], camera: 'static', lines: [{ speaker: 'narrator', to: '', text: 'Họ im lặng rất lâu.' }] },
  },
});

test('toPlan maps cast, scenes and shots into the planner schema', () => {
  const plan = toPlan(planState(), 'flow');
  assert.equal(plan.name, 'Hồ Sen'); assert.equal(plan.summary, 'Mai gặp lại Nam');
  assert.deepEqual(plan.characters[0], { id: 'mai', name: 'Mai', description: 'áo dài xanh', voiceProfile: 'nữ trẻ' });
  assert.deepEqual(plan.scenes[0], { id: 's1', name: 'Gặp lại', location: 'Hồ Gươm', time: 'Sáng', characterIds: ['mai', 'nam'] });
  const [a, b, c] = plan.shots;
  assert.equal(a.id, '1'); assert.equal(a.sceneId, 's1'); assert.equal(a.shotType, 'establish'); assert.equal(a.dialogue, undefined);
  assert.equal(b.speaker, 'mai'); assert.deepEqual(b.listenerIds, ['nam']); assert.equal(b.dialogue, 'Anh về rồi à? Mười năm rồi.', 'same-speaker lines kept whole');
  assert.ok(b.videoPrompt.includes('Mai quay sang') && b.videoPrompt.includes('mắt mở to'));
  assert.equal(c.speaker, undefined, 'narrator is not a cast member'); assert.equal(c.dialogue, 'Họ im lặng rất lâu.');
  assert.equal(c.prompt, 'Nam cúi đầu', 'an empty frame description falls back to the action');
});

test('toPlan rejects a mixed-speaker saved shot without deleting any dialogue', () => {
  const state = planState(); state.shots['2'].lines.push({ speaker: 'nam', to: 'mai', text: 'Important answer' });
  const before = structuredClone(state.shots['2'].lines);
  assert.throws(() => toPlan(state), /speaker|người nói|thoại/i);
  assert.deepEqual(state.shots['2'].lines, before);
});

test('toPlan estimates durations from pace and spoken words within the recovered bounds', () => {
  const plan = toPlan(planState(), 'flow');
  assert.equal(plan.shots[0].duration, 4.8, 'silent shot keeps the flow shot length');
  assert.ok(plan.shots[1].duration >= 2.6 && plan.shots[1].duration <= 10);
  const long = planState(); long.shots['2'].lines = [{ speaker: 'mai', to: '', text: Array(60).fill('chữ').join(' ') }];
  assert.equal(toPlan(long, 'flow').shots[1].duration, 10, 'capped at 10 seconds');
  const short = planState(); short.shots['2'].lines = [{ speaker: 'mai', to: '', text: 'Ừ.' }];
  assert.equal(toPlan(short, 'flow').shots[1].duration, 2.6, 'flow minimum');
  assert.equal(toPlan(short, 'drama').shots[1].duration, 1.6, 'drama minimum');
  assert.equal(toPlan(planState(), 'drama').shots[0].duration, 3.6, 'silent drama shot');
});

// ---- supplied cast and MaiStudio limits (parsePlan rejects removed cast, >12 characters, over-long fields)
test('a supplied cast keeps its IDs first even when the bible omits them', async () => {
  const onlyNam = { ...bible(), characters: [{ id: 'nam', name: 'Nam', look: 'sơ mi trắng', voice: 'nam trầm' }] };
  const { io, turns } = makeIO({ bible: onlyNam, 'scene:s1': shots(1, 7), 'scene:s2': shots(8, 13), review: ok });
  const state = await direct({ ...settings, cast: [{ id: 'mai', name: 'Mai', description: 'Ảnh của khách: áo dài xanh' }] }, io);
  assert.deepEqual(state.bible!.characters.map(c => c.id), ['mai', 'nam']);
  assert.equal(state.bible!.characters[0].look, 'Ảnh của khách: áo dài xanh');
  assert.ok(turns[0] === 'bible');
});

test('the bible prompt carries the supplied cast so Muse writes the story around them', async () => {
  let biblePrompt = '';
  const io: IO = { async complete(turn, prompt) { if (turn === 'bible') { biblePrompt = prompt; return JSON.stringify(bible()); } return JSON.stringify(turn === 'review' ? ok : turn === 'scene:s1' ? shots(1, 7) : shots(8, 13)); }, save() {} };
  await direct({ ...settings, cast: [{ id: 'mai', name: 'Mai', description: 'áo dài xanh' }] }, io);
  assert.ok(biblePrompt.includes('"id":"mai"') && biblePrompt.includes('áo dài xanh'));
});

test('bible characters are capped at the 12-character limit', async () => {
  const many = { ...bible(), characters: Array.from({ length: 15 }, (_, i) => ({ id: `c${i}`, name: `N${i}`, look: 'x', voice: 'y' })) };
  many.scenes = many.scenes.map(s => ({ ...s, characters: ['c0'] }));
  const { io } = makeIO({ bible: many, 'scene:s1': shots(1, 7), 'scene:s2': shots(8, 13), review: ok });
  const state = await direct(settings, io);
  assert.equal(state.bible!.characters.length, 12);
});

test('toPlan bounds field lengths to the planner limits', () => {
  const s = planState(); s.bible!.characters[0].voice = 'v'.repeat(5000); s.bible!.scenes[0].time = 't'.repeat(5000);
  const plan = toPlan(s, 'flow');
  assert.equal(plan.characters[0].voiceProfile!.length, 4000); assert.equal(plan.scenes[0].time!.length, 4000);
});

// ---- studio integration: film planning runs the director through the logged-in Muse profile or the configured model
const kindOf = (prompt: string) => prompt.includes('planning a short film') ? 'bible' : /shot IDs \d+–\d+/.test(prompt) ? 'scene' : prompt.includes('re-reading this whole script') ? 'review' : 'other';
function directorAnswer(prompt: string): string {
  const total = Number(/exactly (\d+) shots/.exec(prompt)?.[1]); const range = /shot IDs (\d+)–(\d+)/.exec(prompt);
  if (kindOf(prompt) === 'bible') return JSON.stringify({ title: 'Hồ Sen', characters: cast, locations: [{ id: 'l1', name: 'Hồ' }], scenes: [{ id: 's1', title: 'Gặp lại', location: 'l1', characters: ['mai', 'nam'], a: 1, b: total }] });
  if (range) return JSON.stringify({ shots: Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => ({ id: Number(range[1]) + i, type: 'single', visual: `Khung ${Number(range[1]) + i}`, characters: ['mai'], lines: [{ speaker: 'mai', to: 'nam', text: 'Anh về rồi.' }] })) });
  return JSON.stringify({ shots: [], issues: [], fixed: 0, hook: 1 });
}
async function withStudio(run: (studio: StudioService, finish: (task: Task) => Promise<Task>) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-director-')); const studio = new StudioService(root);
  const finish = async (task: Task) => { for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10); return studio.store.task(task.id); };
  try { await run(studio, finish); } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
}

test('browser film planning gives each director turn its own checkpoint and resumes without asking Muse again', async () => {
  await withStudio(async (studio, finish) => {
    const asked: string[] = []; let failReview = true;
    // Stands in for the Muse page only; the real completeText resumes from its own textResult checkpoint the same way (browser.test.ts).
    studio.browsers.completeText = async (task: Task, context: TaskContext) => {
      if (typeof task.checkpoint.textResult === 'string') return task.checkpoint.textResult;
      const kind = kindOf(task.prompt);
      if (kind === 'review' && failReview) { failReview = false; throw new Error('Muse tab closed'); }
      asked.push(kind); const reply = directorAnswer(task.prompt); context.checkpoint({ remoteSubmitted: true, textResult: reply }); return reply;
    };
    const account = studio.store.saveAccount({ name: 'Muse', url: 'https://muse.ai/' });
    const p = await studio.invoke<Project>('project.save', { name: 'Hồ Sen', kind: 'film', data: { script: 'Mai gặp lại Nam bên hồ sau mười năm.', minutes: 1 } });
    const first = await finish(await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'plan', accountId: account.id }));
    assert.equal(first.status, 'failed'); assert.deepEqual(asked, ['bible', 'scene']);
    await studio.invoke('task.action', { action: 'retry', ids: [first.id] }); const done = await finish(first);
    assert.equal(done.status, 'succeeded', done.error); assert.deepEqual(asked, ['bible', 'scene', 'review'], 'resume asks only the unfinished turn');
    const data = studio.store.project(p.id).data;
    assert.equal((data.shots as unknown[]).length, 13); assert.equal((data.planning as { source: string }).source, 'muse-browser');
    assert.equal((data.director as { review: { hook: number } }).review.hook, 1);
  });
});

test('films that preserve a customer script keep the single-request planner', async () => {
  let requests = 0;
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain fixture */ }
    requests++; response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ name: 'Giữ kịch bản', characters: [{ id: 'mai', name: 'Mai', description: 'Áo xanh' }], scenes: [{ id: 'lake', name: 'Hồ' }], shots: [{ id: 'one', sceneId: 'lake', prompt: 'Mai ở hồ', duration: 3, speaker: 'mai', dialogue: 'Xin chào Nam.' }] }) } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    await withStudio(async (studio, finish) => {
      await studio.invoke('settings.save', { providers: { text: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture' } } });
      const p = await studio.invoke<Project>('project.save', { name: 'Kịch bản', kind: 'film', data: { script: 'Mai: Xin chào Nam.', keepScript: true } });
      const task = await finish(await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'plan' }));
      assert.equal(task.status, 'succeeded', task.error); assert.equal(requests, 1);
    });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('a film beyond the 1,000-shot limit stops before any paid planning turn', async () => {
  await withStudio(async (studio, finish) => {
    let calls = 0; studio.browsers.completeText = async () => { calls++; return '{}'; };
    const account = studio.store.saveAccount({ name: 'Muse', url: 'https://muse.ai/' });
    const p = await studio.invoke<Project>('project.save', { name: 'Dài', kind: 'film', data: { script: 'Một sử thi rất dài.', minutes: 90 } });
    const task = await finish(await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'plan', accountId: account.id }));
    assert.equal(task.status, 'waiting_input'); assert.match(`${task.error} ${task.message}`, /1\.?000/); assert.equal(calls, 0);
  });
});

test('toPlan output passes the planner validator even without an optional logline', () => {
  const { parsePlan } = require('../src/core/planning') as typeof import('../src/core/planning');
  const s = planState(); delete s.bible!.logline;
  const project: Project = { id: 'p', name: 'Hồ Sen', kind: 'film', data: {}, createdAt: 1, updatedAt: 1 };
  assert.doesNotThrow(() => parsePlan(JSON.stringify(toPlan(s, 'flow')), project));
});

test('oversized local director review prompts never record remote submission or unknown acceptance on retry', async () => {
  let requests = 0;
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    requests++; const prompt = JSON.parse(body).messages[0].content;
    assert.ok(requests <= 2, 'the oversized review must never reach the provider');
    const answer = kindOf(prompt) === 'bible' ? bible([{ id: 's1', title: 'A', characters: ['mai'], a: 1, b: 13 }])
      : { shots: Array.from({ length: 13 }, (_, i) => shot(i + 1, { visual: 'v'.repeat(3000) })) };
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    await withStudio(async (studio, finish) => {
      await studio.invoke('settings.save', { providers: { text: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture' } } });
      const project = await studio.invoke<Project>('project.save', { name: 'Bounded director', kind: 'film', data: { script: 'Mai gặp Nam.', minutes: 1 } });
      const first = await finish(await studio.invoke<Task>('studio.run', { projectId: project.id, stage: 'plan' }));
      assert.equal(first.status, 'failed');
      assert.equal(Object.hasOwn(first.checkpoint.turns as object, 'review'), false);
      assert.match(first.error, /Director turn prompt/);
      await studio.invoke('task.action', { action: 'retry', ids: [first.id] }); const retry = await finish(first);
      assert.equal(retry.status, 'failed'); assert.match(retry.error, /Director turn prompt/);
      assert.equal(Object.hasOwn(retry.checkpoint.turns as object, 'review'), false);
      assert.equal(requests, 2, 'reuse successful bible/scene turns; neither retry invents remote acceptance');
    });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('retrying an incomplete script asks Muse again for the shots that are still missing', async () => {
  const first = makeIO({ bible: bible(), 'scene:s1': shots(1, 5), 'scene:s1:missing:1': { shots: [] }, 'scene:s1:missing:2': { shots: [] }, 'scene:s2': shots(8, 13) });
  await assert.rejects(direct(settings, first.io), DirectorIncomplete);
  // A new repair round gets fresh turn IDs, so cached empty replies of the exhausted round are not replayed.
  const second = makeIO({ 'scene:s1:missing:r1:1': shots(6, 7), review: ok });
  const state = await direct(settings, second.io, first.saves.at(-1)!);
  assert.deepEqual(second.turns, ['scene:s1:missing:r1:1', 'review']); assert.equal(count(state), 13);
});
