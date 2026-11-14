import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { renameSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { StudioService } from '../src/core/studio';
import { MediaTools, parseSrt } from '../src/core/media';
import { pipelineSteps, validateCharacters } from '../src/core/pipelines';
import type { Project, Task } from '../src/shared/studio';

const exec = promisify(execFile);
const ffmpegPath: string = process.env.TEST_FFMPEG_PATH || require('ffmpeg-static');
const ffprobePath = process.env.TEST_FFPROBE_PATH || 'ffprobe';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function inputHash(data: Record<string, unknown>): string {
  const content = { ...data }; for (const key of ['production', 'qualityReviews', 'planning', 'outputIds', 'productionStale']) delete content[key]; return hash(content);
}
const record = (value: unknown) => value as Record<string, unknown>;
async function finish(studio: StudioService, task: Task): Promise<Task> {
  for (let i = 0; i < 2000 && ['draft', 'queued', 'running'].includes(studio.store.task(task.id).status); i++) await delay(10);
  const done = studio.store.task(task.id); assert.ok(!['draft', 'queued', 'running'].includes(done.status), `task did not finish: ${done.message}`); return done;
}
async function fixture(run: (f: { studio: StudioService; project: Project; prior: Project; root: string; previousClip: string; tools: MediaTools }) => Promise<void>, settings: { recap?: boolean; qa?: boolean; capped?: boolean; mainSubtitle?: boolean; native?: boolean; generated?: boolean; music?: boolean; portrait?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mai-series-service-')); const studio = new StudioService(root);
  const tools = new MediaTools({ ffmpegPath, ffprobePath });
  try {
    studio.store.setSettings({ ffmpegPath, ffprobePath });
    const paths = [join(root, 'prior.mp4'), join(root, 'current.mp4')];
    for (const [index, path] of paths.entries()) await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${index ? 'blue' : 'red'}:s=64x64:r=20:d=${index ? 2 : 6}`, '-f', 'lavfi', '-i', `sine=frequency=${index ? 660 : 990}:sample_rate=48000:duration=${index ? 2 : 6}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path]);
    const assets = await studio.importFiles(paths); let musicId: string | undefined;
    if (settings.music) {
      const path = join(root, 'music.wav'); await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=110:sample_rate=48000:duration=1', path]);
      musicId = (await studio.importFiles([path]))[0].id;
    }
    const episodes = [
      { id: 'one', name: 'Episode one', script: 'Prior', shots: [{ id: 'old', prompt: 'Red scene', start: 0, duration: 6, videoAssetId: assets[0].id, dialogue: 'Prior sentence' }] },
      { id: 'two', name: 'Episode two', script: 'Current', shots: [{ id: 'new', prompt: 'Blue scene', start: 0, duration: 2, videoAssetId: assets[1].id, dialogue: 'Current sentence' }],
        ...(settings.mainSubtitle === false ? {} : { subtitle: '1\n00:00:00,200 --> 00:00:01,200\nCurrent sentence\n' }) },
    ];
    let project = await studio.invoke<Project>('project.save', { name: 'Recap series', kind: 'series', data: { recap: settings.recap !== false, width: 64, height: 64, fps: 20, nativeAudio: settings.native === true, narrationMode: 'none', episodes, ...(musicId ? { musicId, musicVolume: 0.2 } : {}), ...(settings.portrait ? { styleText: 'Watercolor', characters: [{ id: 'hero', name: 'Hero', description: 'Blue outfit' }] } : {}) } });
    const shared = { ...project.data }; delete shared.episodes;
    let prior = studio.store.saveProject({ name: 'Existing previous film', kind: 'film', data: { ...shared, ...episodes[0], seriesParentId: project.id, episodeId: 'one' } });
    if (settings.generated) {
      const png = join(root, 'frame.png'); await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', png]);
      const frame = (await studio.importFiles([png]))[0]; const shot = { ...episodes[0].shots[0], videoAssetId: undefined, assetId: frame.id };
      prior = studio.store.saveProject({ ...prior, data: { ...prior.data, shots: [shot] } });
      const step = pipelineSteps(prior, { speech: false }).find(step => step.kind === 'video')!; const base = step.id.replace(/\/video$/, '');
      prior = studio.store.saveProject({ ...prior, data: { ...prior.data, production: { videos: { [base]: assets[0].id }, fingerprints: { [step.id]: hash({ ...step, refIds: [...new Set(step.refIds)], ratio: prior.data.ratio ?? '16:9' }) } } } });
      const outline = { ...record(project.data.episodes instanceof Array ? project.data.episodes[0] : {}) }; delete outline.shots;
      project = studio.store.saveProject({ ...project, data: { ...project.data, episodes: [outline, episodes[1]] } });
    }
    let portraitId = '';
    if (settings.portrait) {
      const png = join(root, 'portrait.png'); await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64', '-frames:v', '1', png]);
      portraitId = (await studio.importFiles([png]))[0].id; const character = validateCharacters(prior.data.characters)[0];
      prior = studio.store.saveProject({ ...prior, data: { ...prior.data, production: { ...record(prior.data.production ?? {}), characterImages: { hero: portraitId }, fingerprints: { ...record(record(prior.data.production ?? {}).fingerprints ?? {}), 'character/hero': hash({ character, style: prior.data.style ?? '', styleText: prior.data.styleText ?? '' }) } } } });
    }
    const characters = validateCharacters(prior.data.characters).map(character => portraitId ? { ...character, assetId: portraitId } : character);
    const step = pipelineSteps({ ...prior, data: { ...prior.data, characters } }, { speech: false }).find(step => step.kind === 'video')!; const base = step.id.replace(/\/video$/, '');
    if (settings.qa !== false) prior = studio.store.saveProject({ ...prior, data: { ...prior.data, qualityReviews: { [base]: { speech: {
      assetId: assets[0].id, status: 'pass', fingerprint: hash({ video: assets[0].id, dialogue: step.dialogue, speaker: step.speaker, characters, language: prior.data.language, provider: studio.store.settings().providers.asr }),
      acoustic: { duration: 6, parts: [{ start: settings.capped ? 0.2 : 0.4, end: settings.capped ? 5.8 : 1 }] },
    } } } } });
    await run({ studio, project, prior, root, previousClip: studio.store.assetPath(assets[0].id), tools });
  } finally { await studio.close(); await rm(root, { recursive: true, force: true }); }
}
const films = (studio: StudioService, project: Project) => studio.store.projects().filter(film => film.data.seriesParentId === project.id);
const currentFilm = (studio: StudioService, project: Project) => films(studio, project).find(film => film.data.episodeId === 'two')!;
async function render(studio: StudioService, project: Project): Promise<Task> {
  return finish(studio, await studio.invoke<Task>('studio.run', { projectId: project.id, stage: 'render' }));
}

test('F09 renders two real episodes, prepends QA recap, shifts captions once and reuses the final cache', async () => {
  await fixture(async ({ studio, project, prior, tools }) => {
    const first = await render(studio, project); assert.equal(first.status, 'succeeded', first.error); assert.equal(first.outputIds.length, 2);
    const film = currentFilm(studio, project); const production = record(film.data.production); const recap = record(production.recap);
    assert.equal(recap.sourceProjectId, prior.id); assert.ok(Math.abs(Number(recap.duration) - 1.2) < 0.06); assert.equal(record(production.render).assetId, first.outputIds[1]);
    assert.equal(production.subtitleInputHash, inputHash(film.data)); assert.equal(film.data.productionStale, false);
    const cues = parseSrt(String(production.subtitle)); assert.equal(cues[0].text, 'Prior sentence'); assert.equal(cues[1].text, 'Current sentence');
    assert.ok(Math.abs(cues[1].start - 1.4) < 0.06); assert.ok(Math.abs((await tools.probe(studio.store.assetPath(first.outputIds[1]))).duration - 3.2) < 0.08);
    const rawIds = recap.rawOutputIds as string[]; assert.equal(rawIds.length, 1); assert.notEqual(rawIds[0], first.outputIds[1]); assert.ok(Math.abs((await tools.probe(studio.store.assetPath(rawIds[0]))).duration - 2) < 0.06);
    const beforeAssets = studio.store.assets().length; const again = await render(studio, project); assert.equal(again.status, 'succeeded', again.error);
    assert.deepEqual(again.outputIds, first.outputIds); assert.equal(studio.store.assets().length, beforeAssets); assert.equal(record(currentFilm(studio, project).data.production).subtitle, production.subtitle);
    const exported = await studio.invoke<{ id: string }>('srt.export', { projectId: film.id }); assert.deepEqual(parseSrt(await readFile(studio.store.assetPath(exported.id), 'utf8')), cues);
  });
});

test('F09 unreviewed clips use an explicit tail warning and never invent recap captions', async () => {
  await fixture(async ({ studio, project }) => {
    const done = await render(studio, project); assert.equal(done.status, 'succeeded', done.error);
    const production = record(currentFilm(studio, project).data.production); const recap = record(production.recap);
    assert.match(JSON.stringify(recap.warnings), /unreviewed|chưa.*kiểm|tail/i); const cues = parseSrt(String(production.subtitle)); assert.equal(cues.length, 1); assert.equal(cues[0].text, 'Current sentence'); assert.ok(Math.abs(cues[0].start - 4.7) < 0.06);
  }, { qa: false });
});

test('F09 capped dialogue is omitted while fully retained recap-only captions are allowed', async () => {
  await fixture(async ({ studio, project }) => {
    const done = await render(studio, project); assert.equal(done.status, 'succeeded', done.error);
    const production = record(currentFilm(studio, project).data.production); const cues = parseSrt(String(production.subtitle)); assert.equal(cues.length, 1); assert.equal(cues[0].text, 'Current sentence');
  }, { capped: true });
  await fixture(async ({ studio, project }) => {
    const done = await render(studio, project); assert.equal(done.status, 'succeeded', done.error);
    const production = record(currentFilm(studio, project).data.production); assert.deepEqual(parseSrt(String(production.subtitle)).map(cue => cue.text), ['Prior sentence']);
  }, { mainSubtitle: false });
});

test('F09 rejects stale or invalid QA rather than replacing it with an unreviewed tail', async () => {
  for (const stale of ['fingerprint', 'assetId', 'span', 'production']) await fixture(async ({ studio, project, prior }) => {
    const data = structuredClone(prior.data); const reviews = record(data.qualityReviews); const speech = record(record(Object.values(reviews)[0]).speech);
    if (stale === 'fingerprint') speech.fingerprint = 'stale'; else if (stale === 'assetId') speech.assetId = 'other-asset'; else if (stale === 'span') record(speech.acoustic).parts = [{ start: 3, end: 2 }]; else data.productionStale = true;
    studio.store.saveProject({ ...prior, data });
    const [task] = studio.store.createTasks({ projectId: project.id, kind: 'pipeline', prompts: [project.name], input: { projectSnapshot: project, stage: 'render', shotIds: [`${project.id}/two/new`] } });
    studio.queue.enqueue([task.id]); const done = await finish(studio, task); assert.notEqual(done.status, 'succeeded'); assert.match(done.error, /QA|stale|cũ|speech|khớp/i);
    const film = currentFilm(studio, project); assert.equal(record(film.data.production).recap, undefined);
  });
});

test('F09 resumes from raw episode output after CPU failure without a doubled offset', async () => {
  await fixture(async ({ studio, project, previousClip, root }) => {
    const moved = join(root, 'temporarily-unavailable.mp4'); let displaced = false;
    const changed = () => { if (!displaced && studio.store.tasks().some(task => task.status === 'running' && /Đang dựng recap/.test(task.message))) { displaced = true; renameSync(previousClip, moved); } };
    studio.on('changed', changed); const first = await render(studio, project); studio.off('changed', changed);
    assert.equal(displaced, true); assert.notEqual(first.status, 'succeeded'); const state = record(record(first.checkpoint.episodes).two); const rawIds = state.rawOutputIds as string[]; assert.ok(rawIds?.length);
    renameSync(moved, previousClip); await studio.invoke('task.action', { action: 'retry', ids: [first.id] }); const done = await finish(studio, first); assert.equal(done.status, 'succeeded', done.error);
    const recap = record(record(currentFilm(studio, project).data.production).recap); assert.deepEqual(recap.rawOutputIds, rawIds);
    assert.ok(Math.abs(parseSrt(String(record(currentFilm(studio, project).data.production).subtitle)).at(-1)!.start - 1.4) < 0.06);
  });
});

test('F09 a selected later episode uses the existing immediately preceding film and preserves its plan', async () => {
  await fixture(async ({ studio, project, prior }) => {
    const [task] = studio.store.createTasks({ projectId: project.id, kind: 'pipeline', prompts: [project.name], input: { projectSnapshot: project, stage: 'render', shotIds: [`${project.id}/two/new`] } });
    studio.queue.enqueue([task.id]); const done = await finish(studio, task); assert.equal(done.status, 'succeeded', done.error); assert.equal(done.outputIds.length, 1);
    assert.deepEqual(studio.store.project(prior.id).data.shots, prior.data.shots); assert.equal(record(record(currentFilm(studio, project).data.production).recap).sourceProjectId, prior.id);
  });
});

test('F09 cached generated prior videos keep shared music and expose the raw-recap music limitation', async () => {
  await fixture(async ({ studio, project }) => {
    const done = await render(studio, project); assert.equal(done.status, 'succeeded', done.error);
    const film = currentFilm(studio, project); assert.equal(film.data.musicId, project.data.musicId);
    assert.match(JSON.stringify(record(record(film.data.production).recap).warnings), /music|nhạc/i);
  }, { generated: true, music: true });
});

test('F09 is opt-in and bounds thirty episodes before automatic music or character operations', async () => {
  await fixture(async ({ studio, project, tools }) => {
    const done = await render(studio, project); assert.equal(done.status, 'succeeded', done.error); const film = currentFilm(studio, project);
    assert.equal(record(film.data.production).recap, undefined); assert.ok(Math.abs((await tools.probe(studio.store.assetPath(done.outputIds[1]))).duration - 2) < 0.06);
  }, { recap: false });
  await fixture(async ({ studio, project }) => {
    const series = studio.store.saveProject({ ...project, data: { ...project.data, musicMode: 'auto', episodes: Array.from({ length: 31 }, (_, index) => ({ id: String(index), name: String(index), script: 'test' })) } });
    const done = await finish(studio, await studio.invoke<Task>('studio.run', { projectId: series.id, stage: 'all' })); assert.notEqual(done.status, 'succeeded'); assert.match(done.error, /30/);
  });
});

test('F09 current QA resolves generated character portraits using the authored styleText fingerprint', async () => {
  await fixture(async ({ studio, project }) => {
    const done = await render(studio, project); assert.equal(done.status, 'succeeded', done.error);
    assert.equal(parseSrt(String(record(currentFilm(studio, project).data.production).subtitle))[0].text, 'Prior sentence');
  }, { portrait: true });
});

test('F09 a content edit during concat cannot publish output IDs or recap metadata', async () => {
  await fixture(async ({ studio, project, prior }) => {
    const first = await render(studio, project); assert.equal(first.status, 'succeeded', first.error);
    const film = currentFilm(studio, project); const oldRecap = structuredClone(record(film.data.production).recap); const count = studio.store.assets().length;
    const previous = studio.store.project(prior.id); const reviews = structuredClone(record(previous.data.qualityReviews)); const speech = record(record(Object.values(reviews)[0]).speech);
    record(speech.acoustic).parts = [{ start: 0.5, end: 1.1 }]; studio.store.saveProject({ ...previous, data: { ...previous.data, qualityReviews: reviews } });
    let publications = 0; let edited = false;
    const changed = () => {
      if (edited || !studio.store.tasks().some(task => task.status === 'running' && /Recap: Publishing rendered media/.test(task.message))) return;
      if (++publications === 2) { edited = true; const current = studio.store.project(film.id); studio.store.saveProject({ ...current, data: { ...current.data, script: 'Edited during recap concat' } }); }
    };
    studio.on('changed', changed); const done = await render(studio, project); studio.off('changed', changed);
    assert.equal(edited, true); assert.notEqual(done.status, 'succeeded'); const current = studio.store.project(film.id);
    assert.deepEqual(current.data.outputIds, film.data.outputIds); assert.deepEqual(record(current.data.production).recap, oldRecap);
    assert.equal(current.data.script, 'Edited during recap concat'); assert.equal(studio.store.assets().length, count);
  });
});

test('F09 omits generated subtitle metadata when neither main captions nor reviewed recap captions exist', async () => {
  await fixture(async ({ studio, project }) => {
    const done = await render(studio, project); assert.equal(done.status, 'succeeded', done.error); const production = record(currentFilm(studio, project).data.production);
    assert.equal(production.subtitle, undefined); assert.equal(production.subtitleInputHash, undefined);
  }, { qa: false, mainSubtitle: false });
});

test('F09 interrupted checkpoints with a deleted raw asset regenerate CPU output instead of prepending to a joined episode', async () => {
  await fixture(async ({ studio, project, tools }) => {
    const first = await render(studio, project); assert.equal(first.status, 'succeeded', first.error);
    const checkpoint = structuredClone(first.checkpoint); delete checkpoint.outputIds;
    const state = record(record(checkpoint.episodes).two); const removed = (state.rawOutputIds as string[])[0]; studio.store.deleteAsset(removed);
    const [task] = studio.store.createTasks({ projectId: project.id, kind: 'pipeline', prompts: [project.name], input: first.input });
    studio.store.updateTask(task.id, { checkpoint }); studio.queue.enqueue([task.id]); const done = await finish(studio, task); assert.equal(done.status, 'succeeded', done.error);
    assert.ok(Math.abs((await tools.probe(studio.store.assetPath(done.outputIds[1]))).duration - 3.2) < 0.08);
    assert.ok(Math.abs(parseSrt(String(record(currentFilm(studio, project).data.production).subtitle)).at(-1)!.start - 1.4) < 0.06);
  });
});

for (const mode of ['ai-source', 'explicit-shots', 'explicit-scenes', 'manual'] as const) {
  test(`series source story edits preserve planning authority: ${mode}`, async () => {
    await fixture(async ({ studio, project, prior, root, tools }) => {
      const png = join(root, 'story-frame.png'); await exec(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=64x64', '-frames:v', '1', png]);
      const frame = (await studio.importFiles([png]))[0]; let requests = 0; let requestText = '';
      const server = createServer(async (req, res) => {
        for await (const chunk of req) requestText += String(chunk); requests++;
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ characters: [], scenes: [], shots: [{ id: 'fresh', prompt: 'New plot from AI', dialogue: 'New source story', duration: 0.3, assetId: frame.id }] }) } }] }));
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
      try {
        studio.store.setSettings({ providers: { ...studio.store.settings().providers, text: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fixture', hasKey: false } } });
        const manualShot = { id: 'manual', prompt: 'Manual plot remains authoritative', duration: 0.3, assetId: frame.id };
        const episode = { id: 'one', name: 'Episode one', script: 'New source story', ...(mode === 'explicit-shots' ? { shots: [manualShot] } : mode === 'explicit-scenes' ? { scenes: [{ id: 'scene', shots: [manualShot] }] } : {}) };
        const series = studio.store.saveProject({ ...project, data: { ...project.data, recap: false, renderMode: 'slideshow', keepScript: true, autoChecks: false, burnSubtitles: false, fadeOut: 0, episodes: [episode] } });
        studio.store.saveProject({ ...prior, data: { ...prior.data, renderMode: 'slideshow', keepScript: true, script: 'Old source story', shots: [{ id: 'old', prompt: 'Old saved plot', duration: 0.6, assetId: frame.id }], planning: { source: mode === 'manual' ? 'manual' : 'ai-api' }, planningNeedsUpdate: mode.startsWith('explicit'), production: { images: { preserved: frame.id } } } });
        const done = await finish(studio, await studio.invoke<Task>('studio.run', { projectId: series.id, stage: 'all' })); assert.equal(done.status, 'succeeded', done.error);
        const film = studio.store.project(prior.id); const steps = pipelineSteps(film, { speech: false });
        assert.equal(requests, mode === 'ai-source' ? 1 : 0); assert.equal(film.data.planningNeedsUpdate, false);
        if (mode === 'ai-source') { assert.match(requestText, /New source story/); assert.ok(steps.some(step => step.id.includes('/fresh/'))); }
        else assert.ok(steps.some(step => step.id.includes(mode === 'manual' ? '/old/' : '/manual/')));
        assert.equal(record(record(film.data.production).images).preserved, frame.id);
        assert.ok(Math.abs((await tools.probe(studio.store.assetPath(done.outputIds[0]))).duration - (mode === 'manual' ? 0.6 : 0.3)) < 0.06);
      } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    });
  });
}
