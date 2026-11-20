import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { StudioService } from '../src/core/studio';
import type { Project, Task, TaskContext, TaskResult } from '../src/shared/studio';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=', 'base64');
type CharacterPort = { executeCharacters(task: Task, project: Project, context: TaskContext): Promise<TaskResult> };
async function fixture(handler: http.RequestListener, run: (studio: StudioService) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'mai-character-resume-')), studio = new StudioService(root), server = http.createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await studio.invoke('settings.save', { providers: { image: { baseUrl: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/v1`, model: 'fixture' } } });
    await run(studio);
  } finally { await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
}
function reply(res: http.ServerResponse) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] })); }
function project(studio: StudioService) { return studio.store.saveProject({ name: 'Portrait resume', kind: 'film', data: { style: 'watercolor', styleText: 'soft light', characters: [{ id: 'actor', name: 'Actor', description: 'Blue shirt' }], shots: [{ id: 'one', prompt: 'Actor walks', duration: 1, characterIds: ['actor'] }] } }); }
async function finished(studio: StudioService, task: Task) { for (let i = 0; i < 1000; i++) { const current = studio.store.task(task.id); if (!['draft', 'queued', 'running'].includes(current.status)) return current; await delay(5); } throw new Error('Controlled pipeline timed out'); }
function portrait(studio: StudioService, p: Project): string { return (studio.store.project(p.id).data.production as any).characterImages.actor; }
function taskFor(studio: StudioService, p: Project, force = false) { return studio.store.createTasks({ projectId: p.id, kind: 'pipeline', prompts: ['Characters'], input: { stage: 'characters', projectSnapshot: p, ...(force ? { force: true } : {}) } })[0]; }
function characters(studio: StudioService, p: Project, task: Task, signal = new AbortController().signal) { return (studio as unknown as CharacterPort).executeCharacters(studio.store.task(task.id), p, { signal, progress() {}, checkpoint(value) { studio.store.updateTask(task.id, { checkpoint: { ...studio.store.task(task.id).checkpoint, ...value } }); } }); }

test('actual all-stage retry keeps a newer forced portrait instead of restoring its completed older checkpoint', async () => {
  let portraits = 0;
  await fixture(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    assert.ok(['/v1/images/generations', '/v1/images/edits'].includes(req.url!));
    if (req.url === '/v1/images/generations' && JSON.parse(raw).prompt.startsWith('Create a clear full-body character')) portraits++; reply(res);
  }, async studio => {
    const p = project(studio), all = await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'all' });
    const stopped = await finished(studio, all); assert.equal(stopped.status, 'waiting_input', stopped.error); assert.equal(portraits, 1); const a = portrait(studio, p);
    const forced = await finished(studio, await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'characters', force: true }));
    assert.equal(forced.status, 'succeeded', forced.error); const b = portrait(studio, p); assert.notEqual(a, b); assert.equal(portraits, 2);
    await studio.invoke('task.action', { action: 'retry', ids: [all.id] }); await finished(studio, all);
    assert.equal(portrait(studio, p), b); assert.equal(portraits, 2);
    assert.equal((studio.store.task(all.id).checkpoint.characters as any).actor.assetId, b, 'rebased task checkpoint must retain the current portrait');
  });
});

test('completed force-task resume reuses the matching current portrait while a fresh force task still generates', async () => {
  let calls = 0;
  await fixture(async (req, res) => { for await (const _chunk of req) {} calls++; reply(res); }, async studio => {
    const p = project(studio), first = taskFor(studio, p, true); await characters(studio, p, first); const a = portrait(studio, p);
    const second = taskFor(studio, studio.store.project(p.id), true); await characters(studio, studio.store.project(p.id), second); const b = portrait(studio, p); assert.notEqual(a, b);
    await characters(studio, p, first); assert.equal(portrait(studio, p), b); assert.equal(calls, 2);
    const third = taskFor(studio, studio.store.project(p.id), true); await characters(studio, studio.store.project(p.id), third);
    assert.notEqual(portrait(studio, p), b); assert.equal(calls, 3);
  });
});

test('character signatures include style and styleText and never reuse a completed checkpoint with a different signature', async () => {
  const prompts: string[] = [];
  await fixture(async (req, res) => { let raw = ''; for await (const chunk of req) raw += chunk; prompts.push(JSON.parse(raw).prompt); reply(res); }, async studio => {
    let p = project(studio); const task = taskFor(studio, p); await characters(studio, p, task); const a = portrait(studio, p);
    const signature = (p: Project) => createHash('sha256').update(JSON.stringify({ character: (p.data.characters as unknown[])[0], style: p.data.style ?? '', styleText: p.data.styleText ?? '' })).digest('hex');
    assert.equal((studio.store.task(task.id).checkpoint.characters as any).actor.signature, signature(p));
    const current = studio.store.project(p.id); p = studio.store.saveProject({ ...current, data: { ...current.data, styleText: 'hard light' } });
    await characters(studio, p, task); assert.notEqual(portrait(studio, p), a); assert.equal(prompts.length, 2); assert.match(prompts[1], /watercolor\. hard light/);
    assert.equal((studio.store.task(task.id).checkpoint.characters as any).actor.signature, signature(p));
  });
});

test('unknown portrait admission is preserved even when another current portrait exists', async () => {
  let calls = 0;
  await fixture(async (req, res) => { for await (const _chunk of req) {} calls++; if (calls === 1) reply(res); else req.socket.destroy(); }, async studio => {
    const p = project(studio); await characters(studio, p, taskFor(studio, p)); const b = portrait(studio, p), pending = taskFor(studio, studio.store.project(p.id), true);
    await assert.rejects(characters(studio, studio.store.project(p.id), pending), /request|network|response/i); assert.equal(calls, 2);
    await assert.rejects(characters(studio, studio.store.project(p.id), pending), /đối soát|nhận|remote/i);
    assert.equal(calls, 2); assert.equal(portrait(studio, p), b); assert.equal((studio.store.task(pending.id).checkpoint.characters as any).actor.remoteSubmitted, true);
  });
});

test('explicit owned portraits stay authoritative and cancelled force generation leaves the current portrait intact', async () => {
  let calls = 0, started!: () => void; const waiting = new Promise<void>(resolve => started = resolve);
  await fixture(async (req, res) => { for await (const _chunk of req) {} calls++; if (calls === 1) reply(res); else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{'); started(); } }, async studio => {
    let p = project(studio); await characters(studio, p, taskFor(studio, p)); const b = portrait(studio, p), abort = new AbortController();
    const forced = taskFor(studio, studio.store.project(p.id), true), running = characters(studio, studio.store.project(p.id), forced, abort.signal), cancelled = assert.rejects(running, /abort/i);
    await waiting; abort.abort(); await cancelled; assert.equal(portrait(studio, p), b);
    const file = join(studio.store.root, 'explicit.png'); writeFileSync(file, png); const [explicit] = await studio.importFiles([file]);
    const current = studio.store.project(p.id); p = studio.store.saveProject({ ...current, data: { ...current.data, characters: [{ ...(current.data.characters as any[])[0], assetId: explicit.id }] } });
    await characters(studio, p, taskFor(studio, p, true)); assert.equal(portrait(studio, p), explicit.id); assert.equal(calls, 2);
  });
});

test('v2 host reference uses the Muse portrait prompt without reference images', async () => {
  const requests: Array<{ url: string; body: string }> = [];
  await fixture(async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; requests.push({ url: req.url!, body }); reply(res); }, async studio => {
    const file = join(studio.store.root, 'product.png'); writeFileSync(file, png); const [photo] = await studio.importFiles([file]);
    const legacy = studio.store.saveProject({ name: 'Host', kind: 'affiliate', data: { affiliate: { contentStyle: 'review', hostMode: 'presenter', seconds: 15 }, product: { name: 'Shirt' }, productAssetIds: [photo.id],
      characters: [{ id: 'host', name: 'Minh', description: 'Short black hair, sage green shirt', voiceProfile: 'Warm young male voice' }], shots: [{ id: 'one', prompt: 'Minh talks', duration: 3, characterIds: ['host'] }] } });
    assert.equal((await characters(studio, legacy, taskFor(studio, legacy))).outputIds.length, 1);
    assert.equal(requests.length, 1); assert.equal(requests[0].url, '/v1/images/edits'); assert.ok(requests[0].body.includes('Create a clear full-body character reference'));
    const upgraded = studio.store.saveProject({ ...studio.store.project(legacy.id), data: { ...studio.store.project(legacy.id).data, affiliatePlanVersion: 2, productLook: 'A white cotton shirt.' } });
    await characters(studio, upgraded, taskFor(studio, upgraded));
    assert.equal(requests.length, 2, 'the legacy portrait is not reused for a v2 plan'); assert.equal(requests[1].url, '/v1/images/generations');
    assert.ok(JSON.parse(requests[1].body).prompt.startsWith('Photorealistic portrait photo of a real person — Minh, the presenter of a short product video: Short black hair, sage green shirt'));
  });
});
