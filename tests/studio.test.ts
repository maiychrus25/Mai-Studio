import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { generateKeyPairSync } from 'node:crypto';
import { createHub } from '../services/studio-hub';
import { createServer } from 'node:http';
import { MediaTools } from '../src/core/media';
import { StudioService } from '../src/core/studio';
import type { CodexJob, Project, StudioState, Task } from '../src/shared/studio';

test('music stage creates only real audio, reuses it and never submits again when rendering', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-music-')); const studio = new StudioService(root); let submissions = 0;
  const wav = join(root, 'music.wav'); assert.equal(spawnSync(require('ffmpeg-static') as string, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000:duration=0.5', wav]).status, 0);
  const { readFileSync } = await import('node:fs'); const audio = readFileSync(wav);
  const server = createServer((req, res) => {
    if (req.url === '/audio.wav') { res.setHeader('content-type', 'audio/wav'); res.end(audio); return; }
    if (req.url === '/submit') { submissions++; res.end('{}'); return; }
    res.setHeader('content-type', 'text/html'); res.end(`<textarea></textarea><button>Send</button><section></section><script>document.querySelector('button').onclick=async()=>{await fetch('/submit');document.querySelector('section').innerHTML='<article><audio src="/audio.wav"></audio></article>'}</script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    studio.store.setSettings({ browserVisible: false, museSelectors: { composer: 'textarea', submit: 'button', response: 'article', fileInput: 'input[type=file]', stop: '.stop' } });
    const account = studio.store.saveAccount({ name: 'fixture', url: `http://127.0.0.1:${address.port}/` });
    const p = await studio.invoke<Project>('project.save', { name: 'music', kind: 'film', data: { musicPrompt: 'Quiet instrumental piano', shots: [{ id: 'one', prompt: 'Lake', duration: 0.5 }] } });
    const run = async () => { const task = await studio.invoke<Task>('studio.run', { projectId: p.id, accountId: account.id, stage: 'music' }); for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10); return studio.store.task(task.id); };
    const first = await run(); assert.equal(first.status, 'succeeded', first.error); assert.equal(submissions, 1); assert.equal(first.outputIds.length, 1);
    assert.ok(studio.store.asset(first.outputIds[0]).mime.startsWith('audio/')); assert.equal(studio.store.assets().length, 1);
    const again = await run(); assert.equal(again.status, 'succeeded', again.error); assert.equal(submissions, 1); assert.deepEqual(again.outputIds, first.outputIds);
    const data = studio.store.project(p.id).data; assert.equal(data.musicId, first.outputIds[0]);
  } finally { await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('explicit regeneration replaces only selected generated assets and validates force before queue admission', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-force-')); const studio = new StudioService(root); let requests = 0;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=', 'base64');
  const server = createServer(async (request, response) => { for await (const _chunk of request) { /* drain request */ } requests++; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] })); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    await studio.invoke('settings.save', { providers: { image: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture' } } });
    const p = await studio.invoke<Project>('project.save', { name: 'regenerate', kind: 'film', data: { shots: ['one', 'two'].map(id => ({ id, prompt: id, duration: 1 })) } });
    const run = async (input = {}) => { const task = await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'images', ...input }); for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10); const done = studio.store.task(task.id); assert.equal(done.status, 'succeeded', done.error); return done; };
    await run(); assert.equal(requests, 2); const before = structuredClone(studio.store.project(p.id).data.production) as { images: Record<string, string> };
    await run(); assert.equal(requests, 2);
    await run({ force: true, shotIds: ['one'] }); assert.equal(requests, 3);
    const after = studio.store.project(p.id).data.production as typeof before; assert.notEqual(after.images[`${p.id}/one`], before.images[`${p.id}/one`]); assert.equal(after.images[`${p.id}/two`], before.images[`${p.id}/two`]);
    await assert.rejects(studio.invoke('studio.run', { projectId: p.id, stage: 'render', force: true }), /force|tạo lại|regenerat/i);
    await assert.rejects(studio.invoke('studio.run', { projectId: p.id, stage: 'images', force: 'yes' }), /force|boolean/i);
  } finally { await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('a new run cannot bypass unresolved remote admission after an accepted image request loses its connection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-unknown-admission-')); const studio = new StudioService(root); let submitted = 0;
  const server = createServer(async (req, res) => { for await (const _chunk of req) { /* drain */ } submitted++; res.destroy(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    await studio.invoke('settings.save', { providers: { image: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture' } } });
    const p = await studio.invoke<Project>('project.save', { name: 'unknown acceptance', kind: 'film', data: { shots: [{ id: 'one', prompt: 'lake', duration: 1 }] } });
    const task = await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'images' });
    for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10);
    assert.equal(submitted, 1);
    for (const force of [false, true]) await assert.rejects(studio.invoke('studio.run', { projectId: p.id, stage: 'images', force }), /đối soát|unresolved|chưa rõ/i);
    assert.equal(submitted, 1);
  } finally { await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('switching from images to characters cannot bypass an unresolved portrait request', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-stage-admission-')); const studio = new StudioService(root); let requests = 0;
  const server = createServer(async (req, res) => { for await (const _chunk of req) {} requests++; res.destroy(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    await studio.invoke('settings.save', { providers: { image: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture' } } });
    const p = await studio.invoke<Project>('project.save', { name: 'Portrait acceptance', kind: 'film', data: { characters: [{ id: 'actor', name: 'Actor', description: 'A blue jacket' }], shots: [{ id: 'one', prompt: 'Lake', duration: 1 }] } });
    const task = await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'images' }); for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10); assert.equal(requests, 1);
    await assert.rejects(studio.invoke('studio.run', { projectId: p.id, stage: 'characters' }), /đối soát|chưa rõ/i); assert.equal(requests, 1);
  } finally { await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('dubbing speech persists reusable audio; render and check never submit TTS and unsupported stages reject', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-dub-stages-')); const studio = new StudioService(root); let requests = 0;
  const video = join(root, 'source.mp4'), wav = join(root, 'voice.wav'); const ffmpeg = require('ffmpeg-static') as string;
  assert.equal(spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]).status, 0);
  assert.equal(spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=16000:duration=0.3', wav]).status, 0); const { readFileSync } = await import('node:fs'); const audio = readFileSync(wav);
  const server = createServer(async (req, res) => { for await (const _chunk of req) {} requests++; res.setHeader('content-type', 'audio/wav'); res.end(audio); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    const [source] = await studio.importFiles([video]); await studio.invoke('settings.save', { providers: { voice: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture' } } });
    const p = await studio.invoke<Project>('project.save', { name: 'Dub stages', kind: 'dub', data: { sourceAssetId: source.id, subtitle: '1\n00:00:00,000 --> 00:00:00,300\nHello\n', voiceId: 'fixture' } });
    const run = async (stage: string) => { const task = await studio.invoke<Task>('studio.run', { projectId: p.id, stage }); for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10); return studio.store.task(task.id); };
    const missing = await run('render'); assert.equal(missing.status, 'waiting_input', missing.error); assert.equal(requests, 0);
    const speech = await run('speech'); assert.equal(speech.status, 'succeeded', speech.error); assert.equal(requests, 1); assert.ok(speech.outputIds.every(id => studio.store.asset(id).mime.startsWith('audio/')));
    const render = await run('render'); assert.equal(render.status, 'succeeded', render.error); assert.equal(requests, 1); const rendered = await new MediaTools().probe(studio.store.assetPath(render.outputIds[0])); assert.ok(rendered.hasAudio); assert.deepEqual([rendered.width, rendered.height], [64, 64]);
    const check = await run('check'); assert.equal(check.status, 'succeeded', check.error); assert.equal(requests, 1); assert.match(check.message, /chưa|unknown|ASR/i);
    const tight = await studio.invoke<Project>('project.save', { name: 'Short cue', kind: 'dub', data: { sourceAssetId: source.id, subtitle: '1\n00:00:00,000 --> 00:00:00,050\nHello\n', voiceId: 'fixture' } });
    const first = await studio.invoke<Task>('studio.run', { projectId: tight.id }); for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(first.id).status); n++) await delay(10);
    assert.equal(studio.store.task(first.id).status, 'waiting_input', 'an oversized voice must not be cut into a successful video'); assert.equal(requests, 2);
    const saved = studio.store.project(tight.id); await studio.invoke('project.save', { ...saved, data: { ...saved.data, subtitle: '1\n00:00:00,000 --> 00:00:00,400\nHello\n' } });
    const repaired = await studio.invoke<Task>('studio.run', { projectId: tight.id, stage: 'render' }); for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(repaired.id).status); n++) await delay(10);
    assert.equal(studio.store.task(repaired.id).status, 'succeeded', studio.store.task(repaired.id).error); assert.equal(requests, 2, 'extending the cue reuses speech already generated');
    for (const stage of ['plan', 'characters', 'images', 'videos', 'music']) await assert.rejects(studio.invoke('studio.run', { projectId: p.id, stage }), /dub|lồng tiếng|dubbing/i);
  } finally { await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('changing portrait style invalidates generated references without replacing completed files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-portrait-style-')); const studio = new StudioService(root); let requests = 0;
  const server = createServer(async (req, res) => { for await (const _chunk of req) { /* drain */ } requests++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=' }] })); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    await studio.invoke('settings.save', { providers: { image: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture' } } });
    let p = await studio.invoke<Project>('project.save', { name: 'Portraits', kind: 'film', data: { style: 'photorealistic', characters: [{ id: 'mai', name: 'Mai', description: 'Blue shirt' }] } });
    const run = async () => { const task = await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'characters' }); for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10); assert.equal(studio.store.task(task.id).status, 'succeeded', studio.store.task(task.id).error); };
    await run(); assert.equal(requests, 1); p = studio.store.project(p.id);
    await studio.invoke('project.save', { ...p, data: { ...p.data, style: 'watercolor' } }); await run(); assert.equal(requests, 2); assert.equal(studio.store.assets().length, 2);
  } finally { await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('editing the source story marks an AI plan stale while explicit storyboard edits remain authoritative', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-plan-edit-')); const studio = new StudioService(root);
  try {
    const p = await studio.invoke<Project>('project.save', { name: 'AI plan', kind: 'film', data: { script: 'Old story', planning: { source: 'ai-api' }, planningNeedsUpdate: false, shots: [{ id: 'one', prompt: 'Old story visual', duration: 1 }] } });
    const changed = await studio.invoke<Project>('project.save', { ...p, data: { ...p.data, script: 'New story' } }); assert.equal(changed.data.planningNeedsUpdate, true);
    await assert.rejects(studio.invoke('studio.run', { projectId: p.id, stage: 'images' }), /kế hoạch|plan/i);
    const edited = await studio.invoke<Project>('project.save', { ...changed, data: { ...changed.data, shots: [{ id: 'one', prompt: 'My reviewed visual for the new story', duration: 1 }] } }); assert.equal(edited.data.planningNeedsUpdate, false); assert.equal((edited.data.shots as Array<{ prompt: string }>)[0].prompt, 'My reviewed visual for the new story');
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('resuming an older pipeline keeps a newer regenerated frame and invalidates downstream checkpoints', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-resume-frame-')); const studio = new StudioService(root); let requests = 0;
  const server = createServer(async (req, res) => { for await (const _chunk of req) { /* drain */ } requests++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=' }] })); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    await studio.invoke('settings.save', { providers: { image: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture' } } });
    const p = await studio.invoke<Project>('project.save', { name: 'Resume', kind: 'film', data: { shots: [{ id: 'one', prompt: 'lake', duration: 1 }] } });
    const finish = async (task: Task) => { for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10); return studio.store.task(task.id); };
    const old = await finish(await studio.invoke<Task>('studio.run', { projectId: p.id })); assert.equal(old.status, 'waiting_input');
    const newer = await finish(await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'images', force: true })); assert.equal(newer.status, 'succeeded', newer.error); assert.equal(requests, 2);
    const data = studio.store.project(p.id).data.production as { images: Record<string, string> }; const id = data.images[`${p.id}/one`];
    await studio.invoke('task.action', { action: 'retry', ids: [old.id] }); await finish(old);
    assert.equal((studio.store.project(p.id).data.production as typeof data).images[`${p.id}/one`], id); assert.equal(requests, 2);
  } finally { await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('native dialogue render uses owned clips, preserves the complete measured speech span and exports captions from that span', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-native-cut-')); const studio = new StudioService(root);
  try {
    const source = join(root, 'dialogue.mp4');
    assert.equal(spawnSync(require('ffmpeg-static') as string, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=6', '-f', 'lavfi', '-i', 'sine=frequency=180:sample_rate=16000:duration=3', '-filter_complex', '[1:a]adelay=1000:all=1,apad=whole_dur=6[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '6', source]).status, 0);
    const [clip] = await studio.importFiles([source]);
    const p = await studio.invoke<Project>('project.save', { name: 'native', kind: 'film', data: { nativeAudio: true, pace: 'flow', width: 64, height: 64, shots: [{ id: 'one', prompt: 'Mai nói', videoAssetId: clip.id, duration: 0.5, dialogue: 'Một câu thoại dài cần giữ trọn tiếng nói.' }] } });
    const task = await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'render' });
    for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10);
    const done = studio.store.task(task.id); assert.equal(done.status, 'succeeded', done.error);
    const video = await new MediaTools().probe(studio.store.assetPath(done.outputIds[0])); assert.ok(video.hasAudio); assert.ok(video.duration > 3 && video.duration < 6, `speech was cut to ${video.duration}`);
    const srt = await studio.invoke<{ id: string }>('srt.export', { projectId: p.id }); const { readFileSync } = await import('node:fs');
    const cues = await studio.invoke<Array<{ start: number; end: number; text: string }>>('srt.parse', { text: readFileSync(studio.store.assetPath(srt.id), 'utf8') });
    assert.equal(cues[0].text, 'Một câu thoại dài cần giữ trọn tiếng nói.'); assert.ok(cues[0].end - cues[0].start > 2.5);
    const latest = studio.store.project(p.id); await studio.invoke('project.save', { ...latest, data: { ...latest.data, shots: [{ ...(latest.data.shots as Array<Record<string, unknown>>)[0], dialogue: 'New dialogue requires a new measured clock.' }] } });
    await assert.rejects(studio.invoke('srt.export', { projectId: p.id }), /dựng|render|cũ|clock/i);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('SRT sidecars preserve source gaps and include the rendered title offset', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-sidecar-title-')); const studio = new StudioService(root);
  const file = join(root, 'frame.png'); writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=', 'base64'));
  try {
    const [photo] = await studio.importFiles([file]); const p = await studio.invoke<Project>('project.save', { name: 'Caption title', kind: 'srt', data: { renderMode: 'slideshow', width: 64, height: 64, titleCard: 'Title', titleDuration: 0.5, subtitle: '1\n00:00:01,000 --> 00:00:01,300\nXin chào\n', shots: [{ id: 'one', prompt: 'lake', assetId: photo.id, duration: 0.3, start: 1 }] } });
    const task = await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'render' }); for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10);
    const done = studio.store.task(task.id); assert.equal(done.status, 'succeeded', done.error); const info = await new MediaTools().probe(studio.store.assetPath(done.outputIds[0])); assert.ok(Math.abs(info.duration - 1.8) < 0.05);
    const srt = await studio.invoke<{ id: string }>('srt.export', { projectId: p.id }); const { readFileSync } = await import('node:fs'); const cues = await studio.invoke<Array<{ start: number; end: number }>>('srt.parse', { text: readFileSync(studio.store.assetPath(srt.id), 'utf8') }); assert.deepEqual(cues.map(cue => [cue.start, cue.end]), [[1.5, 1.8]]);
    assert.equal(studio.store.project(p.id).data.productionStale, false);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('queued image review submits actual frame and cast references, records model verdicts and never generates replacement assets implicitly', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-review-')); const studio = new StudioService(root); let requests = 0; let verdict = 'pass';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=', 'base64');
  const framePath = join(root, 'frame.png'); const portraitPath = join(root, 'portrait.png'); writeFileSync(framePath, png); writeFileSync(portraitPath, png);
  const server = createServer(async (request, response) => {
    assert.equal(request.url, '/v1/chat/completions'); let body = ''; for await (const chunk of request) body += chunk;
    assert.ok(body.includes('data:image/png;base64,')); requests++; response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ scene: { status: 'pass', reason: 'Scene matches the supplied prompt' }, face: { status: verdict, reason: verdict === 'pass' ? 'Identity matches the reference' : 'Identity differs from the supplied reference' }, outfit: { status: 'pass', reason: 'Outfit matches the reference' } }) } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    const [frame, portrait] = await studio.importFiles([framePath, portraitPath]);
    await studio.invoke('settings.save', { providers: { text: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'vision-fixture' } } });
    const p = await studio.invoke<Project>('project.save', { name: 'Review', kind: 'film', data: { renderMode: 'slideshow', autoFix: false, characters: [{ id: 'mai', name: 'Mai', description: 'Áo xanh', assetId: portrait.id }], shots: [{ id: 'one', prompt: 'Mai bên hồ', duration: 0.2, assetId: frame.id, characterIds: ['mai'] }] } });
    const run = async () => { const task = await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'check' }); for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10); return studio.store.task(task.id); };
    const first = await run(); assert.equal(first.status, 'succeeded', first.error); assert.equal(requests, 1); assert.equal(studio.store.assets().length, 2);
    let reviews = studio.store.project(p.id).data.qualityReviews as Record<string, { image: { status: string; modelAssessed: boolean } }>;
    assert.equal(reviews[`${p.id}/one`].image.status, 'pass'); assert.equal(reviews[`${p.id}/one`].image.modelAssessed, true);
    verdict = 'fail'; await run(); reviews = studio.store.project(p.id).data.qualityReviews as typeof reviews;
    assert.equal(reviews[`${p.id}/one`].image.status, 'fail'); assert.equal(studio.store.assets().length, 2, 'review-only must not bill a regeneration');
  } finally { await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('automatic checks stop rendering on a failed visual verdict and resume the saved review without a second request', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-qc-gate-')); const studio = new StudioService(root); let requests = 0;
  const file = join(root, 'frame.png'); writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=', 'base64'));
  const server = createServer(async (req, res) => { for await (const _chunk of req) { /* drain */ } requests++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ scene: { status: 'fail', reason: 'Wrong scene' }, face: { status: 'not_applicable', reason: 'No people' }, outfit: { status: 'not_applicable', reason: 'No people' } }) } }] })); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    const [photo] = await studio.importFiles([file]); await studio.invoke('settings.save', { providers: { text: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture' } } });
    const p = await studio.invoke<Project>('project.save', { name: 'QC gate', kind: 'film', data: { autoChecks: true, renderMode: 'slideshow', width: 64, height: 64, shots: [{ id: 'one', prompt: 'A lake', assetId: photo.id, duration: 0.2 }] } });
    const finish = async (task: Task) => { for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10); return studio.store.task(task.id); };
    const first = await finish(await studio.invoke<Task>('studio.run', { projectId: p.id })); assert.equal(first.status, 'waiting_input', first.error); assert.equal(requests, 1); assert.equal(studio.store.assets().some(asset => asset.mime.startsWith('video/')), false);
    await studio.invoke('task.action', { action: 'retry', ids: [first.id] }); const again = await finish(first); assert.equal(again.status, 'waiting_input'); assert.equal(requests, 1, 'retry reuses the completed review');
  } finally { await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

for (const stage of ['plan', 'check'] as const) test(`definitive HTTP 429 during ${stage} retries within the same checkpoint instead of becoming an unresolved acceptance`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-text-throttle-')); const studio = new StudioService(root); let requests = 0;
  const file = join(root, 'frame.png'); writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=', 'base64'));
  const server = createServer(async (req, res) => { for await (const _chunk of req) { /* drain */ } requests++; res.setHeader('content-type', 'application/json'); if (requests === 1) { res.statusCode = 429; res.end('{"error":{"message":"rate limited"}}'); return; } const result = stage === 'plan' ? { characters: [], scenes: [], shots: [{ id: 'one', prompt: 'A cup', duration: 1 }] } : { scene: { status: 'pass', reason: 'Matches' }, face: { status: 'not_applicable', reason: 'No people' }, outfit: { status: 'not_applicable', reason: 'No people' } }; res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] })); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    const [photo] = await studio.importFiles([file]); await studio.invoke('settings.save', { providers: { text: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture' } } });
    const p = await studio.invoke<Project>('project.save', { name: 'Throttle', kind: 'affiliate', data: { product: { name: 'Cup' }, shots: [{ id: 'one', prompt: 'Cup', assetId: photo.id, duration: 1 }] } }); const task = await studio.invoke<Task>('studio.run', { projectId: p.id, stage });
    for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10);
    const done = studio.store.task(task.id); assert.equal(done.status, 'succeeded', done.error); assert.equal(requests, 2); assert.equal(done.attempts, 2);
  } finally { await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('story narration measures real sentence audio before building source-compatible cues and a mixed voice track', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-narration-')); const studio = new StudioService(root);
  const first = join(root, 'first.wav'); const second = join(root, 'second.wav');
  for (const [path, duration] of [[first, '1.25'], [second, '0.5']]) assert.equal(spawnSync(require('ffmpeg-static') as string, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=16000', '-t', duration, path]).status, 0);
  const { readFileSync } = await import('node:fs'); const lines: string[] = [];
  const provider = createServer(async (request, response) => {
    assert.equal(request.url, '/v1/audio/speech'); let body = ''; for await (const chunk of request) body += chunk;
    const input = JSON.parse(body); lines.push(input.input); response.setHeader('content-type', 'audio/wav'); response.end(readFileSync(lines.length === 1 ? first : second));
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve)); const address = provider.address(); assert.ok(address && typeof address !== 'string');
  try {
    await studio.invoke('settings.save', { providers: { voice: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture' } } });
    const p = await studio.invoke<Project>('project.save', { name: 'Narration', kind: 'srt', data: { script: 'CẢNH 1: Hồ\nXin chào. Mời anh', storyMode: true, renderMode: 'slideshow', voiceId: 'fixture' } });
    const task = await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'speech' });
    for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10);
    const done = studio.store.task(task.id); assert.equal(done.status, 'succeeded', done.error); assert.deepEqual(lines, ['Xin chào.', 'Mời anh']);
    const data = studio.store.project(p.id).data;
    const cues = await studio.invoke<Array<{ start: number; end: number; text: string }>>('srt.parse', { text: data.subtitle });
    assert.deepEqual(cues.map(cue => [cue.start, cue.end, cue.text]), [[0.25, 1.5, 'Xin chào.'], [1.85, 2.35, 'Mời anh']]);
    const voice = studio.store.asset(done.outputIds[0]); assert.ok(voice.mime.startsWith('audio/'));
    const info = await new MediaTools().probe(studio.store.assetPath(voice.id)); assert.ok(Math.abs(info.duration - 2.9) < 0.02);
    assert.ok(Array.isArray(data.visualGroups)); assert.equal(studio.store.assets().some(asset => asset.mime.startsWith('video/')), false);
    const again = await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'speech' });
    for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(again.id).status); n++) await delay(10);
    assert.equal(studio.store.task(again.id).status, 'succeeded'); assert.equal(lines.length, 2, 'unchanged narration reuses completed speech');
    const planned = await studio.invoke<Project>('studio.plan', { projectId: p.id });
    const image = join(root, 'frame.png'); writeFileSync(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=', 'base64'));
    const [frame] = await studio.importFiles([image]);
    await studio.invoke('project.save', { ...planned, data: { ...planned.data, width: 64, height: 64, shots: (planned.data.shots as Array<Record<string, unknown>>).map(shot => ({ ...shot, assetId: frame.id })) } });
    const render = await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'render' });
    for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(render.id).status); n++) await delay(10);
    const doneRender = studio.store.task(render.id); assert.equal(doneRender.status, 'succeeded', doneRender.error); assert.equal(lines.length, 2);
    const video = await new MediaTools().probe(studio.store.assetPath(doneRender.outputIds[0])); assert.ok(video.hasAudio); assert.ok(Math.abs(video.duration - 2.85) < 0.08, 'visual groups use source grouping clock while audio cues remain fixed');
  } finally { await studio.close(); provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('source narration aligns supplied sentences across measured ASR spans and rejects timestamps outside the actual audio', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-source-clock-')); const studio = new StudioService(root); let invalid = false;
  const wav = join(root, 'voice.wav'); assert.equal(spawnSync(require('ffmpeg-static') as string, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=16000:duration=3', wav]).status, 0);
  const server = createServer(async (req, res) => { for await (const _chunk of req) { /* drain */ } res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ text: 'Xin chào. Mời anh đến đây.', segments: [{ start: 0.2, end: invalid ? 8 : 2.7, text: 'Xin chào. Mời anh đến đây.' }] })); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    const [audio] = await studio.importFiles([wav]); await studio.invoke('settings.save', { providers: { asr: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture' } } });
    const run = async () => { const p = await studio.invoke<Project>('project.save', { name: 'Source clock', kind: 'srt', data: { storyMode: true, sourceAudioAssetId: audio.id, script: 'Xin chào. Mời anh đến đây.' } }); const task = await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'speech' }); for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10); return { project: studio.store.project(p.id), task: studio.store.task(task.id) }; };
    const good = await run(); assert.equal(good.task.status, 'succeeded', good.task.error); const cues = await studio.invoke<Array<{ start: number; end: number; text: string }>>('srt.parse', { text: good.project.data.subtitle }); assert.equal(cues.length, 2); assert.equal(cues[0].text, 'Xin chào.'); assert.equal(cues[1].text, 'Mời anh đến đây.'); assert.deepEqual(good.task.outputIds, [audio.id]);
    invalid = true; const bad = await run(); assert.equal(bad.task.status, 'waiting_input'); assert.match(bad.task.error, /thời gian|timestamp|audio|mốc/i); assert.equal(bad.project.data.subtitle, undefined);
  } finally { await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('queued AI planning calls the configured model, saves a real storyboard and preserves the previous plan on invalid model output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-ai-plan-')); const studio = new StudioService(root); let requests = 0; let malformed = false;
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    assert.equal(request.url, '/v1/chat/completions'); const input = JSON.parse(body); assert.equal(input.model, 'planner-fixture');
    // Film planning is the multi-turn director recovered from MuseStudio (bible → scene → review); see tests/director.test.ts.
    const prompt = String(input.messages[0].content); assert.ok(prompt.includes('JSON'));
    const total = Number(/exactly (\d+) shots/.exec(prompt)?.[1]); const range = /shot IDs (\d+)–(\d+)/.exec(prompt);
    const content = malformed ? '{broken'
      : prompt.includes('planning a short film') ? JSON.stringify({ title: 'AI story', characters: [{ id: 'mai', name: 'Mai', look: 'Áo xanh', voice: 'Giọng Bắc trẻ' }], locations: [{ id: 'lake', name: 'Bên hồ' }], scenes: [{ id: 'lake', title: 'Bên hồ', location: 'lake', characters: ['mai'], a: 1, b: total }] })
      : range ? JSON.stringify({ shots: Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => ({ id: Number(range[1]) + i, type: 'single', visual: 'Mai bước tới hồ', characters: ['mai'], lines: [{ speaker: 'mai', text: 'Xin chào.' }] })) })
      : JSON.stringify({ shots: [], issues: [], fixed: 0 });
    requests++; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const finish = async (task: Task) => { for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10); return studio.store.task(task.id); };
  try {
    await studio.invoke('settings.save', { providers: { text: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'planner-fixture' } } });
    const p = await studio.invoke<Project>('project.save', { name: 'Idea', kind: 'film', data: { script: 'Mai bước ra hồ đón một ngày mới.' } });
    const task = await finish(await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'plan' }));
    assert.equal(task.status, 'succeeded', task.error); assert.equal(requests, 3, 'bible, one scene and the director review'); assert.equal(studio.store.assets().length, 0);
    const data = studio.store.project(p.id).data; const shots = data.shots as Array<{ speaker: string; dialogue: string }>;
    assert.equal(shots.length, 25, 'two-minute flow budget'); assert.equal(shots[0].speaker, 'mai'); assert.equal(shots[0].dialogue, 'Xin chào.');
    assert.equal((data.planning as { source: string }).source, 'ai-api'); assert.equal(data.nativeAudio, true);
    malformed = true; const invalid = await finish(await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'plan' }));
    assert.equal(invalid.status, 'failed'); assert.deepEqual(studio.store.project(p.id).data, data); assert.equal(requests, 5, 'one bible request plus its format retry');
    await studio.invoke('task.action', { action: 'retry', ids: [invalid.id] }); await finish(invalid); assert.equal(requests, 5, 'retry must not issue another paid planning request');
  } finally { await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('affiliate planning sends selected product photos to the model and preserves their owned references', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-product-vision-')); const studio = new StudioService(root); let sawPhoto = false;
  const file = join(root, 'product.png'); writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=', 'base64'));
  const server = createServer(async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; sawPhoto = body.includes('data:image/png;base64,'); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ name: 'Cup', characters: [], scenes: [], shots: [{ id: 'one', prompt: 'Show the real cup', duration: 2 }] }) } }] })); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    const [photo] = await studio.importFiles([file]); await studio.invoke('settings.save', { providers: { text: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture' } } });
    const p = await studio.invoke<Project>('project.save', { name: 'Cup', kind: 'affiliate', data: { product: { name: 'Cup', price: 100 }, productAssetIds: [photo.id] } }); const task = await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'plan' });
    for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10);
    assert.equal(studio.store.task(task.id).status, 'succeeded', studio.store.task(task.id).error); assert.equal(sawPhoto, true); assert.deepEqual(studio.store.project(p.id).data.productAssetIds, [photo.id]);
    await assert.rejects(studio.invoke('project.save', { ...p, data: { ...p.data, productAssetIds: ['unowned'] } }), /asset|tệp/i);
  } finally { await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('selected image stage saves reusable image assets and render-only never submits missing generation work', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-stages-')); const studio = new StudioService(root); let requests = 0;
  const provider = createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain fixture */ }
    requests++; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=' }] }));
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve)); const address = provider.address(); assert.ok(address && typeof address !== 'string');
  const finish = async (task: Task) => { for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10); return studio.store.task(task.id); };
  try {
    await studio.invoke('settings.save', { providers: { image: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture' } } });
    const project = await studio.invoke<Project>('project.save', { name: 'stages', kind: 'film', data: { renderMode: 'slideshow', width: 64, height: 64, shots: [{ id: 'a', prompt: 'One', duration: 0.2 }, { id: 'b', prompt: 'Two', duration: 0.2 }] } });
    const rendered = await finish(await studio.invoke<Task>('studio.run', { projectId: project.id, stage: 'render' }));
    assert.equal(requests, 0, 'render-only must not generate missing assets'); assert.equal(rendered.status, 'failed');
    const images = await finish(await studio.invoke<Task>('studio.run', { projectId: project.id, stage: 'images', shotIds: ['b'] }));
    assert.equal(images.status, 'succeeded', images.error); assert.equal(requests, 1); assert.equal(images.outputIds.length, 1);
    assert.ok(studio.store.asset(images.outputIds[0]).mime.startsWith('image/')); assert.equal(studio.store.assets().some(asset => asset.mime.startsWith('video/')), false);
    const production = studio.store.project(project.id).data.production as { images: Record<string, string> };
    assert.deepEqual(Object.keys(production.images), [`${project.id}/b`]); assert.equal(production.images[`${project.id}/b`], images.outputIds[0]);
    const reused = await finish(await studio.invoke<Task>('studio.run', { projectId: project.id, stage: 'images', shotIds: ['b'] }));
    assert.equal(reused.status, 'succeeded', reused.error); assert.equal(requests, 1, 'same image stage must reuse owned completed media');
    await assert.rejects(studio.invoke('studio.run', { projectId: project.id, stage: 'images', shotIds: ['missing'] }), /shot|cảnh|không/i);
    const single = await studio.invoke<Project>('project.save', { name: 'freshness', kind: 'film', data: { renderMode: 'slideshow', width: 64, height: 64, shots: [{ id: 'one', prompt: 'Original', duration: 0.2 }] } });
    await finish(await studio.invoke<Task>('studio.run', { projectId: single.id, stage: 'images' }));
    const saved = studio.store.project(single.id);
    const edited = await studio.invoke<Project>('project.save', { ...saved, data: { ...saved.data, shots: [{ id: 'one', prompt: 'A different scene', duration: 0.2 }] } });
    assert.equal(edited.data.productionStale, true, 'editing the plan must mark saved output stale');
    const stale = await finish(await studio.invoke<Task>('studio.run', { projectId: single.id, stage: 'render' }));
    assert.equal(stale.status, 'failed', 'render-only must not silently use a stale generated frame'); assert.equal(requests, 2);
    const castProject = await studio.invoke<Project>('project.save', { name: 'cast', kind: 'film', data: { characters: [{ id: 'mai', name: 'Mai', description: 'Áo dài xanh, tóc đen' }] } });
    const portraits = await finish(await studio.invoke<Task>('studio.run', { projectId: castProject.id, stage: 'characters' }));
    assert.equal(portraits.status, 'succeeded', portraits.error); assert.equal(portraits.outputIds.length, 1); assert.equal(requests, 3);
    const castData = studio.store.project(castProject.id).data;
    assert.equal((castData.production as { characterImages: Record<string, string> }).characterImages.mai, portraits.outputIds[0]);
    const again = await finish(await studio.invoke<Task>('studio.run', { projectId: castProject.id, stage: 'characters' }));
    assert.equal(again.status, 'succeeded', again.error); assert.equal(requests, 3, 'completed character references are reused');
  } finally { await studio.close(); provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('update preparation pauses queued work and blocks mutations through installer handoff', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-update-lock-')); const entered = deferred(); const verification = deferred();
  let installs = 0;
  const studio = new StudioService(root, { actions: { installUpdate: async (beforeInstall?: () => void) => {
    entered.resolve(); await verification.promise; beforeInstall?.(); installs++; return { installing: true };
  } } });
  let pending: Promise<unknown> | undefined;
  try {
    const project = studio.store.saveProject({ name: 'queued' });
    const [task] = studio.store.createTasks({ projectId: project.id, prompts: ['queued'], kind: 'image' });
    studio.queue.enqueue([task.id]); pending = studio.invoke('update.install'); await entered.promise;
    assert.equal(studio.queue.isPaused(), true);
    assert.equal(studio.store.task(task.id).status, 'queued');
    for (const command of ['project.save', 'task.create', 'task.action', 'media.merge', 'studio.run', 'queue.resume', 'codex.run', 'codex.approve', 'update.install'] as const) {
      await assert.rejects(studio.invoke(command), /cập nhật|update/i, command);
    }
    await assert.rejects(studio.importFiles([]), /cập nhật|update/i);
    await studio.invoke('state'); await studio.invoke('diagnostics');
    verification.resolve(); await pending;
    assert.equal(installs, 1); assert.equal(studio.queue.isPaused(), true);
    await assert.rejects(studio.invoke('project.save', { name: 'too late' }), /cập nhật|update/i);
  } finally { verification.resolve(); await pending?.catch(() => {}); await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('download-only and failed update preparation restore the original queue pause state', async () => {
  for (const paused of [false, true]) for (const failure of ['none', 'verification', 'handoff']) {
    const root = mkdtempSync(join(tmpdir(), 'maistudio-update-restore-'));
    const studio = new StudioService(root, { actions: { installUpdate: async (beforeInstall?: () => void) => {
      if (failure === 'handoff') beforeInstall?.();
      if (failure !== 'none') throw new Error(`${failure} failed`);
      return { downloading: true };
    } } });
    try {
      if (paused) studio.queue.pause();
      if (failure !== 'none') await assert.rejects(studio.invoke('update.install'), /verification failed|handoff failed/);
      else await studio.invoke('update.install');
      assert.equal(studio.queue.isPaused(), paused);
      assert.equal(studio.store.queuePaused(), paused);
      await studio.invoke('project.save', { name: 'work resumes' });
    } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
  }
});

test('update refuses existing running tasks and queued or running Codex jobs before invoking the updater', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-update-active-')); let calls = 0; let jobs: CodexJob[] = [];
  const studio = new StudioService(root, { actions: { installUpdate: async () => { calls++; return { downloading: true }; } } });
  studio.codex.list = () => jobs;
  try {
    const project = studio.store.saveProject({ name: 'active' });
    const [task] = studio.store.createTasks({ projectId: project.id, prompts: ['active'], kind: 'image' });
    studio.store.updateTask(task.id, { status: 'running' });
    await assert.rejects(studio.invoke('update.install'), /công việc|Codex/i);
    studio.store.updateTask(task.id, { status: 'cancelled' });
    for (const status of ['queued', 'running']) {
      jobs = [{ id: 'active', mode: 'edit', prompt: 'fixture', status, log: '', result: '', createdAt: Date.now(), approved: true }];
      await assert.rejects(studio.invoke('update.install'), /công việc|Codex/i);
    }
    assert.equal(calls, 0); assert.equal(studio.queue.isPaused(), false);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('installer boundary rejects Codex work that appears during verification and unlocks after failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-update-boundary-')); const entered = deferred(); const verification = deferred();
  let installs = 0; let jobs: CodexJob[] = [];
  const studio = new StudioService(root, { actions: { installUpdate: async (beforeInstall?: () => void) => {
    entered.resolve(); await verification.promise; beforeInstall?.(); installs++; return { installing: true };
  } } });
  studio.codex.list = () => jobs;
  let pending: Promise<unknown> | undefined;
  try {
    pending = studio.invoke('update.install'); await entered.promise;
    jobs = [{ id: 'active', mode: 'edit', prompt: 'fixture', status: 'running', log: '', result: '', createdAt: Date.now(), approved: true }];
    verification.resolve(); await assert.rejects(pending, /công việc|Codex|job/i);
    assert.equal(installs, 0); assert.equal(studio.queue.isPaused(), false);
    await studio.invoke('project.save', { name: 'still usable' });
  } finally { verification.resolve(); await pending?.catch(() => {}); await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('update refuses a Codex run already waiting for CLI detection before it has a job record', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-update-codex-')); const detecting = deferred(); const detected = deferred();
  let installs = 0;
  const studio = new StudioService(root, { actions: { installUpdate: async () => { installs++; return { installing: true }; } } });
  studio.codex.status = async () => { detecting.resolve(); await detected.promise; return { ready: false, version: '', message: 'fixture CLI unavailable' }; };
  const run = studio.invoke('codex.run', { prompt: 'fixture' }); const rejectedRun = assert.rejects(run, /fixture CLI unavailable/);
  try {
    await detecting.promise; assert.equal(studio.codex.list().length, 0);
    await assert.rejects(studio.invoke('update.install'), /công việc|Codex|job/i); assert.equal(installs, 0);
    detected.resolve(); await rejectedRun;
    await studio.invoke('project.save', { name: 'not locked' });
    await studio.invoke('update.install'); assert.equal(installs, 1);
  } finally { detected.resolve(); await rejectedRun; await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('update waits for native imports and provider writes already awaiting IO', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-update-writes-')); const importing = deferred(); const imported = deferred();
  const speaking = deferred(); const spoken = deferred(); let installs = 0;
  const wav = Buffer.alloc(64); wav.write('RIFF'); wav.write('WAVE', 8);
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain the TTS request */ }
    speaking.resolve(); await spoken.promise; response.setHeader('content-type', 'audio/wav'); response.end(wav);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const studio = new StudioService(root, { actions: { installUpdate: async () => { installs++; return { downloading: true }; } } });
  const importAsset = studio.store.importAsset.bind(studio.store);
  studio.store.importAsset = async (...args) => { importing.resolve(); await imported.promise; return importAsset(...args); };
  let pendingImport: Promise<unknown> | undefined; let pendingSpeech: Promise<unknown> | undefined;
  try {
    const file = join(root, 'import.txt'); writeFileSync(file, 'native import fixture');
    pendingImport = studio.importFiles([file]); await importing.promise;
    await assert.rejects(studio.invoke('update.install'), /công việc|job/i);
    imported.resolve(); await pendingImport;
    await studio.invoke('settings.save', { providers: { voice: { baseUrl: `http://127.0.0.1:${address.port}/v1` } } });
    pendingSpeech = studio.invoke('voice.sample', { text: 'Hello', voiceId: 'alloy' }); await speaking.promise;
    await assert.rejects(studio.invoke('update.install'), /công việc|job/i);
    assert.equal(installs, 0); spoken.resolve(); await pendingSpeech;
    assert.equal(studio.store.assets().length, 2);
    await studio.invoke('update.install'); assert.equal(installs, 1);
  } finally {
    imported.resolve(); spoken.resolve(); await pendingImport?.catch(() => {}); await pendingSpeech?.catch(() => {});
    await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true });
  }
});

test('real command service persists projects/tasks, rejects forged commands and never returns credentials', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-service-')); const studio = new StudioService(root);
  try {
    const project = await studio.invoke<Project>('project.save', { name: 'Một bộ phim', kind: 'film' });
    const planned = await studio.invoke<Project>('studio.plan', { projectId: project.id, prompt: 'Cảnh thứ nhất.\n\nCảnh thứ hai.' });
    assert.ok(Array.isArray(planned.data.shots)); assert.equal(planned.data.shots.length, 2);
    const tasks = await studio.invoke<Task[]>('task.create', { projectId: project.id, prompts: ['Một ảnh'], kind: 'image' });
    assert.equal(tasks[0].status, 'draft');
    await studio.invoke('secret.save', { key: 'image.key', value: 'never-return-me' });
    const state = await studio.invoke<StudioState>('state');
    assert.equal(state.projects.length, 1); assert.equal(state.tasks.length, 1);
    assert.equal(JSON.stringify(state).includes('never-return-me'), false);
    await assert.rejects(studio.invoke('settings.save', { generationConcurrency: 99 }), /Concurrency/);
    await assert.rejects(studio.invoke('media.import', { path: '/etc/passwd' }), /dialog|chọn|quyền/i);
    await assert.rejects(studio.invoke('unknown' as never), /command|lệnh/i);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});



test('ASR returns real timed cues through the service and refuses non-audio assets before upload', async () => {
  let uploads = 0;
  const server = createServer(async (request, response) => { for await (const _chunk of request) { /* actual multipart stream */ } uploads++; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ text: 'Xin chào', segments: [{ start: 1, end: 2, text: 'Xin chào' }] })); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const root = mkdtempSync(join(tmpdir(), 'maistudio-asr-')); const studio = new StudioService(root);
  try {
    await studio.invoke('settings.save', { providers: { asr: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'whisper-1' } } });
    const file = join(root, 'voice.wav'); const wav = Buffer.alloc(64); wav.write('RIFF'); wav.write('WAVE', 8); writeFileSync(file, wav);
    const [asset] = await studio.importFiles([file]);
    const result = await studio.invoke<{ text: string; subtitle: string }>('voice.transcribe', { assetId: asset.id });
    assert.equal(result.text, 'Xin chào'); assert.ok(result.subtitle.includes('00:00:01,000 --> 00:00:02,000'));
    const textFile = join(root, 'secret.txt'); writeFileSync(textFile, 'not an audio file'); const [wrong] = await studio.importFiles([textFile]);
    await assert.rejects(studio.invoke('voice.transcribe', { assetId: wrong.id }), /audio|video/i); assert.equal(uploads, 1);
  } finally { await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('SRT project execution preserves leading silence and inter-cue gaps in the rendered timeline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-srt-clock-')); const studio = new StudioService(root);
  try {
    const image = join(root, 'frame.png'); assert.equal(spawnSync(require('ffmpeg-static') as string, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', image]).status, 0);
    const [asset] = await studio.importFiles([image]);
    const project = await studio.invoke<Project>('project.save', { name: 'gapped cues', kind: 'srt', data: { renderMode: 'slideshow', width: 64, height: 64, subtitle: '1\n00:00:01,000 --> 00:00:02,000\nOne\n\n2\n00:00:04,000 --> 00:00:05,000\nTwo\n', shots: [{ id: 'one', prompt: 'one', duration: 1, assetId: asset.id }, { id: 'two', prompt: 'two', duration: 1, assetId: asset.id }] } });
    const task = await studio.invoke<Task>('studio.run', { projectId: project.id });
    for (let n = 0; n < 500 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(20);
    const done = studio.store.task(task.id); assert.equal(done.status, 'succeeded', done.error);
    const result = studio.store.asset(done.outputIds[0]); assert.ok(Math.abs(Number(result.duration) - 5) < 0.05, `expected 5 seconds, got ${result.duration}`);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('parallel narrative projects share the configured media admission limit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-admission-')); const studio = new StudioService(root);
  const render = MediaTools.prototype.slideshow; let active = 0; let peak = 0;
  MediaTools.prototype.slideshow = async function (...args) { active++; peak = Math.max(peak, active); try { await render.apply(this, args); } finally { active--; } };
  try {
    studio.store.setSettings({ generationConcurrency: 4, mediaConcurrency: 1 }); studio.queue.setLimits(studio.store.settings());
    const image = join(root, 'image.png'); assert.equal(spawnSync(require('ffmpeg-static') as string, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', image]).status, 0);
    const [asset] = await studio.importFiles([image]); const tasks: Task[] = [];
    for (let index = 0; index < 4; index++) {
      const p = await studio.invoke<Project>('project.save', { name: `parallel ${index}`, kind: 'film', data: { renderMode: 'slideshow', width: 64, height: 64, shots: [{ id: 'one', prompt: 'one', duration: 0.1, assetId: asset.id }] } });
      tasks.push(await studio.invoke<Task>('studio.run', { projectId: p.id }));
    }
    for (let n = 0; n < 500 && tasks.some(task => ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status)); n++) await delay(20);
    assert.ok(tasks.every(task => studio.store.task(task.id).status === 'succeeded'));
    assert.equal(peak, 1, 'nested render pipelines must honor mediaConcurrency=1');
  } finally { MediaTools.prototype.slideshow = render; await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('deleting an active account rejects before any browser close side effect', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-account-')); const studio = new StudioService(root);
  try {
    const account = studio.store.saveAccount({ name: 'active' }); const p = studio.store.saveProject({ name: 'work' });
    const [task] = studio.store.createTasks({ projectId: p.id, prompts: ['work'], accountId: account.id, kind: 'image' }); studio.store.updateTask(task.id, { status: 'running' });
    let closed = false; studio.browsers.close = async () => { closed = true; };
    await assert.rejects(studio.invoke('account.delete', { id: account.id }), /đang|dùng|active/i);
    assert.equal(closed, false); assert.equal(studio.store.account(account.id).name, 'active');
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('nested film and dubbing speech admission is checkpointed so retry never repeats an accepted TTS request', async () => {
  let submissions = 0;
  const server = createServer(async (request) => { for await (const _chunk of request) { /* drain */ } submissions++; request.socket.destroy(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const root = mkdtempSync(join(tmpdir(), 'maistudio-tts-')); const studio = new StudioService(root);
  try {
    await studio.invoke('settings.save', { providers: { voice: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'tts' } } });
    const image = join(root, 'scene.png'); const video = join(root, 'source.mp4'); const ffmpeg = require('ffmpeg-static') as string;
    assert.equal(spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64', '-frames:v', '1', image]).status, 0);
    assert.equal(spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=0.3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]).status, 0);
    const [photo, source] = await studio.importFiles([image, video]);
    for (const kind of ['film', 'dub'] as const) {
      const before = submissions; const data = kind === 'film' ? { renderMode: 'slideshow', shots: [{ id: 'one', prompt: 'one', assetId: photo.id, duration: 0.3, dialogue: 'Hello', voiceId: 'alloy' }] } : { sourceAssetId: source.id, subtitle: '1\n00:00:00,000 --> 00:00:00,300\nHello\n', voiceId: 'alloy' };
      const project = await studio.invoke<Project>('project.save', { name: kind, kind, data }); const task = await studio.invoke<Task>('studio.run', { projectId: project.id });
      for (let n = 0; n < 300 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10);
      assert.equal(submissions, before + 1);
      await studio.invoke('task.action', { action: 'retry', ids: [task.id] });
      for (let n = 0; n < 300 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10);
      assert.equal(submissions, before + 1, `${kind} retried an already accepted request`);
      assert.equal(studio.store.task(task.id).status, 'waiting_input');
    }
  } finally { await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('dubbing saves edited transcript into original timed cues rather than speaking stale subtitle text', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-dub-text-')); const studio = new StudioService(root);
  try {
    const project = await studio.invoke<Project>('project.save', { name: 'translation', kind: 'dub', data: { script: 'Bonjour', subtitle: '1\n00:00:01,000 --> 00:00:02,000\nHello\n' } });
    assert.ok(String(project.data.subtitle).includes('Bonjour')); assert.ok(String(project.data.subtitle).includes('00:00:01,000 --> 00:00:02,000'));
    await assert.rejects(studio.invoke('project.save', { id: project.id, name: project.name, kind: 'dub', data: { script: 'un seul bloc', subtitle: '1\n00:00:01,000 --> 00:00:02,000\nOne\n\n2\n00:00:03,000 --> 00:00:04,000\nTwo\n' } }), /cue|dòng|block/i);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('dubbing sidecar keeps the source clock when a legacy project contains an unused title card', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-dub-sidecar-')); const studio = new StudioService(root);
  try {
    const p = await studio.invoke<Project>('project.save', { name: 'Dub sidecar', kind: 'dub', data: { titleCard: 'Legacy unused card', subtitle: '1\n00:00:00,000 --> 00:00:00,300\nHello\n' } }); const asset = await studio.invoke<{ id: string }>('srt.export', { projectId: p.id }); const { readFileSync } = await import('node:fs'); const cues = await studio.invoke<Array<{ start: number; end: number }>>('srt.parse', { text: readFileSync(studio.store.assetPath(asset.id), 'utf8') }); assert.deepEqual(cues.map(cue => [cue.start, cue.end]), [[0, 0.3]]);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('series renders each episode independently and exposes its editable film project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-series-')); const studio = new StudioService(root);
  try {
    const image = join(root, 'scene.png'); const generated = spawnSync(require('ffmpeg-static') as string, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64', '-frames:v', '1', image]); assert.equal(generated.status, 0);
    const [asset] = await studio.importFiles([image]);
    const episodes = ['one', 'two'].map(id => ({ id, name: `Episode ${id}`, script: id, shots: [{ id, prompt: id, assetId: asset.id, duration: 0.2 }] }));
    const project = await studio.invoke<Project>('project.save', { name: 'two episodes', kind: 'series', data: { renderMode: 'slideshow', width: 64, height: 64, episodes } });
    const task = await studio.invoke<Task>('studio.run', { projectId: project.id });
    for (let n = 0; n < 500 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(20);
    const finished = studio.store.task(task.id); assert.equal(finished.status, 'succeeded', finished.error);
    assert.equal(finished.outputIds.length, 2);
    assert.equal(studio.store.projects().filter(item => item.kind === 'film' && item.data.seriesParentId === project.id).length, 2);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('series stages preserve episode plans and caches; shared cast edits mark films stale without replacing outputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-series-cache-')); const studio = new StudioService(root);
  const png = join(root, 'frame.png'); writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=', 'base64'));
  try {
    const [asset] = await studio.importFiles([png]); const cast = [{ id: 'mai', name: 'Mai', description: 'Blue outfit', assetId: asset.id }];
    const series = await studio.invoke<Project>('project.save', { name: 'Series', kind: 'series', data: { characters: cast, episodes: [{ id: 'ep1', name: 'Episode 1', script: 'Hello' }, { id: 'ep2', name: 'Episode 2', script: 'World' }] } });
    const episode = await studio.invoke<Project>('project.save', { name: 'Edited film', kind: 'film', data: { seriesParentId: series.id, episodeId: 'ep1', characters: cast, script: 'Hello', shots: [{ id: 'edited', prompt: 'Custom edited shot', assetId: asset.id, duration: 0.2 }], production: { images: { saved: asset.id } }, outputIds: [asset.id] } });
    const run = await studio.invoke<Task>('studio.run', { projectId: series.id, stage: 'images', shotIds: [`${series.id}/ep1/edited`] });
    for (let n = 0; n < 1000 && ['draft', 'queued', 'running'].includes(studio.store.task(run.id).status); n++) await delay(10);
    const done = studio.store.task(run.id); assert.equal(done.status, 'succeeded', done.error);
    assert.equal((studio.store.project(episode.id).data.shots as Array<{ prompt: string }>)[0].prompt, 'Custom edited shot');
    assert.equal((studio.store.project(episode.id).data.production as { images: Record<string, string> }).images.saved, asset.id);
    assert.deepEqual(studio.store.project(episode.id).data.outputIds, [asset.id]);
    await studio.invoke('project.save', { ...series, data: { ...series.data, characters: [{ ...cast[0], description: 'Red outfit' }] } });
    const changed = studio.store.project(episode.id); assert.equal(changed.data.productionStale, true); assert.equal((changed.data.characters as typeof cast)[0].description, 'Blue outfit'); assert.deepEqual(changed.data.outputIds, [asset.id]);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('editing one series episode marks only its existing film stale before any run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-episode-dirty-')); const studio = new StudioService(root);
  try {
    const episodes = ['one', 'two'].map(id => ({ id, name: id, script: id })); const p = await studio.invoke<Project>('project.save', { name: 'Series', kind: 'series', data: { episodes } });
    const films = episodes.map(episode => studio.store.saveProject({ name: episode.name, kind: 'film', data: { seriesParentId: p.id, episodeId: episode.id, script: episode.script, outputIds: ['historical'] } }));
    await studio.invoke('project.save', { ...p, data: { ...p.data, episodes: episodes.map((episode, index) => index === 0 ? { ...episode, script: 'Updated story' } : episode) } });
    assert.equal(studio.store.project(films[0].id).data.productionStale, true); assert.equal(studio.store.project(films[1].id).data.productionStale, undefined); assert.deepEqual(studio.store.project(films[0].id).data.outputIds, ['historical']);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('application license activation uses its own hub and device-bound signed token, never provider admin credentials', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const hub = createHub({ privateKey, adminToken: 'local-test-admin' });
  await new Promise<void>(resolve => hub.listen(0, '127.0.0.1', resolve));
  const address = hub.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const response = await fetch(base + '/admin/licenses', { method: 'POST', headers: { authorization: 'Bearer local-test-admin', 'content-type': 'application/json' }, body: JSON.stringify({ subject: 'local-test', expiresAt: Date.now() + 86400000, maxDevices: 1 }) });
  assert.equal(response.status, 200); const license = await response.json() as { key: string };
  const root = mkdtempSync(join(tmpdir(), 'maistudio-license-')); const other = mkdtempSync(join(tmpdir(), 'maistudio-license-other-'));
  const options = { commercial: true, licensePublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
  const studio = new StudioService(root, options); const second = new StudioService(other, options);
  try {
    await studio.invoke('settings.save', { providers: { license: { baseUrl: base, model: '' } } });
    assert.equal(studio.snapshot().license.valid, false);
    await assert.rejects(studio.invoke('license.activate', { key: 'arbitrary' }), /403/);
    await studio.invoke('license.activate', { key: license.key });
    assert.equal(studio.snapshot().license.valid, true);
    second.vault.save('license.token', studio.vault.get('license.token'));
    assert.equal(second.snapshot().license.valid, false);
    assert.equal(JSON.stringify(studio.snapshot()).includes(studio.vault.get('license.token')), false);
    await studio.invoke('license.deactivate'); assert.equal(studio.snapshot().license.valid, false);
  } finally { await studio.close(); await second.close(); hub.closeAllConnections(); await new Promise<void>(resolve => hub.close(() => resolve())); rmSync(root, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); }
});

test('a slideshow pipeline reuses selected local image assets without any provider and renders real video', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-service-')); const studio = new StudioService(root);
  try {
    const ffmpeg = require('ffmpeg-static') as string; const image = join(root, 'scene.png');
    const generated = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', image]);
    assert.equal(generated.status, 0, generated.stderr.toString());
    const [asset] = await studio.importFiles([image]);
    const project = await studio.invoke<Project>('project.save', { name: 'local render', kind: 'film', data: { renderMode: 'slideshow', width: 64, height: 64, shots: [{ id: 'one', prompt: 'red scene', duration: 0.2, assetId: asset.id }] } });
    const task = await studio.invoke<Task>('studio.run', { projectId: project.id });
    for (let n = 0; n < 500 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(20);
    const finished = studio.store.task(task.id);
    assert.equal(finished.status, 'succeeded', finished.error);
    assert.ok(finished.outputIds.length > 0); assert.equal(studio.store.asset(finished.outputIds[0]).mime, 'video/mp4');
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('count expands into bounded independent jobs and invalid references never leave saved tasks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-service-')); const studio = new StudioService(root);
  try {
    const project = await studio.invoke<Project>('project.save', { name: 'batch' });
    const tasks = await studio.invoke<Task[]>('task.create', { projectId: project.id, prompts: ['one', 'two'], kind: 'image', input: { count: 3 } });
    assert.equal(tasks.length, 6);
    assert.deepEqual(tasks.map(task => task.prompt), ['one', 'one', 'one', 'two', 'two', 'two']);
    await assert.rejects(studio.invoke('task.create', { projectId: project.id, prompts: ['bad'], kind: 'image', input: { refIds: ['missing'] } }), /asset|tệp/i);
    assert.equal(studio.store.tasks().length, 6);
    await assert.rejects(studio.invoke('task.create', { projectId: project.id, prompts: ['bad'], kind: 'image', input: { count: 0 } }), /count|số lượng/i);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('legacy clip window is unchanged', () => {
  const { clipWindow } = require('../src/core/studio') as typeof import('../src/core/studio');
  const speech = { duration: 10, voiced: 3, f0: null, parts: [{ start: 0.6, end: 2.1 }, { start: 2.3, end: 4.4 }, { start: 7.9, end: 8.3 }] } as any;
  const legacy = { affiliate: { contentStyle: 'review' } }, v2 = { ...legacy, affiliatePlanVersion: 2 };
  assert.deepEqual(clipWindow(legacy, 10, 3.75, speech, true), { start: 0.6 - 0.45, duration: 3.75, speechOverflow: true });
  assert.deepEqual(clipWindow({ pace: 'flow', fps: 24 }, 10, 3.75, speech), { start: 0.6 - 0.45, duration: Math.floor((8.3 + 0.75 - (0.6 - 0.45)) * 24) / 24 });
  assert.deepEqual(clipWindow(v2, 10, 3.75, speech, false), clipWindow(legacy, 10, 3.75, speech, false));
  assert.deepEqual(clipWindow(v2, 10, 3.75, undefined, true), { start: 0, duration: 3.75 });
  const window = clipWindow(v2, 10, 3.75, speech, true);
  assert.ok(Math.abs(window.start - 0.48) < 1e-9 && Math.abs(window.duration - 4.22) < 1e-9, JSON.stringify(window));
  assert.equal(window.truncated, false); assert.ok(!('speechOverflow' in window));
  const fashion = clipWindow({ affiliate: { contentStyle: 'fashion' }, affiliatePlanVersion: 2 }, 10, 6, speech, true);
  assert.ok(Math.abs(fashion.duration - 6) < 1e-9, 'fashion keeps the planned duration as a minimum');
});

test('v2 render places spoken clips by measured speech and stops on a cut-off line', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-v2-cut-')); const studio = new StudioService(root);
  const make = async (name: string, speech: number) => {
    const source = join(root, `${name}.mp4`);
    assert.equal(spawnSync(require('ffmpeg-static') as string, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=3.5', '-f', 'lavfi', '-i', `sine=frequency=180:sample_rate=16000:duration=${speech}`, '-filter_complex', '[1:a]adelay=1000:all=1,apad=whole_dur=3.5[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '3.5', source]).status, 0);
    return (await studio.importFiles([source]))[0];
  };
  const render = async (data: Record<string, unknown>) => {
    const p = await studio.invoke<Project>('project.save', { name: 'v2 spoken', kind: 'affiliate', data }), task = await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'render' });
    for (let n = 0; n < 1500 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10);
    return { project: p, task: studio.store.task(task.id) };
  };
  try {
    const short = await make('short', 1), cut = await make('cut', 2.5);
    const shots = (second: string) => ['one', 'two'].map((id, index) => ({ id, prompt: 'Shirt on the cabinet', videoAssetId: index ? second : short.id, duration: 0.5, start: index * 0.5, dialogue: 'Áo cotton mềm mại.', beat: 'hook', shotType: 'insert' }));
    const base = { affiliate: { contentStyle: 'review', hostMode: 'voiceover', screenText: false, seconds: 15 }, nativeAudio: true, keepAudio: true, width: 64, height: 64, product: { name: 'Shirt' } };
    const v2 = await render({ ...base, affiliatePlanVersion: 2, productLook: 'A white cotton shirt.', shots: shots(short.id) });
    assert.equal(v2.task.status, 'succeeded', v2.task.error);
    const video = await new MediaTools().probe(studio.store.assetPath(v2.task.outputIds[0]));
    assert.ok(video.duration > 2.4 && video.duration < 3.4, `two measured lines, not the 1 s plan: ${video.duration}`);
    const cues = await studio.invoke<Array<{ start: number; end: number }>>('srt.parse', { text: (studio.store.project(v2.project.id).data.production as any).subtitle });
    assert.equal(cues.length, 2); assert.ok(cues[1].start > 1.2 && cues[1].start >= cues[0].end, JSON.stringify(cues));
    const legacy = await render({ ...base, shots: shots(short.id) });
    assert.equal(legacy.task.status, 'succeeded', legacy.task.error); assert.match(legacy.task.message, /cảnh 1 \(dài hơn dự kiến\)/);
    const truncated = await render({ ...base, affiliatePlanVersion: 2, productLook: 'A white cotton shirt.', shots: shots(cut.id) });
    assert.equal(truncated.task.status, 'waiting_input'); assert.match(truncated.task.error, /bị cắt ở cuối clip/);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('partial v2 render stops with a clear message instead of misplacing cuts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-v2-partial-')); const studio = new StudioService(root);
  try {
    const source = join(root, 'line.mp4');
    assert.equal(spawnSync(require('ffmpeg-static') as string, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=3.5', '-f', 'lavfi', '-i', 'sine=frequency=180:sample_rate=16000:duration=1', '-filter_complex', '[1:a]adelay=1000:all=1,apad=whole_dur=3.5[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '3.5', source]).status, 0);
    const [clip] = await studio.importFiles([source]);
    const data = { affiliate: { contentStyle: 'review', hostMode: 'voiceover', screenText: false, seconds: 15 }, nativeAudio: true, keepAudio: true, width: 64, height: 64, product: { name: 'Shirt' },
      shots: ['one', 'two'].map((id, index) => ({ id, prompt: 'Shirt on the cabinet', videoAssetId: clip.id, duration: 0.5, start: index * 0.5, dialogue: 'Áo cotton mềm mại.', beat: 'hook', shotType: 'insert' })) };
    const run = async (extra: Record<string, unknown>) => {
      const p = await studio.invoke<Project>('project.save', { name: 'partial', kind: 'affiliate', data: { ...data, ...extra } });
      await assert.rejects(studio.invoke('studio.run', { projectId: p.id, stage: 'render', shotIds: ['one'] }), /Chỉ chọn shot/, 'the public API never renders a subset');
      const task = studio.store.createTasks({ projectId: p.id, kind: 'pipeline', prompts: ['Render'], input: { stage: 'render', projectSnapshot: p, shotIds: [`${encodeURIComponent(p.id)}/one`] } })[0];
      return (studio as unknown as { executePipeline(task: Task, context: unknown): Promise<unknown> }).executePipeline(task, { signal: new AbortController().signal, progress() {}, checkpoint() {} });
    };
    await assert.rejects(run({ affiliatePlanVersion: 2, productLook: 'A white cotton shirt.' }), /dựng toàn bộ/);
    await assert.rejects(run({}), /vượt khoảng dựng/, 'legacy partial render keeps its own behaviour');
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('v2 host portrait fingerprint follows the template group', () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-portrait-print-')); const studio = new StudioService(root);
  try {
    const print = (contentStyle: string, v2: boolean) => (studio as unknown as { characterFingerprint(project: Project, character: unknown): string }).characterFingerprint({ id: 'p', name: 'p', kind: 'affiliate', createdAt: 1, updatedAt: 1,
      data: { affiliate: { contentStyle }, product: { name: 'Shirt' }, productAssetIds: ['p1'], ...(v2 ? { affiliatePlanVersion: 2, productLook: 'A shirt.' } : {}) } }, { id: 'host', name: 'Minh', description: 'Short hair' });
    assert.notEqual(print('review', true), print('fashion', true));
    assert.equal(print('review', true), print('story', true)); assert.equal(print('fashion', true), print('fashion', true));
    assert.notEqual(print('review', true), print('review', false));
    assert.equal(print('review', false), print('fashion', false), 'legacy portraits do not depend on the style');
  } finally { void studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('v2 render measures truncation against the same length as review', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-v2-basis-')); const studio = new StudioService(root);
  try {
    // Audio stops at 3.0 s while the container runs to 3.5 s; the line runs to the end of the audio.
    const source = join(root, 'short-audio.mp4');
    assert.equal(spawnSync(require('ffmpeg-static') as string, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=3.5', '-f', 'lavfi', '-i', 'sine=frequency=180:sample_rate=16000:duration=2', '-filter_complex', '[1:a]adelay=1000:all=1[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]).status, 0);
    const [clip] = await studio.importFiles([source]);
    const p = await studio.invoke<Project>('project.save', { name: 'basis', kind: 'affiliate', data: { affiliate: { contentStyle: 'review', hostMode: 'voiceover', screenText: false, seconds: 15 }, affiliatePlanVersion: 2, productLook: 'A shirt.',
      nativeAudio: true, keepAudio: true, width: 64, height: 64, product: { name: 'Shirt' }, shots: [{ id: 'one', prompt: 'Shirt', videoAssetId: clip.id, duration: 3, start: 0, dialogue: 'Áo cotton mềm mại.', beat: 'hook', shotType: 'insert' }] } });
    const task = await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'render' });
    for (let n = 0; n < 1500 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10);
    const done = studio.store.task(task.id); assert.equal(done.status, 'waiting_input', done.error); assert.match(done.error, /bị cắt ở cuối clip/);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('v2 captions and flashes land on the measured cut points', async t => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-v2-cuts-')); const studio = new StudioService(root);
  const flashes: number[][] = []; const merge = MediaTools.prototype.merge;
  t.mock.method(MediaTools.prototype, 'merge', function (this: MediaTools, ...args: Parameters<MediaTools['merge']>) { flashes.push([...(args[2].flashes ?? [])]); return merge.apply(this, args); });
  try {
    const source = join(root, 'line.mp4');
    assert.equal(spawnSync(require('ffmpeg-static') as string, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=3.5', '-f', 'lavfi', '-i', 'sine=frequency=180:sample_rate=16000:duration=1.5', '-filter_complex', '[1:a]adelay=1000:all=1,apad=whole_dur=3.5[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '3.5', source]).status, 0);
    const [clip] = await studio.importFiles([source]);
    const shots = ['one', 'two', 'three'].map((id, index) => ({ id, prompt: 'Shirt on the cabinet', videoAssetId: clip.id, duration: 0.6, start: index * 0.6, dialogue: `Câu số ${index + 1} về áo.`, caption: `Chữ ${index + 1}`, beat: 'hook', shotType: 'insert', ...(index ? { transition: 'flash' } : {}) }));
    const p = await studio.invoke<Project>('project.save', { name: 'cuts', kind: 'affiliate', data: { affiliate: { contentStyle: 'review', hostMode: 'voiceover', screenText: true, endCard: false, aiLabel: false, adLabel: false, showPrice: false, seconds: 15 },
      affiliatePlanVersion: 2, productLook: 'A shirt.', nativeAudio: true, keepAudio: true, width: 64, height: 64, product: { name: 'Shirt' }, shots } });
    const task = await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'render' });
    for (let n = 0; n < 2000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10);
    const done = studio.store.task(task.id); assert.equal(done.status, 'succeeded', done.error);
    const { readFileSync } = await import('node:fs');
    const captions = await studio.invoke<Array<{ start: number; end: number; text: string }>>('srt.parse', { text: readFileSync(join(root, 'work', task.id, 'affiliate-captions.srt'), 'utf8') });
    const cuts = [0, ...captions.map(cue => cue.end)];
    assert.equal(captions.length, 3); assert.ok(cuts[3] > 3, `measured timeline ${cuts[3]} is longer than the 1.8 s plan`);
    captions.forEach((cue, index) => { assert.equal(cue.text, `Chữ ${index + 1}`); assert.ok(Math.abs(cue.start - cuts[index]) < 0.002); assert.ok(cue.end - cue.start > 1, JSON.stringify(captions)); });
    const flash = flashes.at(-1)!; assert.equal(flash.length, 2); flash.forEach((value, index) => assert.ok(Math.abs(value - cuts[index + 1]) < 0.002, `${flash} vs ${cuts}`));
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

// Speech at 1–2 s and 2.8–3.8 s with a 0.8 s silence between, the shape fast edit jump-cuts.
const gapClip = (root: string): string => {
  const source = join(root, 'gap.mp4');
  assert.equal(spawnSync(require('ffmpeg-static') as string, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=4.5', '-f', 'lavfi', '-i', "aevalsrc='sin(2*PI*180*t)*0.5*(between(t,1,2)+between(t,2.8,3.8))':s=16000:d=4.5", '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '4.5', source]).status, 0);
  return source;
};
const fastLine = 'Áo cotton mềm mại, mặc cả ngày rất thoáng mát.';
const talkProject = (clipId: string, affiliate: Record<string, unknown> = {}): Record<string, unknown> => ({
  affiliate: { contentStyle: 'review', hostMode: 'voiceover', screenText: false, seconds: 15, ...affiliate }, affiliatePlanVersion: 2, productLook: 'A white cotton shirt.',
  nativeAudio: true, keepAudio: true, width: 64, height: 64, product: { name: 'Shirt' },
  shots: ['one', 'two'].map((id, index) => ({ id, prompt: 'Shirt on the cabinet', videoAssetId: clipId, duration: 3.5, start: index * 3.5, dialogue: fastLine, caption: `Chữ ${index + 1}`, beat: 'hook', shotType: 'insert', ...(index ? { transition: 'flash' } : {}) })),
});
const captureMerge = (t: { mock: { method: Function } }): Array<{ inputs: Array<Record<string, any>>; options: Record<string, any> }> => {
  const calls: Array<{ inputs: Array<Record<string, any>>; options: Record<string, any> }> = []; const merge = MediaTools.prototype.merge;
  t.mock.method(MediaTools.prototype, 'merge', function (this: MediaTools, ...args: Parameters<MediaTools['merge']>) { calls.push({ inputs: structuredClone(args[0]) as any, options: structuredClone(args[2]) as any }); return merge.apply(this, args); });
  return calls;
};
const renderStage = async (studio: StudioService, projectId: string): Promise<Task> => {
  const task = await studio.invoke<Task>('studio.run', { projectId, stage: 'render' });
  for (let n = 0; n < 3000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10);
  return studio.store.task(task.id);
};

test('fast edit render cuts silences and speeds up spoken shots without zoom', async t => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-fast-')); const studio = new StudioService(root); const calls = captureMerge(t);
  try {
    const [clip] = await studio.importFiles([gapClip(root)]);
    const fast = await studio.invoke<Project>('project.save', { name: 'fast', kind: 'affiliate', data: talkProject(clip.id) });
    const done = await renderStage(studio, fast.id); assert.equal(done.status, 'succeeded', done.error);
    const inputs = calls.at(-1)!.inputs;
    assert.ok(inputs.length > 2, `more segments than shots: ${inputs.length}`);
    assert.ok(inputs.every(input => input.speed === 1.1), JSON.stringify(inputs));
    assert.ok(inputs.every(input => input.punch === undefined && input.pop === undefined), 'no automatic zoom');
    const { analyzeSpeech } = require('../src/core/acoustics') as typeof import('../src/core/acoustics');
    const speech = await analyzeSpeech(studio.store.assetPath(clip.id), require('ffmpeg-static') as string, new AbortController().signal);
    for (const shot of [inputs.slice(0, 2), inputs.slice(2)]) for (const part of speech.parts) assert.ok(shot.some(input => input.trimStart <= part.start && input.trimEnd >= part.end), `no spoken word is cut: ${JSON.stringify(part)} in ${JSON.stringify(shot)}`);
    const cues = await studio.invoke<Array<{ text: string }>>('srt.parse', { text: (studio.store.project(fast.id).data.production as any).subtitle });
    assert.ok(cues.length >= 4, JSON.stringify(cues));
    cues.forEach(cue => { const words = cue.text.split(/\s+/).length; assert.ok(words >= 2 && words <= 6, cue.text); });
    assert.equal(cues.map(cue => cue.text).join(' '), `${fastLine} ${fastLine}`);
    const plain = await studio.invoke<Project>('project.save', { name: 'plain', kind: 'affiliate', data: talkProject(clip.id, { pace: 'plain' }) });
    const whole = await renderStage(studio, plain.id); assert.equal(whole.status, 'succeeded', whole.error);
    const media = new MediaTools(); const short = await media.probe(studio.store.assetPath(done.outputIds[0])), long = await media.probe(studio.store.assetPath(whole.outputIds[0]));
    assert.ok(short.duration < long.duration - 1, `fast ${short.duration} vs plain ${long.duration}`);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

// Inputs and options captured from the same projects on main (before fast edit), with paths and floats normalised.
const mergeShape = (call: { inputs: Array<Record<string, any>>; options: Record<string, any> }, root: string): unknown => {
  const seen: string[] = []; const label = (path: string): string => `input${seen.includes(path) ? seen.indexOf(path) : seen.push(path) - 1}`;
  const { basename } = require('node:path') as typeof import('node:path');
  return JSON.parse(JSON.stringify({ inputs: call.inputs.map(input => ({ ...input, path: label(input.path) })), options: call.options },
    (_key, value) => typeof value === 'number' ? Math.round(value * 1000) / 1000 : typeof value === 'string' && value.startsWith(root) ? basename(value) : value));
};
const PLAIN_RENDERS: unknown = {
  plain: {"inputs": [{"path": "input0", "duration": 3.29, "start": 0, "trimStart": 0.836, "trimEnd": 4.126}, {"path": "input0", "duration": 3.29, "start": 3.29, "trimStart": 0.836, "trimEnd": 4.126}], "options": {"width": 64, "height": 64, "fps": 24, "fit": "pad", "keepAudio": true, "fadeIn": 0, "fadeOut": 0, "ducking": false, "motion": "none", "subtitleMarginV": 52, "overlayPath": "product-overlay.png", "captionPath": "affiliate-captions.srt", "flashes": [3.29]}, "subtitle": "1\n00:00:00,120 --> 00:00:02,990\nÁo cotton mềm mại, mặc cả ngày rất thoáng mát.\n\n2\n00:00:03,410 --> 00:00:06,280\nÁo cotton mềm mại, mặc cả ngày rất thoáng mát.\n", "captions": "1\n00:00:00,000 --> 00:00:03,290\nChữ 1\n\n2\n00:00:03,290 --> 00:00:06,580\nChữ 2\n"},
  legacy: {"inputs": [{"path": "input0", "duration": 3.5, "start": 0, "trimStart": 0.506, "trimEnd": 4.006}, {"path": "input0", "duration": 3.5, "start": 3.5, "trimStart": 0.506, "trimEnd": 4.006}], "options": {"width": 64, "height": 64, "fps": 24, "fit": "pad", "keepAudio": true, "fadeIn": 0, "fadeOut": 0, "ducking": false, "motion": "none", "subtitleMarginV": 52, "overlayPath": "product-overlay.png", "captionPath": "affiliate-captions.srt", "flashes": [3.5]}, "subtitle": "1\n00:00:00,450 --> 00:00:03,320\nÁo cotton mềm mại, mặc cả ngày rất thoáng mát.\n\n2\n00:00:03,950 --> 00:00:06,820\nÁo cotton mềm mại, mặc cả ngày rất thoáng mát.\n", "captions": "1\n00:00:00,000 --> 00:00:03,500\nChữ 1\n\n2\n00:00:03,500 --> 00:00:07,000\nChữ 2\n"},
  fashion: {"inputs": [{"path": "input0", "duration": 3.5, "start": 0, "trimStart": 0.836, "trimEnd": 4.336}, {"path": "input0", "duration": 3.5, "start": 3.5, "trimStart": 0.836, "trimEnd": 4.336}], "options": {"width": 64, "height": 64, "fps": 24, "fit": "pad", "keepAudio": true, "fadeIn": 0, "fadeOut": 0, "ducking": false, "motion": "none", "subtitleMarginV": 52, "overlayPath": "product-overlay.png", "captionPath": "affiliate-captions.srt", "flashes": [3.5]}, "subtitle": "1\n00:00:00,120 --> 00:00:02,990\nÁo cotton mềm mại, mặc cả ngày rất thoáng mát.\n\n2\n00:00:03,620 --> 00:00:06,490\nÁo cotton mềm mại, mặc cả ngày rất thoáng mát.\n", "captions": "1\n00:00:00,000 --> 00:00:03,500\nChữ 1\n\n2\n00:00:03,500 --> 00:00:07,000\nChữ 2\n"},
};

test('plain pace and legacy projects render as before', async t => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-plain-')); const studio = new StudioService(root); const calls = captureMerge(t);
  try {
    const [clip] = await studio.importFiles([gapClip(root)]);
    const text = { screenText: true, endCard: false, aiLabel: false, adLabel: false, showPrice: false };
    const { affiliatePlanVersion: _version, productLook: _look, ...legacy } = talkProject(clip.id, text);
    const cases: Record<string, Record<string, unknown>> = { plain: talkProject(clip.id, { ...text, pace: 'plain' }), legacy, fashion: talkProject(clip.id, { ...text, contentStyle: 'fashion' }) };
    const shapes: Record<string, unknown> = {};
    for (const [name, data] of Object.entries(cases)) {
      const p = await studio.invoke<Project>('project.save', { name, kind: 'affiliate', data });
      const done = await renderStage(studio, p.id); assert.equal(done.status, 'succeeded', `${name}: ${done.error}`);
      const { readFileSync } = await import('node:fs');
      shapes[name] = { ...(mergeShape(calls.at(-1)!, root) as object), subtitle: (studio.store.project(p.id).data.production as any).subtitle, captions: readFileSync(join(root, 'work', done.id, 'affiliate-captions.srt'), 'utf8') };
    }
    assert.deepEqual(shapes, PLAIN_RENDERS);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('affiliate render normalizes its music bed to -10 LUFS before the music volume', async t => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-music-')); const studio = new StudioService(root); const calls = captureMerge(t);
  try {
    const wav = join(root, 'quiet-music.wav');
    assert.equal(spawnSync(require('ffmpeg-static') as string, ['-v', 'error', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.02:sample_rate=48000', '-t', '8', wav]).status, 0);
    const [clip, music] = await studio.importFiles([gapClip(root), wav]);
    const project = await studio.invoke<Project>('project.save', { name: 'music', kind: 'affiliate', data: { ...talkProject(clip.id), musicId: music.id, musicVolume: 0.14, musicDucking: true } });
    const done = await renderStage(studio, project.id); assert.equal(done.status, 'succeeded', done.error);
    const options = calls.at(-1)!.options;
    assert.equal(options.musicLoudness, -10); assert.equal(options.volume, 0.14); assert.equal(options.musicPath, studio.store.assetPath(music.id));
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('changing pace or speech speed invalidates the rendered output', async t => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-pace-')); const studio = new StudioService(root); const calls = captureMerge(t);
  try {
    const [clip] = await studio.importFiles([gapClip(root)]);
    const p = await studio.invoke<Project>('project.save', { name: 'pace', kind: 'affiliate', data: { ...talkProject(clip.id), planning: { source: 'ai-api' }, planningNeedsUpdate: false, affiliateReview: { status: 'pass' } } });
    const first = await renderStage(studio, p.id); assert.equal(first.status, 'succeeded', first.error);
    let previous = (studio.store.project(p.id).data.production as any).render.assetId;
    const checks: Array<[Record<string, unknown>, (inputs: Array<Record<string, any>>) => boolean]> = [
      [{ speechSpeed: 1.2 }, inputs => inputs.length > 2 && inputs.every(input => input.speed === 1.2)],
      [{ pace: 'plain' }, inputs => inputs.length === 2 && inputs.every(input => input.speed === undefined && input.punch === undefined && input.pop === undefined)],
    ];
    for (const [change, check] of checks) {
      const latest = studio.store.project(p.id);
      const saved = await studio.invoke<Project>('project.save', { ...latest, data: { ...latest.data, affiliate: { ...(latest.data.affiliate as object), ...change } } });
      assert.equal(saved.data.productionStale, true, JSON.stringify(change));
      assert.notEqual(saved.data.planningNeedsUpdate, true, 'a render option does not ask for a new plan');
      assert.notEqual((saved.data.affiliateReview as any).stale, true, 'a render option does not invalidate the script review');
      const done = await renderStage(studio, p.id); assert.equal(done.status, 'succeeded', done.error);
      assert.ok(check(calls.at(-1)!.inputs), JSON.stringify(calls.at(-1)!.inputs));
      const render = (studio.store.project(p.id).data.production as any).render;
      assert.notEqual(render.assetId, previous); assert.equal(studio.store.project(p.id).data.productionStale, false); previous = render.assetId;
    }
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('fast edit captions and flashes land on the fast-edit cuts', async t => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-fast-cuts-')); const studio = new StudioService(root); const calls = captureMerge(t);
  try {
    const [clip] = await studio.importFiles([gapClip(root)]);
    const p = await studio.invoke<Project>('project.save', { name: 'fast cuts', kind: 'affiliate', data: talkProject(clip.id, { screenText: true, endCard: false, aiLabel: false, adLabel: false, showPrice: false }) });
    const done = await renderStage(studio, p.id); assert.equal(done.status, 'succeeded', done.error);
    const { inputs, options } = calls.at(-1)!;
    assert.equal(inputs.length, 4, 'two segments per shot');
    const cut = inputs[2].start, total = inputs[3].start + inputs[3].duration;
    const { readFileSync } = await import('node:fs');
    const captions = await studio.invoke<Array<{ start: number; end: number; text: string }>>('srt.parse', { text: readFileSync(join(root, 'work', done.id, 'affiliate-captions.srt'), 'utf8') });
    assert.deepEqual(captions.map(cue => cue.text), ['Chữ 1', 'Chữ 2']);
    for (const [actual, expected] of [[captions[0].start, 0], [captions[0].end, cut], [captions[1].start, cut], [captions[1].end, total]]) assert.ok(Math.abs(actual - expected) < 0.002, `${JSON.stringify(captions)} vs cut ${cut}, total ${total}`);
    assert.equal(options.flashes.length, 1); assert.ok(Math.abs(options.flashes[0] - cut) < 1e-9, `${options.flashes} vs ${cut}`);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

async function spokenClips(root: string, studio: StudioService) {
  const make = async (name: string, speech: number) => {
    const source = join(root, `${name}.mp4`);
    assert.equal(spawnSync(require('ffmpeg-static') as string, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=3.5', '-f', 'lavfi', '-i', `sine=frequency=180:sample_rate=16000:duration=${speech}`, '-filter_complex', '[1:a]adelay=1000:all=1,apad=whole_dur=3.5[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '3.5', source]).status, 0);
    return (await studio.importFiles([source]))[0];
  };
  const short = await make('short', 1), cut = await make('cut', 2.5);
  const shots = (second: string) => ['one', 'two'].map((id, index) => ({ id, prompt: 'Shirt on the cabinet', videoAssetId: index ? second : short.id, duration: 0.5, start: index * 0.5, dialogue: 'Áo cotton mềm mại.', beat: 'hook', shotType: 'insert' }));
  const base = { affiliate: { contentStyle: 'review', hostMode: 'voiceover', screenText: false, seconds: 15 }, affiliateReview: { status: 'pass' }, nativeAudio: true, keepAudio: true, width: 64, height: 64, product: { name: 'Shirt' } };
  const run = async (data: Record<string, unknown>, stage: string) => {
    const p = await studio.invoke<Project>('project.save', { name: 'spoken', kind: 'affiliate', data }), task = await studio.invoke<Task>('studio.run', { projectId: p.id, stage });
    for (let n = 0; n < 3000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10);
    return { project: p, task: studio.store.task(task.id) };
  };
  return { short, cut, shots, base, run };
}

test('legacy affiliate run-all with an overflowing line renders by measured speech without cutting words', async t => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-legacy-overflow-')); const studio = new StudioService(root);
  const merges: Array<Array<Record<string, any>>> = []; const merge = MediaTools.prototype.merge;
  t.mock.method(MediaTools.prototype, 'merge', function (this: MediaTools, ...args: Parameters<MediaTools['merge']>) { merges.push(structuredClone(args[0]) as any); return merge.apply(this, args); });
  try {
    const { analyzeSpeech } = require('../src/core/acoustics') as typeof import('../src/core/acoustics');
    const { short, cut, shots, base, run } = await spokenClips(root, studio);
    const legacy = await run({ ...base, autoChecks: true, qualityRetries: 0, shots: shots(short.id) }, 'all');
    assert.equal(legacy.task.status, 'succeeded', legacy.task.error);
    assert.equal(legacy.task.message, 'Đã xuất video Affiliate. 2 cảnh cần xem lại: cảnh 1 (Lời nói vượt thời lượng shot; dài hơn dự kiến), cảnh 2 (Lời nói vượt thời lượng shot; dài hơn dự kiến).', 'the repair instruction for the model is not shown');
    const inputs = merges.at(-1)!; assert.equal(inputs.length, 2);
    let at = 0;
    for (const input of inputs) {
      const speech = await analyzeSpeech(input.path, new MediaTools().executablePath);
      assert.ok(input.trimStart <= speech.parts[0].start && input.trimEnd >= speech.parts.at(-1)!.end, `every spoken part stays inside the segment: ${JSON.stringify({ input, parts: speech.parts })}`);
      assert.ok(Math.abs(input.start - at) < 1e-6, 'clips follow each other by measured speech'); at = input.start + input.duration;
    }
    const video = await new MediaTools().probe(studio.store.assetPath(legacy.task.outputIds[0]));
    assert.ok(video.duration > 2.4, `two measured lines, not the 1 s plan: ${video.duration}`);
    const attention = (studio.store.project(legacy.project.id).data.production as any).attention;
    assert.deepEqual(attention.map((item: any) => item.shot), ['cảnh 1', 'cảnh 2']);
    const truncated = await run({ ...base, affiliatePlanVersion: 2, productLook: 'A white cotton shirt.', autoChecks: true, qualityRetries: 0, shots: shots(cut.id) }, 'all');
    assert.equal(truncated.task.status, 'succeeded', truncated.task.error);
    assert.match(truncated.task.message, /cảnh 2 \([^)]*câu cuối bị cụt trong clip gốc\)/);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('manual render of a legacy affiliate project with a cut-off line still waits and names the shot to regenerate', async t => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-manual-cut-')); const studio = new StudioService(root);
  const merges: Array<Array<Record<string, any>>> = []; const merge = MediaTools.prototype.merge;
  t.mock.method(MediaTools.prototype, 'merge', function (this: MediaTools, ...args: Parameters<MediaTools['merge']>) { merges.push(structuredClone(args[0]) as any); return merge.apply(this, args); });
  try {
    const { analyzeSpeech } = require('../src/core/acoustics') as typeof import('../src/core/acoustics');
    const { short, cut, shots, base, run } = await spokenClips(root, studio);
    const legacy = await run({ ...base, autoChecks: true, shots: shots(short.id) }, 'render');
    assert.equal(legacy.task.status, 'succeeded', legacy.task.error);
    assert.equal(legacy.task.message, 'Đã xuất video Affiliate. 2 cảnh cần xem lại: cảnh 1 (dài hơn dự kiến), cảnh 2 (dài hơn dự kiến).');
    let at = 0;
    for (const input of merges.at(-1)!) {
      const speech = await analyzeSpeech(input.path, new MediaTools().executablePath);
      assert.ok(input.trimStart <= speech.parts[0].start && input.trimEnd >= speech.parts.at(-1)!.end, JSON.stringify({ input, parts: speech.parts }));
      assert.ok(Math.abs(input.start - at) < 1e-6); at = input.start + input.duration;
    }
    for (const data of [{ ...base, autoChecks: true, shots: shots(cut.id) }, { ...base, affiliatePlanVersion: 2, productLook: 'A white cotton shirt.', autoChecks: true, shots: shots(cut.id) }]) {
      const truncated = await run(data, 'render');
      assert.equal(truncated.task.status, 'waiting_input'); assert.match(truncated.task.error, /cảnh 2 bị cắt ở cuối clip/); assert.match(truncated.task.error, /"Tạo lại clip riêng cảnh này" ở cảnh 2/);
      assert.doesNotMatch(truncated.task.error, /Chạy toàn bộ|%2F|\//, 'no run-all advice and no internal shot id');
    }
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('legacy affiliate run-all with a cut-off line renders it and lists the shot', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-legacy-cut-')); const studio = new StudioService(root);
  try {
    const { cut, shots, base, run } = await spokenClips(root, studio);
    const done = await run({ ...base, autoChecks: true, qualityRetries: 0, shots: shots(cut.id) }, 'all');
    assert.equal(done.task.status, 'succeeded', done.task.error);
    assert.match(done.task.message, /cảnh 2 \([^)]*dài hơn dự kiến; câu cuối bị cụt trong clip gốc\)/);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('a Video Aff run that stops clears the previous run shots-to-review list', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-attention-clear-')); const studio = new StudioService(root);
  try {
    const { cut, shots, base } = await spokenClips(root, studio);
    const p = await studio.invoke<Project>('project.save', { name: 'clear', kind: 'affiliate', data: { ...base, affiliatePlanVersion: 2, productLook: 'A white cotton shirt.', autoChecks: true, qualityRetries: 0, shots: shots(cut.id) } });
    const run = async (stage: string) => { const task = await studio.invoke<Task>('studio.run', { projectId: p.id, stage }); for (let n = 0; n < 3000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); n++) await delay(10); return studio.store.task(task.id); };
    assert.equal((await run('all')).status, 'succeeded');
    assert.ok((studio.store.project(p.id).data.production as any).attention.length);
    assert.equal((await run('render')).status, 'waiting_input');
    assert.equal((studio.store.project(p.id).data.production as any).attention, undefined, 'a stopped run never leaves the previous list');
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});
