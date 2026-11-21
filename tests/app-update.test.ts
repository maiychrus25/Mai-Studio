import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { AppUpdates, RELEASES_URL, allowPrerelease, downloadVerified, handOffInstaller, pickMacDmg, type UpdateDeps, type UpdateFile } from '../src/core/app-update';
import { StudioService } from '../src/core/studio';

const sha512 = (data: Buffer) => createHash('sha512').update(data).digest('base64');
const macFiles = (dmg: Buffer): UpdateFile[] => [
  { url: 'MaiStudio-1.2.0-arm64.zip', sha512: 'zip', size: 1 }, { url: 'MaiStudio-1.2.0-arm64.dmg', sha512: sha512(dmg), size: dmg.length },
  { url: 'MaiStudio-1.2.0-x64.zip', sha512: 'zip', size: 1 }, { url: 'MaiStudio-1.2.0-x64.dmg', sha512: 'other', size: 9 },
];
const fakeFetch = (body: Buffer, urls: string[] = []) => (async (url: string | URL | Request) => { urls.push(String(url)); return new Response(new Uint8Array(body)); }) as typeof fetch;
async function until(condition: () => boolean): Promise<void> { for (let n = 0; n < 200 && !condition(); n++) await delay(5); assert.ok(condition(), 'condition not reached'); }
function harness(overrides: Partial<UpdateDeps> = {}) {
  const calls = { check: [] as boolean[], download: 0, install: 0, opened: [] as string[], external: [] as string[], changed: 0 };
  const dir = mkdtempSync(join(tmpdir(), 'maistudio-app-update-'));
  const deps: UpdateDeps = {
    version: '1.1.0', packaged: true, platform: 'win32', arch: 'x64', appImage: false, downloadDir: dir,
    check: async allow => { calls.check.push(allow); return { version: '1.2.0', files: [], available: true }; },
    download: async () => { calls.download++; }, install: () => { calls.install++; },
    openPath: async path => { calls.opened.push(path); }, openExternal: async url => { calls.external.push(url); },
    changed: () => { calls.changed++; }, ...overrides,
  };
  return { updates: new AppUpdates(deps), calls, dir };
}

test('prerelease updates follow the running version', () => {
  assert.equal(allowPrerelease('0.2.0-dev.5'), true);
  assert.equal(allowPrerelease('1.0.0'), false);
});

test('macOS update picks the dmg built for the running architecture and refuses foreign URLs', () => {
  const files = macFiles(Buffer.from('dmg'));
  assert.equal(pickMacDmg(files, 'arm64').url, 'MaiStudio-1.2.0-arm64.dmg');
  assert.equal(pickMacDmg(files, 'x64').url, 'MaiStudio-1.2.0-x64.dmg');
  assert.throws(() => pickMacDmg(files.filter(file => !file.url.includes('x64')), 'x64'), /dmg/);
  assert.throws(() => pickMacDmg([{ url: 'https://example.com/MaiStudio-1.2.0-arm64.dmg', sha512: 'x' }], 'arm64'), /dmg/);
  assert.throws(() => pickMacDmg([{ url: '../MaiStudio-1.2.0-arm64.dmg', sha512: 'x' }], 'arm64'), /dmg/);
});

test('verified download keeps a matching file and deletes a mismatching one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maistudio-dmg-'));
  try {
    const body = Buffer.from('MaiStudio dmg bytes'); const progress: number[] = [];
    const target = join(dir, 'MaiStudio-1.2.0-arm64.dmg');
    await downloadVerified('https://example.invalid/a.dmg', target, { url: 'a.dmg', sha512: sha512(body), size: body.length }, value => progress.push(value), fakeFetch(body));
    assert.deepEqual(readFileSync(target), body); assert.equal(progress.at(-1), 100);
    const bad = join(dir, 'bad.dmg');
    await assert.rejects(downloadVerified('https://example.invalid/b.dmg', bad, { url: 'b.dmg', sha512: sha512(Buffer.from('other')), size: body.length }, () => {}, fakeFetch(body)), /sha512/);
    assert.equal(existsSync(bad), false); assert.deepEqual(readdirSync(dir), ['MaiStudio-1.2.0-arm64.dmg']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('unpackaged runs never check and report that only installed builds update', async () => {
  const { updates, calls, dir } = harness({ packaged: false });
  try {
    const view = await updates.check();
    assert.equal(view.status, 'unsupported'); assert.match(view.message ?? '', /bản cài/i); assert.deepEqual(calls.check, []);
    await assert.rejects(updates.install(() => {}), /bản cài/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('check reports available, latest and errors without throwing', async () => {
  const dev = harness({ version: '0.2.0-dev.5' });
  let result: Awaited<ReturnType<UpdateDeps['check']>> = { version: '0.2.0-dev.6', files: [], available: true };
  const stable = harness({ check: async allow => { stable.calls.check.push(allow); if (!result) throw new Error('getaddrinfo ENOTFOUND github.com'); return result; } });
  try {
    assert.equal((await dev.updates.check()).status, 'available'); assert.deepEqual(dev.calls.check, [true]);
    assert.deepEqual(await stable.updates.check(), { status: 'available', mode: 'install', current: '1.1.0', version: '0.2.0-dev.6' });
    assert.deepEqual(stable.calls.check, [false]);
    result = { version: '1.1.0', files: [], available: false };
    assert.equal((await stable.updates.check()).status, 'latest');
    result = null;
    const failed = await stable.updates.check();
    assert.equal(failed.status, 'error'); assert.match(failed.message ?? '', /ENOTFOUND/);
  } finally { rmSync(dev.dir, { recursive: true, force: true }); rmSync(stable.dir, { recursive: true, force: true }); }
});

test('Windows and AppImage download in the background and install only after the download finished', async () => {
  const { updates, calls, dir } = harness(); let handoffs = 0;
  try {
    await assert.rejects(updates.install(() => { handoffs++; }), /Kiểm tra/);
    await updates.check();
    assert.deepEqual(await updates.install(() => { handoffs++; }), { downloading: true });
    assert.equal(calls.download, 1); assert.equal(updates.view().status, 'downloading');
    updates.progress(42.4); assert.equal(updates.view().percent, 42);
    await updates.install(() => { handoffs++; }); assert.equal(calls.download, 1, 'a running download is not restarted');
    assert.equal(handoffs, 0); assert.equal(calls.install, 0);
    updates.downloaded(); assert.equal(updates.view().status, 'downloaded');
    assert.deepEqual(await updates.install(() => { handoffs++; }), { installing: true });
    assert.equal(handoffs, 1); assert.equal(calls.install, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a refused installer handoff does not quit the app', async () => {
  const { updates, calls, dir } = harness();
  try {
    await updates.check(); await updates.install(() => {}); updates.downloaded();
    await assert.rejects(updates.install(() => { throw new Error('Đợi công việc xong rồi cài'); }), /Đợi/);
    assert.equal(calls.install, 0); assert.equal(updates.view().status, 'downloaded');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a failed background download stays in the update state', async () => {
  const { updates, dir } = harness({ download: async () => { throw new Error('socket hang up'); } });
  try {
    await updates.check(); await updates.install(() => {});
    await until(() => updates.view().status === 'error');
    assert.match(updates.view().message ?? '', /socket hang up/); assert.equal(updates.view().version, '1.2.0');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Linux deb installs open the release page instead of installing', async () => {
  const { updates, calls, dir } = harness({ platform: 'linux', appImage: false });
  try {
    await updates.check(); assert.equal(updates.view().mode, 'page');
    assert.deepEqual(await updates.install(() => { throw new Error('must not hand off'); }), { opened: true });
    assert.deepEqual(calls.external, [`${RELEASES_URL}/tag/v1.2.0`]); assert.equal(calls.download, 0); assert.equal(calls.install, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('macOS downloads the dmg for its architecture, verifies sha512 and opens it without quitting', async () => {
  const body = Buffer.from('arm64 dmg'); const urls: string[] = [];
  const { updates, calls, dir } = harness({ platform: 'darwin', arch: 'arm64', check: async () => ({ version: '1.2.0', files: macFiles(body), available: true }), fetch: fakeFetch(body, urls) });
  try {
    await updates.check(); assert.equal(updates.view().mode, 'dmg');
    assert.deepEqual(await updates.install(() => { throw new Error('must not hand off'); }), { downloading: true });
    await until(() => updates.view().status === 'downloaded');
    const dmg = join(dir, 'MaiStudio-1.2.0-arm64.dmg');
    assert.deepEqual(urls, [`${RELEASES_URL}/download/v1.2.0/MaiStudio-1.2.0-arm64.dmg`]);
    assert.deepEqual(calls.opened, [dmg]); assert.deepEqual(readFileSync(dmg), body);
    await updates.install(() => { throw new Error('must not hand off'); });
    assert.deepEqual(calls.opened, [dmg, dmg]); assert.equal(calls.download, 0); assert.equal(calls.install, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('macOS never opens a dmg whose sha512 differs from the release metadata', async () => {
  const body = Buffer.from('arm64 dmg');
  const { updates, calls, dir } = harness({ platform: 'darwin', arch: 'arm64', check: async () => ({ version: '1.2.0', files: macFiles(Buffer.from('published')), available: true }), fetch: fakeFetch(body) });
  try {
    await updates.check(); await updates.install(() => {});
    await until(() => updates.view().status === 'error');
    assert.match(updates.view().message ?? '', /sha512/); assert.deepEqual(calls.opened, []); assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('studio state shows the running version and update state; update.check reaches the updater', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-update-state-'));
  const { updates, dir } = harness({ packaged: false });
  const plain = new StudioService(mkdtempSync(join(tmpdir(), 'maistudio-update-plain-')));
  const studio = new StudioService(root, { version: '0.2.0-dev.5', actions: { checkUpdate: () => updates.check(), installUpdate: before => updates.install(before), updateState: () => updates.view() } });
  try {
    assert.equal(studio.snapshot().version, '0.2.0-dev.5');
    assert.equal(plain.snapshot().update.status, 'unsupported');
    assert.equal((await studio.invoke<{ status: string }>('update.check')).status, 'unsupported');
    assert.equal(studio.snapshot().update.status, 'unsupported');
    const project = studio.store.saveProject({ name: 'busy' });
    const [task] = studio.store.createTasks({ projectId: project.id, prompts: ['busy'], kind: 'image' });
    studio.store.updateTask(task.id, { status: 'running' });
    await assert.rejects(studio.invoke('update.install'), /Đợi công việc/);
  } finally { await studio.close(); await plain.close(); rmSync(plain.store.root, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); }
});

test('a failed installer handoff can be retried without restarting the app', () => {
  // Mirrors electron-updater's BaseUpdater.install(): it marks itself called before trying and ignores later calls.
  const updater = { quitAndInstallCalled: false, works: false, calls: 0, install(_silent: boolean, _forceRun: boolean) {
    if (this.quitAndInstallCalled) return false; this.quitAndInstallCalled = true; this.calls++; return this.works;
  } };
  assert.throws(() => handOffInstaller(updater, true), /trình cài/);
  assert.equal(updater.quitAndInstallCalled, false);
  updater.works = true;
  handOffInstaller(updater, true); assert.equal(updater.calls, 2);
});

test('macOS re-verifies a downloaded dmg before opening it again', async () => {
  const body = Buffer.from('arm64 dmg');
  const { updates, calls, dir } = harness({ platform: 'darwin', arch: 'arm64', check: async () => ({ version: '1.2.0', files: macFiles(body), available: true }), fetch: fakeFetch(body) });
  try {
    await updates.check(); await updates.install(() => {});
    await until(() => updates.view().status === 'downloaded');
    writeFileSync(join(dir, 'MaiStudio-1.2.0-arm64.dmg'), 'tampered');
    assert.deepEqual(await updates.install(() => {}), { downloading: true });
    await until(() => calls.opened.length === 2);
    assert.deepEqual(readFileSync(join(dir, 'MaiStudio-1.2.0-arm64.dmg')), body);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
