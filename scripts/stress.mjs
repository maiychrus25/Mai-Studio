import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const round = Number(process.argv[2] || 1);
assert.ok(round === 1 || round === 2, 'round must be 1 or 2');
const root = resolve(import.meta.dirname, '..');
const artifacts = process.env.MAISTUDIO_REPORT_DIR || await mkdtemp(join(tmpdir(), 'mai-studio-stress-'));
await mkdir(artifacts, { recursive: true });
const dataRoot = await mkdtemp(join(tmpdir(), `mai-studio-round-${round}-`));
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=';
let active = 0, peak = 0, requests = 0;
const provider = createServer(async (request, response) => {
  for await (const _chunk of request) { /* drain bounded generated fixture request */ }
  active++; const sequence = ++requests; peak = Math.max(peak, active);
  const cancelled = new AbortController(); response.on('close', () => cancelled.abort());
  try { await delay(round === 2 && sequence === 1 ? 2000 : round === 1 ? 4 : 12, undefined, { signal: cancelled.signal }); }
  catch { active--; return; }
  response.setHeader('content-type', 'application/json');
  if (round === 2 && requests % 13 === 0) { response.statusCode = 429; response.end('{"error":{"message":"fixture rate limit"}}'); }
  else response.end(JSON.stringify({ data: [{ b64_json: png }] }));
  active--;
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
const port = provider.address().port;
const environment = { ...process.env, MAISTUDIO_DATA_DIR: dataRoot };
delete environment.ELECTRON_RUN_AS_NODE;
let app;
const failures = [];
const metrics = { round, dataRoot, startedAt: new Date().toISOString(), peakProviderConcurrency: 0, requests: 0, ui: [] };
try {
  app = await electron.launch({ args: [root], env: environment, timeout: 45000 });
  const page = await app.firstWindow();
  page.on('pageerror', error => failures.push(error.message));
  await page.waitForFunction(() => window.studio && document.querySelector('nav'), { timeout: 30000 });
  const invoke = (command, input = {}) => page.evaluate(({ command, input }) => window.studio.invoke(command, input), { command, input });
  await invoke('settings.save', { language: 'en', providers: { image: { baseUrl: `http://127.0.0.1:${port}/v1`, model: 'fixture' } } });
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await invoke('secret.save', { key: 'image.key', value: 'fixture-only' });
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Project name').fill(`UI rehearsal ${round}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Save project', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByLabel('Your prompts', { exact: true }).fill('Actual renderer primary action rehearsal');
  await page.getByRole('button', { name: 'Create & run', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  let rehearsal;
  for (let index = 0; index < 100; index++) { await delay(50); rehearsal = await invoke('state'); if (rehearsal.tasks.some(task => task.status === 'succeeded')) break; }
  const rehearsed = rehearsal.tasks.find(task => task.prompt === 'Actual renderer primary action rehearsal');
  assert.equal(rehearsed?.status, 'succeeded', 'the real Create & run UI action must finish a real fixture job');
  await invoke('task.action', { action: 'delete', ids: [rehearsed.id] });
  for (const id of rehearsed.outputIds) await invoke('asset.delete', { id });
  requests = 0; peak = 0;
  const project = await invoke('project.save', { name: `Round ${round} production`, kind: 'studio' });
  await invoke('queue.pause');
  const tasks = await invoke('task.create', { projectId: project.id, kind: 'image', input: { retryLimit: 0 }, prompts: Array.from({ length: 1000 }, (_, index) => `Fixture frame ${index + 1}`) });
  assert.equal(tasks.length, 1000);
  await invoke('task.reorder', { ids: tasks.map(task => task.id).reverse() });
  await invoke('task.action', { action: 'run', ids: tasks.map(task => task.id) });
  await invoke('task.action', { action: 'cancel', ids: tasks.slice(0, round === 1 ? 20 : 50).map(task => task.id) });
  await invoke('queue.resume');
  if (round === 2) {
    await delay(50);
    const running = (await invoke('state')).tasks.find(task => task.status === 'running');
    assert.ok(running, 'round two must exercise a running-job cancel');
    await invoke('task.action', { action: 'cancel', ids: [running.id] });
  }
  const first = Date.now();
  let state;
  do {
    await delay(200);
    state = await invoke('state');
    if (Date.now() - first > 90000) throw new Error('queue stress exceeded 90 seconds');
  } while (state.tasks.some(task => ['queued', 'running'].includes(task.status)));
  assert.equal(state.tasks.length, 1000);
  const cancelled = state.tasks.filter(task => task.status === 'cancelled').length;
  assert.equal(cancelled, round === 1 ? 20 : 51, 'round two must cancel one actual running request');
  assert.equal(state.tasks.filter(task => task.status === 'succeeded').length + state.tasks.filter(task => task.status === 'failed').length + cancelled, 1000);
  assert.equal(new Set(state.tasks.flatMap(task => task.outputIds)).size, state.tasks.filter(task => task.status === 'succeeded').length);
  assert.ok(peak <= 2, `peak provider concurrency ${peak}`);
  metrics.queueMs = Date.now() - first;
  metrics.statuses = Object.fromEntries([...new Set(state.tasks.map(task => task.status))].map(status => [status, state.tasks.filter(task => task.status === status).length]));
  metrics.memory = await app.evaluate(() => process.memoryUsage());
  const series = await invoke('project.save', { name: `UI series ${round}`, kind: 'series' });
  const desktopNav = page.getByRole('navigation', { name: 'Main navigation' });
  await desktopNav.getByRole('button', { name: 'Series', exact: true }).click();
  await page.locator('#project-picker').selectOption(series.id);
  await page.getByRole('tab', { name: 'Episodes', exact: true }).click();
  await page.getByRole('button', { name: 'Add episode', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Episode from actual UI');
  await page.getByLabel('Episode script', { exact: true }).fill('A reviewable episode script.');
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await page.getByLabel('Title card (optional)', { exact: true }).fill('Opening');
  await page.getByLabel('End card (optional)', { exact: true }).fill('Closing');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await page.waitForFunction(id => window.studio.invoke('state').then(state => state.projects.find(project => project.id === id)?.data.episodes?.[0]?.name === 'Episode from actual UI'), series.id);
  const savedSeries = (await invoke('state')).projects.find(project => project.id === series.id);
  assert.equal(savedSeries.data.titleCard, 'Opening'); assert.equal(savedSeries.data.endCard, 'Closing');
  metrics.episodeForm = 'PASS';
  await desktopNav.getByRole('button', { name: 'Studio', exact: true }).click();
  await page.locator('#project-picker').selectOption(project.id);
  const pages = ['Library', 'SRT Video', 'Films', 'Series', 'Video Affiliate', 'Dubbing', 'Market', 'Accounts', 'Proxies', 'Codex AI', 'Settings', 'Studio'];
  async function navigate(name, mobile) {
    if (mobile) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    const nav = page.getByRole('navigation', { name: mobile ? 'Mobile navigation' : 'Main navigation' });
    await nav.getByRole('button', { name, exact: true }).click();
    await delay(25);
    const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(layout.scroll <= layout.width + 1, `${name} horizontal overflow ${layout.scroll}/${layout.width}`);
  }
  for (const [width, height, label] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await invoke('settings.save', { theme });
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('#workspace')?.scrollTo(0, 0); });
      await delay(120);
      const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, rows: document.querySelectorAll('.task-row').length, title: document.querySelector('h1')?.textContent }));
      assert.ok(layout.scroll <= layout.width + 1, `${label}/${theme} horizontal overflow ${layout.scroll}/${layout.width}`);
      assert.ok(layout.rows <= 50, 'task pagination must bound rendered rows');
      const screenshot = join(artifacts, `round-${round}-${label}-${theme}.png`);
      await page.screenshot({ path: screenshot, fullPage: false }); metrics.ui.push({ label, theme, ...layout, screenshot });
      for (const name of pages) await navigate(name, width < 900);
    }
  }
  assert.deepEqual(failures, [], 'renderer errors');
  const requestsBeforeReopen = requests;
  await app.close(); app = undefined;
  app = await electron.launch({ args: [root], env: environment, timeout: 45000 });
  const reopened = await app.firstWindow(); await reopened.waitForFunction(() => window.studio && document.querySelector('nav'));
  const after = await reopened.evaluate(() => window.studio.invoke('state'));
  assert.equal(after.tasks.length, 1000); assert.equal(after.assets.length, state.assets.length);
  await delay(100);
  assert.equal(requests, requestsBeforeReopen, 'reopen must not resubmit finished/cancelled work');
  metrics.peakProviderConcurrency = peak; metrics.requests = requests; metrics.rendererErrors = failures;
  metrics.result = 'PASS'; metrics.finishedAt = new Date().toISOString();
  await writeFile(join(artifacts, `round-${round}.json`), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify({ result: 'PASS', round, queueMs: metrics.queueMs, statuses: metrics.statuses, peak, requests, memory: metrics.memory, screenshots: metrics.ui.length, artifacts }));
} finally {
  await app?.close(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));
}
