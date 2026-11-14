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
