import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioService } from '../src/core/studio';
import type { Project, Task } from '../src/shared/studio';
import { MediaTools, parseSrt } from '../src/core/media';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=', 'base64');
async function fixture(run: (studio: StudioService, imageId: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'mai-affiliate-flow-')), studio = new StudioService(root);
  try { const file = join(root, 'product.png'); writeFileSync(file, png); const [image] = await studio.importFiles([file]); await run(studio, image.id); }
  finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
}

test('Affiliate configuration and every presenter/background/outfit reference are validated before saving', async () => {
  await fixture(async (studio, imageId) => {
    const input = { name: 'Affiliate config', kind: 'affiliate', data: { product: { name: 'Shirt' }, productAssetIds: [imageId] } };
    await assert.rejects(studio.invoke('project.save', { ...input, data: { ...input.data, affiliate: { seconds: 1 } } }), /seconds|duration|thời lượng/i);
    for (const affiliate of [{ presenterAssetId: 'missing' }, { backgroundAssetId: 'missing' }, { outfitAssetIds: ['missing'] }]) await assert.rejects(studio.invoke('project.save', { ...input, data: { ...input.data, affiliate } }), /asset|tài nguyên|reference|không tồn tại/i);
    const saved = await studio.invoke<Project>('project.save', { ...input, data: { ...input.data, affiliate: { presenterAssetId: imageId, backgroundAssetId: imageId, outfitAssetIds: [imageId] } } });
    assert.ok(saved.data.affiliate);
  });
});

function candidate() {
  return { name: 'Áo cotton', summary: 'Giới thiệu áo cotton có nguồn', postCaption: 'Áo cotton màu xanh.', hashtags: ['#AoCotton'], characters: [], scenes: [{ id: 'scene', location: 'Studio', characterIds: [] }], shots: ['hook', 'detail', 'demo', 'cta'].map((beat, index) => ({ id: `shot-${index + 1}`, sceneId: 'scene', prompt: 'Hands display the supplied blue cotton shirt', action: 'Unfold the actual shirt', videoPrompt: 'Hands slowly unfold the shirt', duration: 3.75, start: index * 3.75, characterIds: [], beat, caption: index ? 'Cotton màu xanh' : 'Áo cotton' })) };
}
const verdict = (status: 'pass' | 'fail' | 'unknown') => Object.fromEntries(['facts', 'structure', 'host'].map(key => [key, { status: key === 'facts' ? status : 'pass', reason: status === 'fail' && key === 'facts' ? 'Remove the unsupported claim' : 'Controlled source comparison' }]));
async function settle(studio: StudioService, id: string) {
  for (let index = 0; index < 1500; index++) { const task = studio.store.task(id); if (!['draft', 'queued', 'running'].includes(task.status)) return task; await delay(10); }
  throw new Error('Affiliate task did not settle');
}

async function dubFixture(run: (studio: StudioService, project: Project, calls: Array<Record<string, unknown>>, reply: (mode: 'ok' | 'fail' | 'hold' | 'long' | 'wrong') => void, asrUploads: Buffer[]) => Promise<void>) {
  await fixture(async (studio, imageId) => {
    const video = join(studio.store.root, 'native.mp4'), wav = join(studio.store.root, 'tts.wav'), calls: Array<Record<string, unknown>> = [];
    assert.equal(spawnSync(require('ffmpeg-static'), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=10:d=4', '-f', 'lavfi', '-i', 'sine=frequency=120:sample_rate=16000:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]).status, 0);
    assert.equal(spawnSync(require('ffmpeg-static'), ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=900:sample_rate=16000:duration=1.4', wav]).status, 0);
    const longWav = join(studio.store.root, 'long.wav');
    assert.equal(spawnSync(require('ffmpeg-static'), ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=900:sample_rate=16000:duration=8', longWav]).status, 0);
    let mode = 'ok'; const audio = readFileSync(wav), longAudio = readFileSync(longWav), asrUploads: Buffer[] = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks), body = raw.toString();
      if (req.url?.endsWith('/audio/transcriptions')) {
        asrUploads.push(raw); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ text: mode === 'wrong' ? 'Completely different words' : 'Hello product' })); return;
      }
      if (req.url?.endsWith('/chat/completions')) {
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(Object.fromEntries(['scene', 'face', 'outfit', 'product'].map(key => [key, { status: key === 'face' || key === 'outfit' ? 'not_applicable' : 'pass', reason: 'Owned controlled image fixture' }]))) } }] })); return;
      }
      calls.push(JSON.parse(body)); if (mode === 'hold') return;
      if (mode === 'fail') { res.writeHead(503); res.end('{}'); return; }
      res.setHeader('content-type', 'audio/wav'); res.end(mode === 'long' ? longAudio : audio);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address() as import('node:net').AddressInfo;
      await studio.invoke('settings.save', { providers: { voice: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'owned-tts-fixture' } } });
      const [clip] = await studio.importFiles([video]);
      const project = await studio.invoke<Project>('project.save', { name: 'Optional dub', kind: 'affiliate', data: {
        product: { name: 'Shirt' }, productAssetIds: [imageId], affiliate: { hostMode: 'voiceover', seconds: 15, screenText: false },
        affiliateDub: true, voiceId: 'chosen-voice', affiliateVoiceSpeed: 1.1, nativeAudio: true, narrationMode: 'native', keepAudio: true,
        affiliateReview: { status: 'pass' }, autoChecks: false, videoReview: false, width: 64, height: 64, fps: 10,
        shots: candidate().shots.map((shot, index) => ({ ...shot, assetId: imageId, videoAssetId: clip.id, ...(index < 2 ? { dialogue: 'Hello product' } : {}) })),
      } });
      await run(studio, project, calls, value => { mode = value; }, asrUploads);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
}

test('Affiliate dub speech is cached and render replaces native audio without contacting TTS', async () => {
  await dubFixture(async (studio, project, calls) => {
    const run = async (stage: string) => settle(studio, (await studio.invoke<Task>('studio.run', { projectId: project.id, stage })).id);
    assert.equal((await run('render')).status, 'waiting_input'); assert.equal(calls.length, 0);
    const speech = await run('speech'); assert.equal(speech.status, 'succeeded', speech.error); assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.voice === 'chosen-voice' && call.input === 'Hello product'));
    assert.equal((await run('speech')).status, 'succeeded'); assert.equal(calls.length, 2);
    const rendered = await run('render'); assert.equal(rendered.status, 'succeeded', rendered.error); assert.equal(calls.length, 2);
    const asset = rendered.outputIds.find(id => studio.store.asset(id).mime.startsWith('video/'))!;
    const info = await new MediaTools().probe(studio.store.assetPath(asset)); assert.ok(info.hasAudio); assert.ok(Math.abs(info.duration - 15) < 0.11);
    const pcm = spawnSync(require('ffmpeg-static'), ['-v', 'error', '-i', studio.store.assetPath(asset), '-map', '0:a:0', '-af', 'bandpass=f=120:width_type=q:width=10', '-f', 'f32le', '-ac', '1', '-ar', '8000', 'pipe:1']).stdout;
    let sum = 0; for (let i = 0; i < pcm.length; i += 4) sum += pcm.readFloatLE(i) ** 2;
    const leakage = Math.sqrt(sum / (pcm.length / 4));
    assert.ok(leakage < 0.003, `native 120Hz audio must be replaced, including non-speaking shots: RMS ${leakage}`);
    assert.equal((await run('render')).status, 'succeeded'); assert.equal(calls.length, 2);
    assert.equal((await run('all')).status, 'succeeded'); assert.equal(calls.length, 2, 'all-stage retries reuse completed TTS');
    const saved = studio.store.project(project.id);
    await studio.invoke('project.save', { ...saved, data: { ...saved.data, affiliateVoiceSpeed: 1.25 } });
    assert.equal((await run('speech')).status, 'succeeded'); assert.equal(calls.length, 2, 'local speed changes reuse the original TTS');
    assert.equal((await run('render')).status, 'succeeded'); assert.equal(calls.length, 2);
    const changed = studio.store.project(project.id);
    await studio.invoke('project.save', { ...changed, data: { ...changed.data, voiceId: 'another-voice' } });
    assert.equal((await run('render')).status, 'waiting_input'); assert.equal(calls.length, 2, 'render never speaks a stale selected voice');
    assert.equal((await run('speech')).status, 'succeeded'); assert.equal(calls.length, 4); assert.ok(calls.slice(-2).every(call => call.voice === 'another-voice'));
    assert.equal((await run('render')).status, 'succeeded');
    await studio.invoke('settings.save', { providers: { voice: { baseUrl: '', model: '' } } });
    const offlineRender = await run('render'); assert.equal(offlineRender.status, 'succeeded', offlineRender.error); assert.equal(calls.length, 4, 'cached render remains provider-free after disconnecting TTS');
  });
});

test('Affiliate dub admission rejects missing voice/provider and never retries ambiguous or cancelled TTS', async () => {
  await dubFixture(async (studio, project, calls, reply) => {
    for (const affiliate of [{ hostMode: 'silent' }, { contentStyle: 'asmr' }]) await assert.rejects(studio.invoke('project.save', { ...project, data: { ...project.data, affiliate } }), /spoken|ASMR|silent|không lời/i);
    await assert.rejects(studio.invoke('project.save', { ...project, data: { ...project.data, voiceId: '' } }), /voice/i);
    const provider = studio.store.settings().providers.voice;
    await studio.invoke('settings.save', { providers: { voice: { baseUrl: '', model: '' } } });
    const before = studio.store.tasks().length;
    for (const stage of ['plan', 'music', 'characters', 'images', 'videos', 'speech', 'all']) await assert.rejects(studio.invoke('studio.run', { projectId: project.id, stage }), /provider|cấu hình/i);
    assert.equal(studio.store.tasks().length, before, 'missing TTS cannot admit planning or media work'); assert.equal(calls.length, 0);
    await studio.invoke('settings.save', { providers: { voice: provider } });
    reply('fail'); const failed = await studio.invoke<Task>('studio.run', { projectId: project.id, stage: 'speech' });
    assert.equal((await settle(studio, failed.id)).status, 'failed'); assert.equal(calls.length, 1);
    await studio.invoke('task.action', { action: 'retry', ids: [failed.id] });
    assert.equal((await settle(studio, failed.id)).status, 'waiting_input'); assert.equal(calls.length, 1);
  });
  await dubFixture(async (studio, project, calls, reply) => {
    reply('hold'); const task = await studio.invoke<Task>('studio.run', { projectId: project.id, stage: 'speech' });
    for (let i = 0; i < 500 && !calls.length; i++) await delay(10); assert.equal(calls.length, 1);
    await studio.invoke('task.action', { action: 'cancel', ids: [task.id] });
    assert.equal((await settle(studio, task.id)).status, 'cancelled');
    await studio.invoke('task.action', { action: 'retry', ids: [task.id] });
    assert.equal((await settle(studio, task.id)).status, 'waiting_input'); assert.equal(calls.length, 1);
  });
});

test('Affiliate dub refuses an overlong voice without publishing clipped words and keeps its TTS cache', async () => {
  await dubFixture(async (studio, project, calls, reply) => {
    reply('long'); const run = async (stage: string) => settle(studio, (await studio.invoke<Task>('studio.run', { projectId: project.id, stage })).id);
    const speech = await run('speech'); assert.equal(speech.status, 'succeeded', speech.error); assert.equal(calls.length, 2);
    const rendered = await run('render'); assert.equal(rendered.status, 'waiting_input', rendered.error); assert.match(rendered.error, /không cắt|Voice fit/);
    assert.equal(rendered.outputIds.length, 0); assert.equal(calls.length, 2);
    assert.equal((await run('render')).status, 'waiting_input'); assert.equal(calls.length, 2);
    const data = studio.store.project(project.id).data as any;
    assert.equal(Object.keys(data.production.speech).length, 2); assert.equal(data.production.render, undefined);
  });
});

test('Affiliate dub speech review assesses the fitted current TTS clip, not the replaced native voice', async t => {
  await dubFixture(async (studio, project, calls, reply, uploads) => {
    const baseUrl = studio.store.settings().providers.voice.baseUrl;
    await studio.invoke('settings.save', { providers: { asr: { baseUrl, model: 'whisper-1' }, text: { baseUrl, model: 'controlled-vision' } } });
    const offline = (studio as unknown as { offline: { ready(): boolean; embed(path: string, signal: AbortSignal): Promise<number[]> } }).offline;
    t.mock.method(offline, 'ready', () => true);
    t.mock.method(offline, 'embed', async () => Array.from({ length: 256 }, (_, index) => index === 0 ? 1 : 0));
    const run = async (stage: string) => settle(studio, (await studio.invoke<Task>('studio.run', { projectId: project.id, stage })).id);
    const speech = await run('speech'); assert.equal(speech.status, 'succeeded', speech.error);
    const check = await run('check'); assert.equal(check.status, 'succeeded', check.error); assert.equal(calls.length, 2); assert.equal(uploads.length, 2);
    const data = studio.store.project(project.id).data as any;
    for (const shot of data.shots.slice(0, 2)) {
      const key = `${project.id}/${shot.id}`, dub = data.production.affiliateDubs[key], review = data.qualityReviews[key].speech;
      assert.equal(review.assetId, dub.assetId); assert.notEqual(review.assetId, shot.videoAssetId);
      assert.equal(review.status, 'pass'); assert.equal(review.heard, 'Hello product');
      const bytes = readFileSync(studio.store.assetPath(dub.assetId)); assert.ok(uploads.some(body => body.includes(bytes)), 'ASR receives the actual fitted dub bytes');
    }
    reply('wrong'); const latest = studio.store.project(project.id);
    await studio.invoke('project.save', { ...latest, data: { ...latest.data, affiliateVoiceSpeed: 0.8 } });
    const wrong = await run('check'); assert.equal(wrong.status, 'succeeded', wrong.error); assert.match(wrong.message, /chưa đạt/);
    assert.equal(calls.length, 2, 'review and local speed changes never synthesize again');
    assert.equal((studio.store.project(project.id).data.qualityReviews as any)[`${project.id}/shot-1`].speech.status, 'fail');
    const failed = studio.store.project(project.id);
    await studio.invoke('project.save', { ...failed, data: { ...failed.data, autoChecks: true, qualityRetries: 0 } });
    const blocked = await run('all'); assert.equal(blocked.status, 'waiting_input', blocked.error); assert.equal(calls.length, 2, 'failed spoken QC cannot trigger unrequested native video or TTS regeneration');
  });
});
async function plannedFixture(run: (studio: StudioService, project: Project, calls: Array<{ prompt: string; images: string[] }>, decide: (fn: (review: boolean, index: number) => unknown) => void) => Promise<void>) {
  await fixture(async (studio, imageId) => {
    const calls: Array<{ prompt: string; images: string[] }> = []; let answer = (review: boolean, _index: number): unknown => review ? verdict('pass') : candidate();
    const server = createServer(async (request, response) => {
      let body = ''; for await (const chunk of request) body += chunk;
      const message = JSON.parse(body).messages[0].content, content = typeof message === 'string' ? [{ type: 'text', text: message }] : message;
      const prompt = content.find((part: any) => part.type === 'text').text, images = content.filter((part: any) => part.type === 'image_url').map((part: any) => part.image_url.url);
      calls.push({ prompt, images }); const value = await answer(prompt.startsWith('Act as an independent Affiliate'), calls.length - 1);
      if (value === 'disconnect') { response.writeHead(503); response.end('{}'); return; }
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address() as import('node:net').AddressInfo;
      await studio.invoke('settings.save', { providers: { text: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'controlled-affiliate' } } });
      const project = await studio.invoke<Project>('project.save', { name: 'Affiliate source', kind: 'affiliate', data: { product: { name: 'Áo cotton', description: 'Cotton màu xanh', price: '120.000₫' }, productAssetIds: [imageId], affiliate: { contentStyle: 'review', hostMode: 'silent', seconds: 15 }, production: { previousOutput: 'retained' } } });
      await run(studio, project, calls, fn => { answer = fn; });
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
}

test('Affiliate planning uploads actual product references and requires an independent source review before applying', async () => {
  await plannedFixture(async (studio, project, calls) => {
    const task = await studio.invoke<Task>('studio.run', { projectId: project.id, stage: 'plan' }), done = await settle(studio, task.id);
    assert.equal(done.status, 'succeeded', done.error); assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.images.length === 1 && call.images[0].endsWith(png.toString('base64'))));
    const data = studio.store.project(project.id).data as any;
    assert.equal(data.shots.length, 4); assert.equal(data.shots[0].beat, 'hook'); assert.equal(data.shots[0].caption, 'Áo cotton'); assert.equal(data.nativeAudio, false);
    assert.equal(data.affiliateReview.status, 'pass'); assert.equal(data.affiliateReview.attempts, 1); assert.equal(data.production.previousOutput, 'retained');
    await studio.invoke('task.action', { action: 'retry', ids: [task.id] }); await delay(20); assert.equal(calls.length, 2, 'completed planning must never be bought twice');
  });
});

test('a Muse-shaped planner reply is saved as a v2 plan and reviewed against the v2 shape', async () => {
  await plannedFixture(async (studio, project, calls, decide) => {
    const muse = { ...candidate(), productLook: 'A blue short-sleeve cotton shirt.', shots: candidate().shots.map((shot, index) => ({ ...shot, beat: ['hook', 'benefit', 'demo', 'cta'][index], shotType: 'insert', productVisible: index !== 2 })) };
    decide(review => review ? verdict('pass') : muse);
    const task = await studio.invoke<Task>('studio.run', { projectId: project.id, stage: 'plan' }), done = await settle(studio, task.id);
    assert.equal(done.status, 'succeeded', done.error); assert.equal(calls.length, 2);
    const data = studio.store.project(project.id).data as any;
    assert.equal(data.affiliatePlanVersion, 2); assert.equal(data.productLook, muse.productLook); assert.equal(data.shots[2].productVisible, false);
    assert.match(calls[0].prompt, /MUSE SHAPE/); assert.match(calls[1].prompt, /Muse shape/);
  });
});

test('Run all plans and reviews a newly imported product before asking for a media account', async () => {
  await plannedFixture(async (studio, project, calls) => {
    const task = await studio.invoke<Task>('studio.run', { projectId: project.id, stage: 'all' }), done = await settle(studio, task.id);
    assert.equal(done.status, 'waiting_input', done.error);
    assert.equal(calls.length, 2, 'the initial all-stage job must create and independently review its plan first');
    assert.equal((studio.store.project(project.id).data.shots as any[]).length, 4);
    assert.equal((studio.store.project(project.id).data.affiliateReview as any).status, 'pass');
  });
});

test('a failed Affiliate script is repaired once and reviewed again, while unknown preserves the existing project', async () => {
  await plannedFixture(async (studio, project, calls, decide) => {
    decide((review, index) => review ? verdict(index === 1 ? 'fail' : 'pass') : candidate());
    const task = await studio.invoke<Task>('studio.run', { projectId: project.id, stage: 'plan' }), done = await settle(studio, task.id);
    assert.equal(done.status, 'succeeded', done.error); assert.equal(calls.length, 4); assert.match(calls[2].prompt, /unsupported claim/);
    assert.equal((studio.store.project(project.id).data.affiliateReview as any).attempts, 2);
  });
  await plannedFixture(async (studio, project, calls, decide) => {
    decide(review => review ? verdict('unknown') : candidate());
    const task = await studio.invoke<Task>('studio.run', { projectId: project.id, stage: 'plan' });
    assert.equal((await settle(studio, task.id)).status, 'waiting_input'); assert.deepEqual(studio.store.project(project.id).data, project.data);
    await studio.invoke('task.action', { action: 'resume', ids: [task.id] }); assert.equal((await settle(studio, task.id)).status, 'waiting_input'); assert.equal(calls.length, 2);
  });
});

test('ambiguous Affiliate provider admission is never resubmitted and a concurrent content edit is preserved', async () => {
  await plannedFixture(async (studio, project, calls, decide) => {
    decide(() => 'disconnect'); const task = await studio.invoke<Task>('studio.run', { projectId: project.id, stage: 'plan' });
    assert.equal((await settle(studio, task.id)).status, 'failed'); await studio.invoke('task.action', { action: 'retry', ids: [task.id] });
    assert.equal((await settle(studio, task.id)).status, 'waiting_input'); assert.equal(calls.length, 1);
  });
  await plannedFixture(async (studio, project, _calls, decide) => {
    decide(review => { if (review) studio.store.saveProject({ ...project, data: { ...project.data, script: 'New user edit' } }); return review ? verdict('pass') : candidate(); });
    const task = await studio.invoke<Task>('studio.run', { projectId: project.id, stage: 'plan' }); assert.equal((await settle(studio, task.id)).status, 'waiting_input');
    assert.equal(studio.store.project(project.id).data.script, 'New user edit'); assert.equal(studio.store.project(project.id).data.shots, undefined);
  });
});

test('Affiliate render keeps captions, timed end card and post text inside the actual fifteen-second export without a provider', async () => {
  await fixture(async (studio, imageId) => {
    const clip = join(studio.store.root, 'clip.mp4'), generated = spawnSync(require('ffmpeg-static'), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=240x426:r=10:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
    assert.equal(generated.status, 0, generated.stderr.toString()); const [video] = await studio.importFiles([clip]);
    const raw = candidate(), project = await studio.invoke<Project>('project.save', { name: 'Affiliate final', kind: 'affiliate', data: { product: { name: 'Áo cotton', price: '120.000₫' }, productSource: { capturedAt: '2026-11-16T09:47:36.686Z' }, productAssetIds: [imageId], affiliate: { hostMode: 'silent', seconds: 15, cta: 'Xem sản phẩm' }, affiliatePost: { caption: 'Áo cotton màu xanh.', hashtags: ['#AoCotton'] }, shots: raw.shots.map((shot, index) => ({ ...shot, assetId: imageId, videoAssetId: video.id, ...(index === 1 ? { transition: 'flash' } : {}) })), nativeAudio: false, narrationMode: 'none', width: 240, height: 426, fps: 10 } });
    const task = await studio.invoke<Task>('studio.run', { projectId: project.id, stage: 'render' }), done = await settle(studio, task.id);
    assert.equal(done.status, 'succeeded', done.error); assert.equal(done.outputIds.length, 2);
    const movie = studio.store.assets().find(asset => done.outputIds.includes(asset.id) && asset.mime.startsWith('video/'))!, post = studio.store.assets().find(asset => done.outputIds.includes(asset.id) && asset.mime === 'text/plain')!;
    assert.ok(movie && post); const info = await new MediaTools().probe(studio.store.assetPath(movie.id)); assert.ok(Math.abs(info.duration - 15) < 0.15, String(info.duration));
    const text = readFileSync(studio.store.assetPath(post.id), 'utf8'); assert.match(text, /Áo cotton màu xanh/); assert.match(text, /#AoCotton/); assert.match(text, /2026|16\/11/);
    const frame = (time: number) => { const decoded = spawnSync(require('ffmpeg-static'), ['-v', 'error', '-ss', String(time), '-i', studio.store.assetPath(movie.id), '-frames:v', '1', '-vf', 'scale=24:42', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']); assert.equal(decoded.status, 0); return decoded.stdout; };
    assert.ok(frame(1)[0] > 150); assert.ok(frame(14)[0] < 100, 'actual end-card frame replaces the image only at the end');
    const captions = parseSrt(readFileSync(join(studio.store.root, 'work', task.id, 'affiliate-captions.srt'), 'utf8'));
    assert.equal(captions.at(-1)!.end, 13, 'scene captions stop before the two-second end card');
    assert.equal(readdirSync(studio.store.settings().outputDir).length, 2); assert.equal((studio.store.project(project.id).data.production as any).affiliatePostAssetId, post.id);
  });
});

test('Affiliate scenario changes invalidate the plan while legacy projects retain their behavior', async () => {
  await fixture(async (studio, imageId) => {
    const old = await studio.invoke<Project>('project.save', { name: 'Already planned', kind: 'affiliate', data: { product: { name: 'Shirt' }, productAssetIds: [imageId], affiliate: { contentStyle: 'review' }, planning: { source: 'ai-api' }, planningNeedsUpdate: false, shots: [{ id: 'one', prompt: 'Show the shirt', duration: 3 }] } });
    const edited = await studio.invoke<Project>('project.save', { ...old, data: { ...old.data, affiliate: { contentStyle: 'lookbook', hostMode: 'silent', seconds: 15, outfitAssetIds: [imageId] } } });
    assert.equal(edited.data.planningNeedsUpdate, true);
    const legacy = await studio.invoke<Project>('project.save', { name: 'Legacy', kind: 'affiliate', data: { product: { name: 'Old manual product' }, shots: [{ id: 'one', prompt: 'Old shot', duration: 3 }] } });
    assert.equal(legacy.data.affiliate, undefined); assert.equal((legacy.data.shots as any[])[0].prompt, 'Old shot');
  });
});

test('display-only Affiliate changes render without buying another script or invalidating its claim review', async () => {
  await fixture(async (studio, imageId) => {
    const old = await studio.invoke<Project>('project.save', { name: 'Display changes', kind: 'affiliate', data: { product: { name: 'Shirt' }, productAssetIds: [imageId], affiliate: { hostMode: 'silent', seconds: 15 }, planning: { source: 'ai-api' }, planningNeedsUpdate: false, affiliateReview: { status: 'pass' }, production: { previousOutput: 'keep' }, shots: candidate().shots } });
    const saved = await studio.invoke<Project>('project.save', { ...old, data: { ...old.data, affiliate: { ...(old.data.affiliate as object), showPrice: false, screenText: false, adLabel: false, aiLabel: false, endCard: false } } });
    assert.equal(saved.data.planningNeedsUpdate, false); assert.notEqual((saved.data.affiliateReview as any).stale, true); assert.equal(saved.data.productionStale, true);
  });
});


test('Affiliate reserves a reference slot for an auto-generated host before saving or admitting a job', async () => {
  await fixture(async (studio, imageId) => {
    const file = join(studio.store.root, 'product.png'), refs = [imageId];
    for (let index = 1; index < 15; index++) { const [asset] = await studio.importFiles([file]); refs.push(asset.id); }
    assert.equal(new Set(refs).size, 15);
    const input = { name: 'Reference budget', kind: 'affiliate', data: { product: { name: 'Shirt' }, productAssetIds: refs, affiliate: { hostMode: 'presenter' } } };
    await assert.rejects(studio.invoke('project.save', input), /reference|giới hạn|tham chiếu/i);
    const fourteen = await studio.invoke<Project>('project.save', { ...input, data: { ...input.data, productAssetIds: refs.slice(0, 14) } });
    assert.ok(fourteen.id);
    const selected = await studio.invoke<Project>('project.save', { ...input, data: { ...input.data, affiliate: { hostMode: 'presenter', presenterAssetId: imageId } } });
    assert.ok(selected.id);
    const existing = studio.store.saveProject(input as any), before = studio.store.tasks().length;
    await assert.rejects(studio.invoke('studio.run', { projectId: existing.id, stage: 'all' }), /reference|giới hạn|tham chiếu/i);
    assert.equal(studio.store.tasks().length, before, 'invalid reference budget never reaches the queue');
  });
});
