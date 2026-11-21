import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { StudioService } from '../src/core/studio';
import { MediaTools } from '../src/core/media';
import { parseVideoReview, qualityRetries, reviewScore } from '../src/core/quality';
import { NeedsInputError } from '../src/core/queue';
import type { Project, Task, TaskContext, TaskResult } from '../src/shared/studio';

const imageVerdict = Object.fromEntries(['scene', 'face', 'outfit'].map(key => [key, { status: key === 'scene' ? 'pass' : 'not_applicable', reason: 'Controlled fixture' }]));
const videoVerdict = (status = 'pass') => Object.fromEntries(['action', 'motion', 'continuity', 'identity'].map(key => [key, { status: key === 'motion' ? status : key === 'identity' ? 'not_applicable' : 'pass', reason: key === 'motion' && status !== 'pass' ? 'The requested teapot movement is missing' : 'Controlled sampled observation' }]));
type Port = { generate(task: Task, context: TaskContext): Promise<TaskResult>; executeReview(task: Task, project: Project, context: TaskContext): Promise<TaskResult> };

test('repair feedback carries speech overflow evidence and the exact edit window without passed visual reasons', () => {
  const feedback = require('../src/core/quality').qualityRepairFeedback({
    speech: { status: 'fail', reason: 'Lời nói vượt thời lượng shot', expected: 'Đây là tất chữ C.', heard: 'Đây là tất chữ C.', transcript: { ok: true } },
    image: { status: 'pass', checks: { scene: { status: 'pass', reason: 'Keep this successful scene unchanged' } } }
  }, 3.333);
  assert.match(feedback, /3\.333 seconds/); assert.match(feedback, /Lời nói vượt thời lượng shot/);
  assert.match(feedback, /Đây là tất chữ C\./); assert.doesNotMatch(feedback, /Keep this successful/);
});

test('repair feedback removes unexpected speech and preserves speech corrections beside long visual failures', () => {
  const feedback = require('../src/core/quality').qualityRepairFeedback({
    speech: { status: 'fail', expected: '', heard: 'Invented narration' },
    video: { status: 'fail', checks: { action: { status: 'fail', reason: 'Missing the cuff stretch. ' + 'x'.repeat(4000) }, identity: { status: 'pass', reason: 'Identity is correct' } } }
  }, 2.375);
  assert.match(feedback, /No human speech/); assert.match(feedback, /2\.375 seconds/);
  assert.match(feedback, /Invented narration/); assert.match(feedback, /Missing the cuff stretch/);
  assert.doesNotMatch(feedback, /Identity is correct/); assert.ok(feedback.length <= 2000);
});

test('repair feedback preserves transcript and speaker corrections instead of treating a speech failure as a visual retry', () => {
  const feedback = require('../src/core/quality').qualityRepairFeedback({ speech: { status: 'fail', expected: 'Xin chào.', heard: 'Different words', transcript: { ok: false }, identity: { status: 'consistency_fail' } } }, 2);
  assert.match(feedback, /2\.000 seconds/); assert.match(feedback, /Xin chào\./);
  assert.match(feedback, /omitted, substituted and additional speech/); assert.match(feedback, /voice differs/);
});

test('repair feedback does not impose an Affiliate edit deadline on native Film dialogue', () => {
  const feedback = require('../src/core/quality').qualityRepairFeedback({ speech: { status: 'fail', expected: 'Keep this complete Film line.', transcript: { ok: false } } });
  assert.match(feedback, /Keep this complete Film line/); assert.match(feedback, /omitted, substituted and additional speech/);
  assert.doesNotMatch(feedback, /within .*seconds|Start promptly|No long pauses/);
});

test('repair feedback retains every failed check when an earlier reason exceeds its category budget', () => {
  const feedback = require('../src/core/quality').qualityRepairFeedback({
    image: { status: 'fail', checks: { scene: { status: 'fail', reason: 'The framing is wrong. '.repeat(32) }, face: { status: 'fail', reason: 'Restore the requested face' } } },
    video: { status: 'fail', checks: { action: { status: 'fail', reason: 'The action is missing. '.repeat(32) }, identity: { status: 'fail', reason: 'Restore the product pattern' } } },
    speech: { status: 'fail', reason: 'Overflow. '.repeat(100), expected: 'Xin chào.', transcript: { ok: false }, identity: { status: 'consistency_fail' } }
  }, 3.333);
  for (const detail of ['Restore the requested face', 'Restore the product pattern', '3.333 seconds', 'Xin chào.', 'omitted, substituted and additional speech', 'voice differs']) assert.ok(feedback.includes(detail), detail);
  assert.ok(feedback.length <= 2000);
});

test('temporal verdict rejects missing evidence, unknown motion and malformed model output', () => {
  assert.equal(parseVideoReview(JSON.stringify(videoVerdict())).status, 'pass');
  assert.equal(parseVideoReview(JSON.stringify(videoVerdict('unknown'))).status, 'unknown');
  assert.equal(parseVideoReview(JSON.stringify(videoVerdict('fail'))).status, 'fail');
  assert.throws(() => parseVideoReview('{}'), /status/);
  assert.throws(() => parseVideoReview(JSON.stringify(videoVerdict('not_applicable'))), /assessment/);
  assert.throws(() => parseVideoReview('not JSON'), /JSON/);
  for (const value of [-1, 3, 0.5, '2', NaN]) assert.throws(() => qualityRetries(value), /qualityRetries/);
  assert.equal(qualityRetries(undefined), 0); assert.equal(qualityRetries(2), 2);
  assert.ok(reviewScore({ video: videoVerdict('fail') }) < reviewScore({ video: { status: 'pass' } }));
  assert.ok(reviewScore({ video: { checks: videoVerdict('fail') } }) > reviewScore({ video: { checks: Object.fromEntries(['action', 'motion', 'continuity'].map(key => [key, { status: 'fail' }])) } }));
});

async function fixture(run: (studio: StudioService, frames: string[], requests: Array<{ prompt: string; images: string[] }>, setVerdict: (fn: (index: number) => unknown, imageFn?: (index: number) => unknown) => void) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'mai-temporal-')), studio = new StudioService(root), frames: string[] = [];
  for (const color of ['red', 'blue', 'green']) {
    const file = join(root, `${color}.mp4`);
    const result = spawnSync(require('ffmpeg-static'), ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=64x64:r=24:d=1`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
    assert.equal(result.status, 0, result.stderr.toString()); frames.push(file);
  }
  const requests: Array<{ prompt: string; images: string[] }> = []; let decide: (index: number) => unknown = () => videoVerdict(), decideImage: (index: number) => unknown = () => imageVerdict; let videoCalls = 0, imageCalls = 0;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const content = JSON.parse(body).messages[0].content;
    const prompt = content.find((part: any) => part.type === 'text').text, images = content.filter((part: any) => part.type === 'image_url').map((part: any) => part.image_url.url);
    requests.push({ prompt, images });
    const verdict = await (prompt.startsWith('Assess an actual sampled video') ? decide(videoCalls++) : decideImage(imageCalls++));
    res.setHeader('Content-Type', 'application/json');
    if (verdict === 'disconnect') { res.statusCode = 503; res.end('{}'); return; }
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(verdict) } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as import('node:net').AddressInfo;
    await studio.invoke('settings.save', { providers: { text: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'controlled-vision' } } });
    await run(studio, frames, requests, (fn, imageFn) => { decide = fn; if (imageFn) decideImage = imageFn; });
  } finally { await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
}

async function project(studio: StudioService, videoPaths: string[], data: Record<string, unknown> = {}) {
  const png = join(studio.store.root, 'scene.png');
  writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=', 'base64'));
  const [frame, ...videos] = await studio.importFiles([png, ...videoPaths]);
  const p = await studio.invoke<Project>('project.save', { name: 'Temporal fixture', kind: 'srt', data: { shots: [{ id: 'one', prompt: 'A teapot on a table', videoPrompt: 'Tilt the teapot and pour tea', assetId: frame.id, duration: 0.6 }], narrationMode: 'none', videoReview: true, width: 64, height: 64, fps: 24, ...data } });
  return { p, frame, videos };
}

async function finish(studio: StudioService, task: Task) {
  for (let index = 0; index < 1000; index++) { const current = studio.store.task(task.id); if (!['draft', 'queued', 'running'].includes(current.status)) return current; await delay(10); }
  throw new Error('Controlled pipeline did not settle');
}

test('real frame sampling decodes four ordered JPEGs, validates bounds and honors cancellation', async () => {
  await fixture(async (studio, paths) => {
    const media = new MediaTools(), folder = join(studio.store.root, 'samples'), sequence = join(studio.store.root, 'red-blue.mp4');
    const joined = spawnSync(require('ffmpeg-static'), ['-v', 'error', '-i', paths[0], '-i', paths[1], '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', sequence]);
    assert.equal(joined.status, 0, joined.stderr.toString());
    const samples = await media.sampleFrames(sequence, folder, [0.1, 0.5, 1.1, 1.5]);
    assert.equal(samples.length, 4);
    for (const [index, path] of samples.entries()) {
      assert.equal(readFileSync(path).readUInt16BE(0), 0xffd8); const info = await media.probe(path); assert.ok(info.width! <= 640 && info.height! <= 640);
      const decoded = spawnSync(require('ffmpeg-static'), ['-v', 'error', '-i', path, '-vf', 'scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
      assert.equal(decoded.status, 0); assert.ok(index < 2 ? decoded.stdout[0] > decoded.stdout[2] + 100 : decoded.stdout[2] > decoded.stdout[0] + 100, 'samples follow actual red then blue source frames');
    }
    await assert.rejects(media.sampleFrames(paths[0], folder, [0, 0.1, 0.2, 2]), /sample time/);
    await assert.rejects(media.sampleFrames(paths[0], folder, [0, 0.1, 0.1, 0.5]), /increasing/);
    const before = readdirSync(folder); const abort = new AbortController(); abort.abort();
    await assert.rejects(media.sampleFrames(paths[0], folder, [0, 0.1, 0.2, 0.3], abort.signal), /abort/i); assert.deepEqual(readdirSync(folder), before);
  });
});

test('temporal review uploads the anchor then four actual frames from the edited window, and retry reuses its result', async () => {
  await fixture(async (studio, paths, requests, decide) => {
    decide(() => videoVerdict('fail'));
    const { p, videos } = await project(studio, paths.slice(0, 1));
    const current = studio.store.saveProject({ ...p, data: { ...p.data, shots: [{ ...(p.data.shots as any[])[0], videoAssetId: videos[0].id }] } });
    const task = studio.store.createTasks({ projectId: p.id, prompts: ['Review'], kind: 'pipeline', input: { stage: 'check', projectSnapshot: current } })[0];
    const execute = () => (studio as unknown as Port).executeReview(studio.store.task(task.id), current, { signal: AbortSignal.timeout(20000), progress() {}, checkpoint(value) { studio.store.updateTask(task.id, { checkpoint: { ...studio.store.task(task.id).checkpoint, ...value } }); } });
    await execute(); await execute();
    assert.equal(requests.length, 2, 'one image review and one temporal review, no duplicate requests');
    const videoRequest = requests.find(value => value.prompt.startsWith('Assess an actual'))!; assert.equal(videoRequest.images.length, 5);
    for (const image of videoRequest.images.slice(1)) assert.equal(Buffer.from(image.split(',')[1], 'base64').readUInt16BE(0), 0xffd8);
    const review = (studio.store.project(p.id).data.qualityReviews as any)[`${p.id}/one`];
    assert.equal(review.image.status, 'pass'); assert.equal(review.video.status, 'fail'); assert.equal(review.video.frameIds.length, 4);
    assert.ok(review.video.sampleTimes.every((time: number) => time >= 0 && time < 0.6)); assert.equal(review.video.coverage, 'four_sampled_frames');
  });
});

test('unknown remote temporal acceptance is not resent after a 503', async () => {
  await fixture(async (studio, paths, requests, decide) => {
    decide(() => 'disconnect'); const { p, videos } = await project(studio, paths.slice(0, 1));
    const current = studio.store.saveProject({ ...p, data: { ...p.data, shots: [{ ...(p.data.shots as any[])[0], videoAssetId: videos[0].id }] } });
    const task = studio.store.createTasks({ projectId: p.id, prompts: ['Review'], kind: 'pipeline', input: { stage: 'check', projectSnapshot: current } })[0];
    const execute = () => (studio as unknown as Port).executeReview(studio.store.task(task.id), current, { signal: AbortSignal.timeout(20000), progress() {}, checkpoint(value) { studio.store.updateTask(task.id, { checkpoint: { ...studio.store.task(task.id).checkpoint, ...value } }); } });
    await assert.rejects(execute(), /503/); await assert.rejects(execute(), /đối soát|gửi/); assert.equal(requests.length, 2);
  });
});

test('automatic quality repair passes feedback to one anchored generation, reviews the replacement and renders it', async t => {
  await fixture(async (studio, paths, requests, decide) => {
    decide(index => videoVerdict(index ? 'pass' : 'fail'));
    const { p, frame, videos } = await project(studio, paths.slice(0, 2), { autoChecks: true, qualityRetries: 1 }); let calls = 0;
    t.mock.method(studio as unknown as Port, 'generate', async (task: Task) => {
      assert.deepEqual(task.input.refIds, [frame.id]); if (calls) assert.match(task.prompt, /teapot movement is missing/);
      return { outputIds: [videos[calls++].id] };
    });
    const done = await finish(studio, await studio.invoke<Task>('studio.run', { projectId: p.id }));
    assert.equal(done.status, 'succeeded', done.error); assert.equal(calls, 2);
    const data = studio.store.project(p.id).data as any; assert.equal(data.production.videos[`${p.id}/one`], videos[1].id);
    assert.equal(data.production.qualityTakes[`${p.id}/one`].length, 2); assert.equal(data.qualityReviews[`${p.id}/one`].video.status, 'pass');
    assert.equal(requests.filter(value => value.prompt.startsWith('Assess an actual')).length, 2);
    assert.ok(done.outputIds.length); assert.ok((await new MediaTools().probe(studio.store.assetPath(done.outputIds[0]))).duration >= 0.5);
  });
});

test('exhausted repair keeps the better assessed take and retry does not purchase another generation or review', async t => {
  await fixture(async (studio, paths, requests, decide) => {
    decide(index => index ? Object.fromEntries(['action', 'motion', 'continuity', 'identity'].map(key => [key, { status: 'fail', reason: 'Worse replacement' }])) : videoVerdict('fail'));
    const { p, videos } = await project(studio, paths.slice(0, 2), { autoChecks: true, qualityRetries: 1 }); let calls = 0;
    t.mock.method(studio as unknown as Port, 'generate', async () => ({ outputIds: [videos[calls++].id] }));
    const task = await studio.invoke<Task>('studio.run', { projectId: p.id }), done = await finish(studio, task);
    assert.equal(done.status, 'waiting_input', done.error); assert.equal(calls, 2); assert.equal((studio.store.project(p.id).data.production as any).videos[`${p.id}/one`], videos[0].id);
    const requestCount = requests.length; await studio.invoke('task.action', { action: 'retry', ids: [task.id] });
    assert.equal((await finish(studio, task)).status, 'waiting_input'); assert.equal(calls, 2); assert.equal(requests.length, requestCount);
    assert.equal((studio.store.project(p.id).data.production as any).qualityTakes[`${p.id}/one`].length, 2, 'restoring a previous take must not count it as a new generation');
  });
});

test('resuming quality control uses a fresh explicit review without replaying its old verdict or buying another generation', async t => {
  for (const kind of ['image', 'video']) await fixture(async (studio, paths, requests, decide) => {
    decide(() => videoVerdict(kind === 'video' ? 'unknown' : 'pass'), () => ({ ...imageVerdict, scene: { status: kind === 'image' ? 'unknown' : 'pass', reason: 'Initial evidence is inconclusive' } }));
    const { p, videos } = await project(studio, paths.slice(0, 1), { autoChecks: true, qualityRetries: 1 }); let generations = 0;
    t.mock.method(studio as unknown as Port, 'generate', async () => { generations++; return { outputIds: [videos[0].id] }; });
    const task = await studio.invoke<Task>('studio.run', { projectId: p.id });
    assert.equal((await finish(studio, task)).status, 'waiting_input'); assert.equal(generations, 1);
    decide(() => videoVerdict(), () => imageVerdict);
    const review = await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'check', shotIds: ['one'] });
    assert.equal((await finish(studio, review)).status, 'succeeded');
    assert.equal((studio.store.project(p.id).data.qualityReviews as any)[`${p.id}/one`][kind].status, 'pass');
    const count = requests.length;
    await studio.invoke('task.action', { action: 'resume', ids: [task.id] });
    const done = await finish(studio, task);
    assert.equal(done.status, 'succeeded', done.error); assert.equal(generations, 1);
    assert.equal(requests.length, count, 'resume must reuse the separately completed review, not call vision again');
    assert.equal((studio.store.project(p.id).data.qualityReviews as any)[`${p.id}/one`][kind].status, 'pass');
    assert.ok(done.outputIds.length);
  });
});

test('a new unknown review still pauses on resume without silently passing or buying another review', async t => {
  await fixture(async (studio, paths, requests, decide) => {
    decide(() => videoVerdict('unknown'));
    const { p, videos } = await project(studio, paths.slice(0, 1), { autoChecks: true, qualityRetries: 1 });
    t.mock.method(studio as unknown as Port, 'generate', async () => ({ outputIds: [videos[0].id] }));
    const task = await studio.invoke<Task>('studio.run', { projectId: p.id });
    assert.equal((await finish(studio, task)).status, 'waiting_input');
    assert.equal((await finish(studio, await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'check' }))).status, 'succeeded');
    const count = requests.length;
    await studio.invoke('task.action', { action: 'resume', ids: [task.id] });
    assert.equal((await finish(studio, task)).status, 'waiting_input'); assert.equal(requests.length, count);
    assert.equal((studio.store.project(p.id).data.qualityReviews as any)[`${p.id}/one`].video.status, 'unknown');
  });
});

test('a fresh failing review updates the existing take instead of restoring its older unknown assessment', async t => {
  await fixture(async (studio, paths, requests, decide) => {
    decide(() => videoVerdict('unknown'));
    const { p, videos } = await project(studio, paths.slice(0, 1), { autoChecks: true, qualityRetries: 0 });
    t.mock.method(studio as unknown as Port, 'generate', async () => ({ outputIds: [videos[0].id] }));
    const task = await studio.invoke<Task>('studio.run', { projectId: p.id }); assert.equal((await finish(studio, task)).status, 'waiting_input');
    decide(() => videoVerdict('fail'));
    assert.equal((await finish(studio, await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'check' }))).status, 'succeeded');
    const count = requests.length; await studio.invoke('task.action', { action: 'resume', ids: [task.id] });
    assert.equal((await finish(studio, task)).status, 'waiting_input'); assert.equal(requests.length, count);
    const data = studio.store.project(p.id).data as any, key = `${p.id}/one`;
    assert.equal(data.qualityReviews[key].video.status, 'fail'); assert.equal(data.production.qualityTakes[key].length, 1);
    assert.equal(data.production.qualityTakes[key][0].review.video.status, 'fail');
  });
});

test('best-take restoration cannot hide a new failure of an image shared by two video takes', async t => {
  await fixture(async (studio, paths, requests, decide) => {
    let reassess = false;
    decide(index => index === 1 ? { ...videoVerdict('fail'), action: { status: 'unknown', reason: 'Less conclusive second take' } } : videoVerdict('fail'), () => ({ ...imageVerdict, scene: { status: reassess ? 'fail' : 'pass', reason: reassess ? 'The shared frame fails its planned action' : 'Initial frame assessment' } }));
    const { p, videos } = await project(studio, paths.slice(0, 2), { autoChecks: true, qualityRetries: 1 }); let generations = 0;
    t.mock.method(studio as unknown as Port, 'generate', async () => ({ outputIds: [videos[generations++].id] }));
    const task = await studio.invoke<Task>('studio.run', { projectId: p.id }); assert.equal((await finish(studio, task)).status, 'waiting_input');
    reassess = true;
    assert.equal((await finish(studio, await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'check' }))).status, 'succeeded');
    const count = requests.length, key = `${p.id}/one`;
    for (const action of ['resume', 'retry']) {
      await studio.invoke('task.action', { action, ids: [task.id] }); assert.equal((await finish(studio, task)).status, 'waiting_input');
      const data = studio.store.project(p.id).data as any;
      assert.equal(data.qualityReviews[key].image.status, 'fail');
      assert.equal(data.production.qualityTakes[key].length, 2);
      assert.ok(data.production.qualityTakes[key].every((take: any) => take.review.image.status === 'fail'));
      assert.equal(generations, 2); assert.equal(requests.length, count);
    }
  });
});

test('a legacy take cannot restore a verdict from an older review policy after reassessment', async t => {
  await fixture(async (studio, paths, requests, decide) => {
    decide(() => videoVerdict('unknown'));
    const { p, videos } = await project(studio, paths.slice(0, 2), { autoChecks: true, qualityRetries: 0 });
    t.mock.method(studio as unknown as Port, 'generate', async () => ({ outputIds: [videos[0].id] }));
    const task = await studio.invoke<Task>('studio.run', { projectId: p.id }); assert.equal((await finish(studio, task)).status, 'waiting_input');
    const current = studio.store.project(p.id), data = current.data as any, key = `${p.id}/one`;
    const take = data.production.qualityTakes[key][0];
    delete take.review.policyFingerprint; take.review.image.fingerprint = 'previous-review-policy';
    data.production.qualityTakes[key].push({ ...structuredClone(take), videoId: videos[1].id, review: { image: { ...take.review.image, status: 'pass' }, video: { ...take.review.video, assetId: videos[1].id, status: 'fail', checks: videoVerdict('fail') } }, score: -97 });
    studio.store.saveProject({ ...current, data });
    decide(() => videoVerdict('fail'), () => Object.fromEntries(['scene', 'face', 'outfit'].map(kind => [kind, { status: 'fail', reason: 'Fresh evidence under the current review policy' }])));
    assert.equal((await finish(studio, await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'check' }))).status, 'succeeded');
    const count = requests.length;
    for (const action of ['resume', 'retry']) {
      await studio.invoke('task.action', { action, ids: [task.id] }); assert.equal((await finish(studio, task)).status, 'waiting_input');
      const latest = studio.store.project(p.id).data as any;
      assert.equal(latest.qualityReviews[key].image.status, 'fail');
      assert.equal(latest.production.videos[key], videos[0].id);
      assert.equal(latest.production.qualityTakes[key].length, 2); assert.equal(requests.length, count);
    }
  });
});

test('resuming a legacy best take preserves its latest review checkpoint across repeated resumes', async t => {
  await fixture(async (studio, paths, requests, decide) => {
    decide(index => index ? Object.fromEntries(['action', 'motion', 'continuity', 'identity'].map(kind => [kind, { status: 'fail', reason: 'Worse second take' }])) : videoVerdict('fail'));
    const { p, videos } = await project(studio, paths.slice(0, 2), { autoChecks: true, qualityRetries: 1 }); let generations = 0;
    t.mock.method(studio as unknown as Port, 'generate', async () => ({ outputIds: [videos[generations++].id] }));
    const task = await studio.invoke<Task>('studio.run', { projectId: p.id }); assert.equal((await finish(studio, task)).status, 'waiting_input');
    const key = `${p.id}/one`, current = studio.store.project(p.id), data = current.data as any;
    for (const take of data.production.qualityTakes[key]) { take.review.policyFingerprint = 'legacy-policy'; take.review.image.fingerprint = 'legacy-image-policy'; }
    data.qualityReviews[key].image.fingerprint = 'legacy-image-policy'; studio.store.saveProject({ ...current, data });
    const saved = studio.store.task(task.id);
    for (const round of Object.values((saved.checkpoint.qualityControl as any).rounds) as any[]) round.reviews[key].image.fingerprint = 'legacy-image-policy';
    studio.store.updateTask(task.id, { checkpoint: saved.checkpoint });
    decide(() => videoVerdict('fail'), () => ({ ...imageVerdict, scene: { status: 'fail', reason: 'Current-policy reassessment fails the shared image' } }));
    await studio.invoke('task.action', { action: 'resume', ids: [task.id] }); assert.equal((await finish(studio, task)).status, 'waiting_input');
    const count = requests.length;
    await studio.invoke('task.action', { action: 'resume', ids: [task.id] }); assert.equal((await finish(studio, task)).status, 'waiting_input');
    assert.equal(requests.length, count, 'restoring the older generation must retain the newer assessment checkpoint');
    assert.equal(generations, 2); assert.equal((studio.store.project(p.id).data.qualityReviews as any)[key].image.status, 'fail');
  });
});

test('resume never adopts an assessment attached to another asset even when its fingerprint is copied', async t => {
  await fixture(async (studio, paths, requests, decide) => {
    decide(() => videoVerdict('unknown'));
    const { p, videos } = await project(studio, paths.slice(0, 2), { autoChecks: true, qualityRetries: 0 });
    t.mock.method(studio as unknown as Port, 'generate', async () => ({ outputIds: [videos[0].id] }));
    const task = await studio.invoke<Task>('studio.run', { projectId: p.id }); assert.equal((await finish(studio, task)).status, 'waiting_input');
    const current = studio.store.project(p.id), key = `${p.id}/one`, reviews = current.data.qualityReviews as any;
    studio.store.saveProject({ ...current, data: { ...current.data, qualityReviews: { ...reviews, [key]: { ...reviews[key], video: { ...reviews[key].video, assetId: videos[1].id, status: 'pass', checks: videoVerdict() } } } } });
    const count = requests.length; await studio.invoke('task.action', { action: 'resume', ids: [task.id] });
    assert.equal((await finish(studio, task)).status, 'waiting_input'); assert.equal(requests.length, count);
    assert.equal((studio.store.project(p.id).data.qualityReviews as any)[key].video.status, 'unknown');
  });
});

test('unknown evidence pauses before automatic repairs and explicit source videos are never replaced', async t => {
  for (const status of ['unknown', 'fail']) await fixture(async (studio, paths, _requests, decide) => {
    decide(() => videoVerdict(status)); const { p, videos } = await project(studio, paths.slice(0, 1), { autoChecks: true, qualityRetries: 2 });
    const current = studio.store.saveProject({ ...p, data: { ...p.data, shots: [{ ...(p.data.shots as any[])[0], videoAssetId: videos[0].id }] } });
    t.mock.method(studio as unknown as Port, 'generate', async () => { throw new Error('Explicit sources cannot be regenerated'); });
    const done = await finish(studio, await studio.invoke<Task>('studio.run', { projectId: current.id })); assert.equal(done.status, 'waiting_input', done.error);
    assert.equal(((studio.store.project(p.id).data.shots as any[])[0]).videoAssetId, videos[0].id);
  });
});

test('image repair regenerates only the failed scene then its dependent video, preserving character references', async t => {
  await fixture(async (studio, paths, _requests, decide) => {
    decide(() => videoVerdict(), index => ({ ...imageVerdict, scene: { status: index ? 'pass' : 'fail', reason: index ? 'Action visible' : 'The teapot action is not visible in the scene frame' } }));
    const { p, frame, videos } = await project(studio, paths.slice(0, 2), { autoChecks: true, qualityRetries: 1 });
    const nextFrame = (await studio.importFiles([studio.store.assetPath(frame.id)]))[0];
    const current = studio.store.saveProject({ ...p, data: { ...p.data, characters: [{ id: 'host', name: 'Host', description: 'Blue robe', assetId: frame.id }], shots: [{ ...(p.data.shots as any[])[0], assetId: undefined, characterIds: ['host'] }] } });
    const kinds: string[] = []; let imageCalls = 0, videoCalls = 0;
    t.mock.method(studio as unknown as Port, 'generate', async (task: Task) => {
      kinds.push(task.kind);
      if (kinds.length > 2) assert.match(task.prompt, /teapot action is not visible/);
      if (task.kind === 'image') { assert.deepEqual(task.input.refIds, [frame.id]); return { outputIds: [(imageCalls++ ? nextFrame : frame).id] }; }
      assert.deepEqual(task.input.refIds, [videoCalls ? nextFrame.id : frame.id]); return { outputIds: [videos[videoCalls++].id] };
    });
    const done = await finish(studio, await studio.invoke<Task>('studio.run', { projectId: current.id }));
    assert.equal(done.status, 'succeeded', done.error); assert.deepEqual(kinds, ['image', 'video', 'image', 'video']);
    assert.equal((studio.store.project(p.id).data.production as any).images[`${p.id}/one`], nextFrame.id);
    assert.equal(((studio.store.project(p.id).data.characters as any[])[0]).assetId, frame.id);
  });
});

test('two-repair budget never exceeds three video generations, including task retry', async t => {
  await fixture(async (studio, paths, _requests, decide) => {
    decide(() => videoVerdict('fail')); const { p, videos } = await project(studio, paths, { autoChecks: true, qualityRetries: 2 }); let calls = 0;
    t.mock.method(studio as unknown as Port, 'generate', async () => ({ outputIds: [videos[calls++].id] }));
    const task = await studio.invoke<Task>('studio.run', { projectId: p.id }); assert.equal((await finish(studio, task)).status, 'waiting_input'); assert.equal(calls, 3);
    await studio.invoke('task.action', { action: 'retry', ids: [task.id] }); assert.equal((await finish(studio, task)).status, 'waiting_input'); assert.equal(calls, 3);
  });
});

test('video response cannot stamp old-plan motion results after an edit during the HTTP request', async () => {
  await fixture(async (studio, paths, _requests, decide) => {
    const { p, videos } = await project(studio, paths.slice(0, 1));
    const current = studio.store.saveProject({ ...p, data: { ...p.data, shots: [{ ...(p.data.shots as any[])[0], videoAssetId: videos[0].id }] } });
    decide(() => { studio.store.saveProject({ ...studio.store.project(p.id), data: { ...current.data, shots: [{ ...(current.data.shots as any[])[0], videoPrompt: 'New action' }] } }); return videoVerdict(); });
    const task = studio.store.createTasks({ projectId: p.id, prompts: ['Review'], kind: 'pipeline', input: { stage: 'check', projectSnapshot: current } })[0];
    await assert.rejects((studio as unknown as Port).executeReview(task, current, { signal: AbortSignal.timeout(20000), progress() {}, checkpoint() {} }), /thay đổi|changed|input/i);
    assert.equal((studio.store.project(p.id).data.qualityReviews as any)?.[`${p.id}/one`]?.video, undefined);
  });
});

test('pending video-stage review cannot be bypassed with a new image-stage task', async t => {
  await fixture(async (studio, paths, _requests, decide) => {
    decide(() => 'disconnect'); const { p, videos } = await project(studio, paths.slice(0, 1), { autoChecks: true, qualityRetries: 1 });
    t.mock.method(studio as unknown as Port, 'generate', async () => ({ outputIds: [videos[0].id] }));
    const task = await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'videos' });
    assert.equal((await finish(studio, task)).status, 'failed');
    await assert.rejects(studio.invoke('studio.run', { projectId: p.id, stage: 'images' }), /đối soát|provider/);
  });
});

test('silent rendering honors keepAudio=false without changing or removing the source audio', async () => {
  await fixture(async (studio, paths, requests) => {
    const sound = join(studio.store.root, 'sound.mp4');
    const result = spawnSync(require('ffmpeg-static'), ['-v', 'error', '-i', paths[0], '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'copy', '-c:a', 'aac', '-shortest', sound]);
    assert.equal(result.status, 0, result.stderr.toString());
    const { p, videos } = await project(studio, [sound], { keepAudio: false, nativeAudio: false });
    const current = studio.store.saveProject({ ...p, data: { ...p.data, shots: [{ ...(p.data.shots as any[])[0], videoAssetId: videos[0].id }] } });
    const done = await finish(studio, await studio.invoke<Task>('studio.run', { projectId: current.id, stage: 'render' }));
    assert.equal(done.status, 'succeeded', done.error); assert.equal(requests.length, 0);
    assert.equal((await new MediaTools().probe(studio.store.assetPath(done.outputIds[0]))).hasAudio, false);
    assert.equal((await new MediaTools().probe(studio.store.assetPath(videos[0].id))).hasAudio, true);
  });
});

test('an accepted interrupted repair resumes its saved generation without spending another repair budget', async t => {
  await fixture(async (studio, paths, _requests, decide) => {
    decide(index => videoVerdict(index ? 'pass' : 'fail')); const { p, videos } = await project(studio, paths.slice(0, 2), { autoChecks: true, qualityRetries: 1 });
    let submissions = 0, resumes = 0;
    t.mock.method(studio as unknown as Port, 'generate', async (task: Task, context: TaskContext) => {
      if (task.checkpoint.remoteSubmitted === true) { resumes++; return { outputIds: [videos[1].id] }; }
      submissions++; if (submissions === 1) return { outputIds: [videos[0].id] };
      context.checkpoint({ remoteSubmitted: true, threadUrl: 'https://muse.ai/thread/owned-test' }); throw new NeedsInputError('Accepted repair still processing');
    });
    const task = await studio.invoke<Task>('studio.run', { projectId: p.id }); assert.equal((await finish(studio, task)).status, 'waiting_input'); assert.equal(submissions, 2);
    await studio.invoke('task.action', { action: 'retry', ids: [task.id] }); const done = await finish(studio, task);
    assert.equal(done.status, 'succeeded', done.error); assert.equal(submissions, 2); assert.equal(resumes, 1);
    assert.equal((studio.store.project(p.id).data.production as any).videos[`${p.id}/one`], videos[1].id);
  });
});

test('repairing one of two scenes reuses all unchanged reviews and leaves the passing scene intact', async t => {
  await fixture(async (studio, paths, requests, decide) => {
    decide(index => videoVerdict(index === 1 ? 'fail' : 'pass'));
    const { p, frame, videos } = await project(studio, paths, { autoChecks: true, qualityRetries: 1 });
    const current = studio.store.saveProject({ ...p, data: { ...p.data, shots: ['one', 'two'].map(id => ({ ...(p.data.shots as any[])[0], id })) } });
    const generated: string[] = []; let calls = 0;
    t.mock.method(studio as unknown as Port, 'generate', async (task: Task) => { generated.push(task.prompt); assert.deepEqual(task.input.refIds, [frame.id]); return { outputIds: [videos[calls++].id] }; });
    const done = await finish(studio, await studio.invoke<Task>('studio.run', { projectId: current.id })); assert.equal(done.status, 'succeeded', done.error);
    assert.equal(calls, 3); assert.equal(requests.filter(request => request.prompt.startsWith('Assess an actual')).length, 3); assert.equal(requests.length, 5);
    const production = studio.store.project(p.id).data.production as any;
    assert.equal(production.videos[`${p.id}/one`], videos[0].id); assert.equal(production.videos[`${p.id}/two`], videos[2].id);
    assert.equal(production.qualityTakes[`${p.id}/one`].length, 1); assert.equal(production.qualityTakes[`${p.id}/two`].length, 2);
    assert.ok(generated[2].includes('teapot movement is missing'));
  });
});

test('v2 repair feedback states no planned duration', async t => {
  await fixture(async (studio, _paths, _requests, decide) => {
    decide(() => videoVerdict(), () => ({ ...imageVerdict, product: { status: 'pass', reason: 'Controlled fixture' } }));
    const png = join(studio.store.root, 'shirt.png'); writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=', 'base64'));
    const cut = join(studio.store.root, 'cut-line.mp4');
    assert.equal(spawnSync(require('ffmpeg-static'), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=3.5', '-f', 'lavfi', '-i', 'sine=frequency=180:sample_rate=16000:duration=2.5', '-filter_complex', '[1:a]adelay=1000:all=1,apad=whole_dur=3.5[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '3.5', cut]).status, 0);
    const [frame, video] = await studio.importFiles([png, cut]);
    const prompts: string[] = [];
    t.mock.method(studio as unknown as Port, 'generate', async (task: Task) => { prompts.push(task.prompt); return { outputIds: [video.id] }; });
    const run = async (extra: Record<string, unknown>) => {
      prompts.length = 0;
      const p = await studio.invoke<Project>('project.save', { name: 'Repair', kind: 'affiliate', data: { affiliate: { contentStyle: 'review', hostMode: 'voiceover', seconds: 15, screenText: false }, affiliateReview: { status: 'pass' },
        product: { name: 'Shirt' }, nativeAudio: true, keepAudio: true, autoChecks: true, qualityRetries: 1, width: 64, height: 64,
        shots: [{ id: 'one', prompt: 'Shirt on the cabinet', assetId: frame.id, duration: 3, dialogue: 'Áo cotton mềm mại.', beat: 'hook', shotType: 'insert' }], ...extra } });
      await finish(studio, await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'videos' }));
      return [...prompts];
    };
    const v2 = await run({ affiliatePlanVersion: 2, productLook: 'A white cotton shirt.' });
    assert.equal(v2.length, 2, JSON.stringify(v2.map(prompt => prompt.slice(-200))));
    assert.match(v2[1], /Correct the following observed problems/); assert.match(v2[1], /bị cắt ở cuối clip/); assert.doesNotMatch(v2[1], /within \d/);
    const legacy = await run({});
    assert.equal(legacy.length, 2); assert.match(legacy[1], /within 3\.000 seconds/, 'legacy repair keeps the planned edit window');
  });
});

test('video review prompt marks a planned product absence only when asked', () => {
  const { videoReviewPrompt } = require('../src/core/quality') as typeof import('../src/core/quality');
  const args: [string, string, number[], boolean] = ['Minh talks with empty hands', 'Minh gestures', [0.1, 0.9, 1.7, 2.5], true];
  assert.equal(videoReviewPrompt(...args, true, false), videoReviewPrompt(...args, true));
  assert.equal(videoReviewPrompt(...args, false, true), videoReviewPrompt(...args), 'non-affiliate prompts ignore the flag');
  assert.ok(videoReviewPrompt(...args, true).includes('Product identity cannot be not_applicable.'));
  const absent = videoReviewPrompt(...args, true, true);
  assert.match(absent, /intentionally absent from this shot by plan and must not appear/); assert.ok(!absent.includes('Product identity cannot be not_applicable'));
});

const affiliateImage = () => ({ ...imageVerdict, product: { status: 'pass', reason: 'Controlled fixture' } });
const affiliateMotion = (status = 'pass') => ({ ...videoVerdict(status), identity: { status: 'pass', reason: 'The supplied product is preserved' } });
async function affiliateProject(studio: StudioService, paths: string[], count: number, data: Record<string, unknown> = {}) {
  const { p, frame, videos } = await project(studio, paths);
  const saved = await studio.invoke<Project>('project.save', { name: 'Affiliate run all', kind: 'affiliate', data: { affiliate: { contentStyle: 'review', hostMode: 'silent', seconds: 15, screenText: false }, affiliateReview: { status: 'pass' },
    product: { name: 'Shirt' }, nativeAudio: false, narrationMode: 'none', videoReview: true, autoChecks: true, width: 64, height: 64, fps: 24,
    shots: ['one', 'two', 'three'].slice(0, count).map(id => ({ ...(p.data.shots as any[])[0], id })), ...data } });
  return { p: saved, frame, videos };
}

test('affiliate run-all whose reviews keep failing renders the best take within the repair budget', async t => {
  await fixture(async (studio, paths, _requests, decide) => {
    decide(() => affiliateMotion('fail'), affiliateImage);
    const { p, videos } = await affiliateProject(studio, paths.slice(0, 2), 1, { qualityRetries: 1 }); let calls = 0;
    t.mock.method(studio as unknown as Port, 'generate', async () => ({ outputIds: [videos[calls++ % videos.length].id] }));
    const done = await finish(studio, await studio.invoke<Task>('studio.run', { projectId: p.id }));
    assert.equal(done.status, 'succeeded', done.error); assert.equal(calls, 2, 'one generation plus exactly qualityRetries repairs');
    assert.equal(done.outputIds.length, 2); assert.ok(studio.store.assets().some(asset => asset.id === done.outputIds[0] && asset.mime.startsWith('video/')));
    const data = studio.store.project(p.id).data as any;
    assert.equal(data.qualityReviews[`${p.id}/one`].video.status, 'fail', 'a failing take is never recorded as a pass');
    assert.deepEqual(data.production.attention, [{ shot: 'cảnh 1', reasons: ['The requested teapot movement is missing'] }]);
  });
});

test('affiliate run-all lists shots to review in the success message', async t => {
  await fixture(async (studio, paths, _requests, decide) => {
    decide(index => affiliateMotion(['pass', 'fail', 'unknown'][index] ?? 'pass'), affiliateImage);
    const { p, videos } = await affiliateProject(studio, paths.slice(0, 1), 3, { qualityRetries: 0 });
    t.mock.method(studio as unknown as Port, 'generate', async () => ({ outputIds: [videos[0].id] }));
    const done = await finish(studio, await studio.invoke<Task>('studio.run', { projectId: p.id }));
    assert.equal(done.status, 'succeeded', done.error);
    assert.equal(done.message, 'Đã xuất video Affiliate. 2 cảnh cần xem lại: cảnh 2 (The requested teapot movement is missing), cảnh 3 (chưa kiểm được).');
  });
});

test('affiliate run-all with unknown reviews renders without extra generation and never marks a pass', async t => {
  await fixture(async (studio, paths, _requests, decide) => {
    decide(() => affiliateMotion('unknown'), affiliateImage);
    const { p, videos } = await affiliateProject(studio, paths.slice(0, 1), 1, { qualityRetries: 2 }); let calls = 0;
    t.mock.method(studio as unknown as Port, 'generate', async () => { calls++; return { outputIds: [videos[0].id] }; });
    const done = await finish(studio, await studio.invoke<Task>('studio.run', { projectId: p.id }));
    assert.equal(done.status, 'succeeded', done.error); assert.equal(calls, 1, 'unknown evidence never buys a repair');
    const data = studio.store.project(p.id).data as any;
    assert.equal(data.qualityReviews[`${p.id}/one`].video.status, 'unknown');
    assert.deepEqual(data.production.attention, [{ shot: 'cảnh 1', reasons: ['chưa kiểm được'] }]);
    assert.equal(done.message, 'Đã xuất video Affiliate. 1 cảnh cần xem lại: cảnh 1 (chưa kiểm được).');
  });
});

test('affiliate videos stage with checks finishes with the shots to review', async t => {
  await fixture(async (studio, paths, _requests, decide) => {
    decide(() => affiliateMotion('fail'), affiliateImage);
    const { p, videos } = await affiliateProject(studio, paths.slice(0, 1), 1, { qualityRetries: 0 });
    t.mock.method(studio as unknown as Port, 'generate', async () => ({ outputIds: [videos[0].id] }));
    const done = await finish(studio, await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'videos' }));
    assert.equal(done.status, 'succeeded', done.error);
    assert.equal(done.message, 'Đã tạo và review clip. 1 cảnh cần xem lại: cảnh 1 (The requested teapot movement is missing).');
    assert.equal((studio.store.project(p.id).data.qualityReviews as any)[`${p.id}/one`].video.status, 'fail');
  });
});

test('a second affiliate run-all replaces the attention list of the first', async t => {
  await fixture(async (studio, paths, _requests, decide) => {
    decide(() => affiliateMotion('fail'), affiliateImage);
    const { p, videos } = await affiliateProject(studio, paths.slice(0, 1), 1, { qualityRetries: 0 });
    t.mock.method(studio as unknown as Port, 'generate', async () => ({ outputIds: [videos[0].id] }));
    assert.equal((await finish(studio, await studio.invoke<Task>('studio.run', { projectId: p.id }))).status, 'succeeded');
    assert.equal((studio.store.project(p.id).data.production as any).attention.length, 1);
    decide(() => affiliateMotion(), affiliateImage);
    assert.equal((await finish(studio, await studio.invoke<Task>('studio.run', { projectId: p.id, stage: 'check' }))).status, 'succeeded');
    const done = await finish(studio, await studio.invoke<Task>('studio.run', { projectId: p.id }));
    assert.equal(done.status, 'succeeded', done.error); assert.equal(done.message, 'Đã xuất video Affiliate và nội dung đăng bài');
    assert.deepEqual((studio.store.project(p.id).data.production as any).attention, []);
  });
});

test('non-affiliate run-all and videos stage still stop on failing and unknown reviews with the same messages', async t => {
  for (const kind of ['srt', 'film']) for (const stage of ['all', 'videos']) for (const status of ['fail', 'unknown']) await fixture(async (studio, paths, _requests, decide) => {
    decide(() => videoVerdict(status));
    const { p, videos } = await project(studio, paths.slice(0, 1), { autoChecks: true, qualityRetries: 0 });
    const current = studio.store.saveProject({ ...p, kind: kind as Project['kind'] });
    t.mock.method(studio as unknown as Port, 'generate', async () => ({ outputIds: [videos[0].id] }));
    const done = await finish(studio, await studio.invoke<Task>('studio.run', { projectId: current.id, stage }));
    assert.equal(done.status, 'waiting_input', `${kind} ${stage} ${status}: ${done.error}`);
    assert.equal(done.error, status === 'fail' ? 'Kiểm tra chất lượng còn fail; đã giữ bản có đánh giá tốt nhất trong giới hạn tạo lại. Xem review trước khi dựng thủ công' : 'Review còn unknown hoặc thiếu bằng chứng; cần anh xem trước khi tạo lại hoặc dựng');
    assert.equal((studio.store.project(p.id).data.production as any).attention, undefined);
  });
});

test('affiliate run-all repairs a silent spoken clip within the budget, then renders it and lists the shot', async t => {
  await fixture(async (studio, paths, _requests, decide) => {
    decide(() => affiliateMotion(), affiliateImage);
    const { p, videos } = await affiliateProject(studio, paths.slice(0, 2), 1, { qualityRetries: 1, nativeAudio: true, keepAudio: true, affiliate: { contentStyle: 'review', hostMode: 'voiceover', seconds: 15, screenText: false } });
    const spoken = studio.store.saveProject({ ...p, data: { ...p.data, shots: (p.data.shots as any[]).map(shot => ({ ...shot, dialogue: 'Áo cotton mềm mại.' })) } }); let calls = 0;
    t.mock.method(studio as unknown as Port, 'generate', async () => ({ outputIds: [videos[calls++ % videos.length].id] }));
    const done = await finish(studio, await studio.invoke<Task>('studio.run', { projectId: spoken.id }));
    assert.equal(done.status, 'succeeded', done.error); assert.equal(calls, 2, 'the silent clip is repaired once, never beyond qualityRetries');
    assert.equal(done.message, 'Đã xuất video Affiliate. 1 cảnh cần xem lại: cảnh 1 (không nghe rõ lời thoại).');
    assert.equal((studio.store.project(p.id).data.qualityReviews as any)[`${p.id}/one`].speech.status, 'fail');
    const manual = await finish(studio, await studio.invoke<Task>('studio.run', { projectId: spoken.id, stage: 'render' }));
    assert.equal(manual.status, 'waiting_input'); assert.equal(manual.error, 'Clip cảnh 1 không có tiếng; bấm "Tạo lại clip riêng cảnh này" ở cảnh 1 rồi dựng lại');
  });
});
