import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioService } from '../src/core/studio';
import { MediaTools } from '../src/core/media';
import { pipelineSteps } from '../src/core/pipelines';
import type { OfflineAsr } from '../src/core/offline-asr';
import type { Project, Task, TaskContext, TaskResult } from '../src/shared/studio';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=', 'base64');
const verdict = JSON.stringify(Object.fromEntries(['scene', 'face', 'outfit'].map(key => [key, { status: 'pass', reason: 'Controlled provider observation' }])));
type ReviewPort = { executeReview(task: Task, project: Project, context: TaskContext, reuseCurrent?: boolean): Promise<TaskResult>; offline: OfflineAsr };
async function fixture(handler: http.RequestListener, run: (studio: StudioService, base: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'mai-review-')); const studio = new StudioService(root), server = http.createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(studio, `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/v1`); }
  finally { await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
}
function reply(res: http.ServerResponse) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: verdict } }] })); }
async function photo(studio: StudioService, name: string) { const path = join(studio.store.root, name + '.png'); writeFileSync(path, png); return (await studio.importFiles([path]))[0]; }
function taskFor(studio: StudioService, project: Project, shotIds?: string[]): Task { return studio.store.createTasks({ projectId: project.id, kind: 'pipeline', prompts: ['Review'], input: { stage: 'check', projectSnapshot: project, ...(shotIds ? { shotIds } : {}) } })[0]; }
function review(studio: StudioService, project: Project, task = taskFor(studio, project), signal = new AbortController().signal) {
  return (studio as unknown as ReviewPort).executeReview(studio.store.task(task.id), project, { signal, progress() {}, checkpoint(value) { studio.store.updateTask(task.id, { checkpoint: { ...studio.store.task(task.id).checkpoint, ...value } }); } });
}
async function generatedFrame(studio: StudioService): Promise<Project> {
  const frame = await photo(studio, 'first');
  let p = studio.store.saveProject({ name: 'Frame', kind: 'film', data: { shots: [{ id: 'one', prompt: 'Lake', duration: 1 }] } });
  const step = pipelineSteps(p, { speech: false }).find(step => step.kind === 'image')!;
  const fingerprint = createHash('sha256').update(JSON.stringify({ ...step, refIds: [...new Set(step.refIds)], ratio: '16:9' })).digest('hex');
  p = studio.store.saveProject({ ...p, data: { ...p.data, production: { images: { [`${p.id}/one`]: frame.id }, fingerprints: { [step.id]: fingerprint } } } });
  return p;
}
async function clip(studio: StudioService, name: string, duration = 1.2) {
  const path = join(studio.store.root, name + '.mp4');
  const result = spawnSync(require('ffmpeg-static') as string, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:r=24:d=3.5', '-f', 'lavfi', '-i', `sine=frequency=180:sample_rate=16000:duration=${duration}`, '-filter_complex', '[1:a]adelay=1000:all=1,apad=whole_dur=3.5[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '3.5', path]);
  assert.equal(result.status, 0, result.stderr.toString()); return (await studio.importFiles([path]))[0];
}

test('frame review retains the visual scene description when the clip has a separate camera instruction', async () => {
  let body = '';
  await fixture(async (req, res) => { for await (const chunk of req) body += chunk; reply(res); }, async (studio, base) => {
    await studio.invoke('settings.save', { providers: { text: { baseUrl: base } } }); const frame = await photo(studio, 'lake');
    const p = studio.store.saveProject({ name: 'Camera', kind: 'film', data: { shots: [{ id: 'one', prompt: 'A red boat beside a quiet lake', videoPrompt: 'Slow camera push', assetId: frame.id, duration: 1 }] } });
    await review(studio, p); assert.ok(body.includes('A red boat beside a quiet lake')); assert.ok(body.includes('planned product/hand/foot inserts'));
  });
});

test('review retry binds saved responses to current assets and never restores snapshot production', async () => {
  let calls = 0;
  await fixture(async (req, res) => { for await (const _chunk of req) {} calls++; reply(res); }, async (studio, base) => {
    await studio.invoke('settings.save', { providers: { text: { baseUrl: base } } });
    const p = await generatedFrame(studio), task = taskFor(studio, p); await review(studio, p, task);
    const next = await photo(studio, 'replacement'), current = studio.store.project(p.id), production = current.data.production as Record<string, unknown>;
    studio.store.saveProject({ ...current, data: { ...current.data, production: { ...production, marker: 'latest', images: { [`${p.id}/one`]: next.id } }, qualityReviews: { ...(current.data.qualityReviews as object), unrelated: { image: { status: 'unknown' } } } } });
    await review(studio, p, task);
    const latest = studio.store.project(p.id).data; assert.equal(calls, 2);
    assert.equal((latest.production as any).images[`${p.id}/one`], next.id); assert.equal((latest.production as any).marker, 'latest');
    assert.equal((latest.qualityReviews as any).unrelated.image.status, 'unknown'); assert.equal((latest.qualityReviews as any)[`${p.id}/one`].image.assetId, next.id);
  });
});

test('review commit merges latest unrelated production and reviews written during the actual HTTP request', async () => {
  let started!: () => void, release!: () => void; const waiting = new Promise<void>(resolve => started = resolve), gate = new Promise<void>(resolve => release = resolve);
  await fixture(async (req, res) => { for await (const _chunk of req) {} started(); await gate; reply(res); }, async (studio, base) => {
    await studio.invoke('settings.save', { providers: { text: { baseUrl: base } } }); const p = await generatedFrame(studio);
    const running = review(studio, p); await waiting;
    const current = studio.store.project(p.id); studio.store.saveProject({ ...current, data: { ...current.data, production: { ...(current.data.production as object), marker: 'new metadata' }, qualityReviews: { unrelated: { note: 'keep me' } } } });
    release(); await running; const data = studio.store.project(p.id).data;
    assert.equal((data.production as any).marker, 'new metadata'); assert.equal((data.qualityReviews as any).unrelated.note, 'keep me');
  });
});

test('completed review checkpoints are invalidated by prompt and reference changes while unchanged retries reuse them', async () => {
  let calls = 0;
  await fixture(async (req, res) => { for await (const _chunk of req) {} calls++; reply(res); }, async (studio, base) => {
    await studio.invoke('settings.save', { providers: { text: { baseUrl: base } } });
    const frame = await photo(studio, 'scene'), first = await photo(studio, 'portrait'), second = await photo(studio, 'new-portrait');
    let p = studio.store.saveProject({ name: 'Refs', kind: 'film', data: { characters: [{ id: 'a', name: 'Actor', description: 'Blue shirt', assetId: first.id }], shots: [{ id: 'one', prompt: 'Lake', duration: 1, assetId: frame.id, characterIds: ['a'] }] } });
    const task = taskFor(studio, p); await review(studio, p, task); await review(studio, p, task); assert.equal(calls, 1);
    p = studio.store.saveProject({ ...p, data: { ...p.data, characters: [{ ...(p.data.characters as any[])[0], assetId: second.id }] } });
    await review(studio, p, task); assert.equal(calls, 2);
    p = studio.store.saveProject({ ...p, data: { ...p.data, shots: [{ ...(p.data.shots as any[])[0], prompt: 'Edited visual plan' }] } });
    await review(studio, p, task); assert.equal(calls, 3);
    assert.equal(studio.store.task(task.id).checkpoint.outputIds, undefined, 'nested review must not short-circuit a parent all/render task');
  });
});

test('review rejects script and asset edits during HTTP without stamping old results onto changed input', async () => {
  for (const change of ['script', 'asset']) {
    let started!: () => void, release!: () => void; const waiting = new Promise<void>(resolve => started = resolve), gate = new Promise<void>(resolve => release = resolve);
    await fixture(async (req, res) => { for await (const _chunk of req) {} started(); await gate; reply(res); }, async (studio, base) => {
      await studio.invoke('settings.save', { providers: { text: { baseUrl: base } } }); const p = await generatedFrame(studio), replacement = await photo(studio, 'new');
      const running = review(studio, p), rejection = assert.rejects(running, /thay đổi|chỉnh|changed|input/i); await waiting;
      const current = studio.store.project(p.id), data = { ...current.data };
      if (change === 'script') data.shots = [{ ...(data.shots as any[])[0], prompt: 'Edited plan' }];
      else data.production = { ...(data.production as object), images: { [`${p.id}/one`]: replacement.id } };
      studio.store.saveProject({ ...current, data }); release(); await rejection;
      assert.equal(studio.store.project(p.id).data.qualityReviews, undefined);
    });
  }
});

test('stale generated media cannot receive a current-plan review and unresolved legacy submissions never resubmit', async () => {
  let calls = 0;
  await fixture((_req, res) => { calls++; reply(res); }, async (studio, base) => {
    await studio.invoke('settings.save', { providers: { text: { baseUrl: base } } }); const p = await generatedFrame(studio), task = taskFor(studio, p);
    const production = p.data.production as any;
    studio.store.saveProject({ ...p, data: { ...p.data, production: { ...production, fingerprints: {} } } });
    await assert.rejects(review(studio, p, task), /stale|cũ|chưa|khớp|tạo lại/i);
    studio.store.saveProject(p); studio.store.updateTask(task.id, { checkpoint: { reviews: { [`${p.id}/one`]: { image: { remoteSubmitted: true } } } } });
    await assert.rejects(review(studio, p, task), /đối soát|gửi|remote/i); assert.equal(calls, 0);
  });
});

test('silent-shot periodic voice is unknown without ASR and fails when actual HTTP ASR returns words', async () => {
  let asrCalls = 0;
  await fixture(async (req, res) => { assert.equal(req.url, '/v1/audio/transcriptions'); for await (const _chunk of req) {} asrCalls++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ text: 'Unexpected spoken words' })); }, async (studio, base) => {
    const video = await clip(studio, 'speech'); let p = studio.store.saveProject({ name: 'Silent', kind: 'film', data: { nativeAudio: true, shots: [{ id: 'one', prompt: 'Silent action', duration: 3.5, videoAssetId: video.id }] } });
    await review(studio, p); let speech = (studio.store.project(p.id).data.qualityReviews as any)[`${p.id}/one`].speech;
    assert.ok(speech.acoustic.voiced >= 0.8); assert.equal(speech.status, 'unknown');
    await studio.invoke('settings.save', { providers: { asr: { baseUrl: base, model: 'custom-asr' } } });
    p = studio.store.project(p.id); await review(studio, p); speech = (studio.store.project(p.id).data.qualityReviews as any)[`${p.id}/one`].speech;
    assert.equal(asrCalls, 1); assert.equal(speech.status, 'fail'); assert.equal(speech.heard, 'Unexpected spoken words'); assert.equal(speech.assetId, video.id);
  });
});

test('speaker cohort uses cropped current clips beyond the selected shot and ignores old fixed voice seeds', async t => {
  await fixture(async (req, res) => { for await (const _chunk of req) {} res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ text: 'Hello' })); }, async (studio, base) => {
    await studio.invoke('settings.save', { providers: { asr: { baseUrl: base } } });
    const clips = await Promise.all(['a1', 'a2', 'b1'].map(name => clip(studio, name))); const ids = ['one', 'two', 'three'];
    const p = studio.store.saveProject({ name: 'Cohort', kind: 'film', data: { nativeAudio: true, characters: ['a', 'b'].map(id => ({ id, name: id, description: id })), shots: clips.map((asset, i) => ({ id: ids[i], prompt: ids[i], duration: 3.5, videoAssetId: asset.id, dialogue: 'Hello', speaker: i < 2 ? 'a' : 'b' })), production: { voicePrints: { a: { assetId: 'obsolete', embedding: [-1, 0] } } }, qualityReviews: { [`placeholder`]: { note: 'keep' } } } });
    const offline = (studio as unknown as ReviewPort).offline, paths: string[] = []; t.mock.method(offline, 'ready', () => true);
    t.mock.method(offline, 'embed', async (path: string) => {
      paths.push(path); assert.ok(path.endsWith('.wav')); assert.equal(readFileSync(path).toString('ascii', 0, 4), 'RIFF');
      const probe = await new MediaTools().probe(path); assert.ok(probe.duration >= 0.8 && probe.duration < 2, `crop duration ${probe.duration}`);
      return Array.from({ length: 256 }, (_, i) => i === (paths.length < 3 ? 0 : 1) ? 1 : 0);
    });
    await review(studio, p, taskFor(studio, p, ['one'])); assert.equal(paths.length, 3); assert.ok(paths.every(path => !existsSync(path)));
    const data = studio.store.project(p.id).data, reviews = data.qualityReviews as any;
    assert.equal(reviews[`${p.id}/one`].speech.identity.status, 'consistency_pass');
    assert.equal(reviews[`${p.id}/two`].speech.identity.status, 'consistency_pass');
    assert.equal(reviews[`${p.id}/three`].speech.identity.status, 'unknown');
    assert.equal(reviews.placeholder.note, 'keep'); assert.ok(Array.isArray((data.production as any).speakerCohort.closePairs));
  });
});

test('explicit current source video overrides stale generated outputs without reviewing an old frame', async () => {
  let calls = 0;
  await fixture((_req, res) => { calls++; reply(res); }, async (studio, base) => {
    await studio.invoke('settings.save', { providers: { text: { baseUrl: base } } });
    const current = await clip(studio, 'current'), old = await clip(studio, 'old'), frame = await photo(studio, 'old-frame');
    let p = studio.store.saveProject({ name: 'Source replacement', kind: 'film', data: { nativeAudio: true, shots: [{ id: 'one', prompt: 'Silent action', duration: 3.5, videoAssetId: current.id }] } });
    p = studio.store.saveProject({ ...p, data: { ...p.data, production: { images: { [`${p.id}/one`]: frame.id }, videos: { [`${p.id}/one`]: old.id }, fingerprints: {} }, qualityReviews: { [`${p.id}/one`]: { image: { status: 'pass', assetId: frame.id } } } } });
    await review(studio, p); const saved = (studio.store.project(p.id).data.qualityReviews as any)[`${p.id}/one`];
    assert.equal(calls, 0); assert.equal(saved.image, undefined); assert.equal(saved.speech.assetId, current.id); assert.equal(saved.speech.status, 'unknown');
  });
});

test('aborting native embedding removes the cropped WAV and never commits a completed review', async t => {
  await fixture((_req, res) => res.end('{}'), async studio => {
    const asset = await clip(studio, 'cancel'), p = studio.store.saveProject({ name: 'Cancelled', kind: 'film', data: { nativeAudio: true, characters: [{ id: 'a', name: 'A', description: 'A' }], shots: [{ id: 'one', prompt: 'one', dialogue: 'Hello', speaker: 'a', duration: 3.5, videoAssetId: asset.id }] } });
    const abort = new AbortController(), paths: string[] = [], offline = (studio as unknown as ReviewPort).offline; t.mock.method(offline, 'ready', () => true);
    t.mock.method(offline, 'embed', async (path: string) => { paths.push(path); abort.abort(); abort.signal.throwIfAborted(); return []; });
    await assert.rejects(review(studio, p, taskFor(studio, p), abort.signal), /abort/i);
    assert.equal(paths.length, 1); assert.ok(paths.every(path => !existsSync(path))); assert.equal(studio.store.project(p.id).data.qualityReviews, undefined);
  });
});


test('automatic review resume keeps a fresh matching transcript instead of replaying a stale ASR response', async () => {
  let calls = 0;
  await fixture(async (req, res) => {
    for await (const _chunk of req) {} calls++;
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ text: calls === 1 ? 'Wrong words' : 'Hello' }));
  }, async (studio, base) => {
    await studio.invoke('settings.save', { providers: { asr: { baseUrl: base, model: 'custom-asr' } } });
    const video = await clip(studio, 'current-speech');
    const p = studio.store.saveProject({ name: 'Speech resume', kind: 'film', data: { nativeAudio: true, shots: [{ id: 'one', prompt: 'Lake', duration: 3.5, videoAssetId: video.id, dialogue: 'Hello' }] } });
    const original = taskFor(studio, p);
    await review(studio, p, original);
    await review(studio, p);
    assert.equal(calls, 2);
    await (studio as unknown as ReviewPort).executeReview(studio.store.task(original.id), studio.store.project(p.id), { signal: AbortSignal.timeout(20000), progress() {}, checkpoint() {} }, true);
    assert.equal(calls, 2, 'adopting the newer transcript must not submit ASR again');
    const speech = (studio.store.project(p.id).data.qualityReviews as any)[`${p.id}/one`].speech;
    assert.equal(speech.heard, 'Hello'); assert.equal(speech.status, 'pass');
  });
});


test('a completed newer checkpoint wins over an older project review after a crash before commit', async () => {
  let calls = 0;
  await fixture(async (req, res) => {
    for await (const _chunk of req) {} calls++;
    const checks = JSON.parse(verdict); if (calls === 1) checks.scene.status = 'unknown';
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(checks) } }] }));
  }, async (studio, base) => {
    await studio.invoke('settings.save', { providers: { text: { baseUrl: base } } });
    const p = await generatedFrame(studio); await review(studio, p);
    const task = taskFor(studio, p), key = `${p.id}/one`;
    await assert.rejects((studio as unknown as ReviewPort).executeReview(task, p, { signal: AbortSignal.timeout(20000), progress() {}, checkpoint(value) {
      studio.store.updateTask(task.id, { checkpoint: { ...studio.store.task(task.id).checkpoint, ...value } });
      if ((value.reviews as any)?.[key]?.image?.response) throw new Error('Simulated crash after response checkpoint');
    } }), /Simulated crash/);
    assert.equal((studio.store.project(p.id).data.qualityReviews as any)[key].image.status, 'unknown');
    await (studio as unknown as ReviewPort).executeReview(studio.store.task(task.id), studio.store.project(p.id), { signal: AbortSignal.timeout(20000), progress() {}, checkpoint() {} }, true);
    assert.equal(calls, 2); assert.equal((studio.store.project(p.id).data.qualityReviews as any)[key].image.status, 'pass');
  });
});

const spokenAffiliate = (studio: StudioService, video: string, duration: number, v2: boolean) => studio.store.saveProject({ name: 'Spoken affiliate', kind: 'affiliate', data: {
  affiliate: { contentStyle: 'review', hostMode: 'voiceover', seconds: 15 }, ...(v2 ? { affiliatePlanVersion: 2, productLook: 'A white cotton shirt.' } : {}), nativeAudio: true, product: { name: 'Shirt' },
  shots: [{ id: 'one', prompt: 'Shirt on the cabinet', duration, videoAssetId: video, dialogue: 'Áo cotton mềm mại, mặc cả ngày vẫn thoáng.', beat: 'hook', shotType: 'insert' }] } });
const speechReview = (studio: StudioService, p: Project) => (studio.store.project(p.id).data.qualityReviews as any)[`${p.id}/one`].speech;

test('truncated line fails review', async () => {
  await fixture((_req, res) => reply(res), async studio => {
    const cut = await clip(studio, 'cut-line', 2.5), p = spokenAffiliate(studio, cut.id, 3.5, true);
    await review(studio, p); const speech = speechReview(studio, p);
    assert.equal(speech.status, 'fail'); assert.match(speech.reason, /bị cắt ở cuối clip/);
  });
});

test('v2 overflow no longer fails', async () => {
  await fixture((_req, res) => reply(res), async studio => {
    const short = await clip(studio, 'long-line', 1.2);
    const legacy = spokenAffiliate(studio, short.id, 1, false); await review(studio, legacy);
    assert.equal(speechReview(studio, legacy).status, 'fail'); assert.match(speechReview(studio, legacy).reason, /vượt thời lượng shot/);
    const v2 = spokenAffiliate(studio, short.id, 1, true); await review(studio, v2); const speech = speechReview(studio, v2);
    assert.equal(speech.reason, undefined); assert.equal(speech.status, 'unknown', 'without a transcript the line stays unknown, never a pass');
  });
});

test('a v2 shot planned without the product may pass with product not_applicable', async () => {
  let bodies: string[] = [];
  const answer = JSON.stringify({ ...Object.fromEntries(['scene', 'face', 'outfit'].map(key => [key, { status: 'pass', reason: 'Controlled provider observation' }])), product: { status: 'not_applicable', reason: 'No product in the frame' } });
  await fixture(async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; bodies.push(body); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: answer } }] })); }, async (studio, base) => {
    await studio.invoke('settings.save', { providers: { text: { baseUrl: base } } }); const frame = await photo(studio, 'empty-hands');
    const project = (productVisible: boolean | undefined, v2: boolean) => studio.store.saveProject({ name: 'Absent product', kind: 'affiliate', data: {
      affiliate: { contentStyle: 'review', hostMode: 'voiceover', seconds: 15 }, ...(v2 ? { affiliatePlanVersion: 2, productLook: 'A white cotton shirt.' } : {}), product: { name: 'Shirt' }, productAssetIds: [frame.id],
      shots: [{ id: 'one', prompt: 'Hands fold a towel', duration: 3, assetId: frame.id, beat: 'problem', shotType: 'insert', ...(productVisible === undefined ? {} : { productVisible }) }] } });
    const absent = project(false, true); await review(studio, absent);
    assert.equal((studio.store.project(absent.id).data.qualityReviews as any)[`${absent.id}/one`].image.status, 'pass');
    assert.ok(bodies.some(body => body.includes('intentionally absent')));
    bodies = [];
    for (const [visible, v2] of [[true, true], [undefined, true], [false, false]] as const) {
      const other = project(visible, v2); await assert.rejects(review(studio, other), /Invalid image review status/, `${visible}/${v2}`);
      assert.ok(!bodies.some(body => body.includes('intentionally absent'))); bodies = [];
    }
  });
});
