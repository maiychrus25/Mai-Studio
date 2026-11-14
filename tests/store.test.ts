import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/core/store';

test('assets produced during an active pipeline stay locked through checkpoints and current production state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-asset-lock-')); const store = new Store(root);
  try {
    const path = join(root, 'frame.png'); writeFileSync(path, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=', 'base64'));
    const asset = await store.importAsset(path); const project = store.saveProject({ name: 'active' });
    const [task] = store.createTasks({ projectId: project.id, prompts: ['render'], kind: 'pipeline' });
    store.updateTask(task.id, { status: 'running', checkpoint: { steps: { image: { assetId: asset.id } } } });
    assert.throws(() => store.deleteAsset(asset.id), /sử dụng|running|active/i);
    store.updateTask(task.id, { checkpoint: {} }); store.saveProject({ ...project, data: { production: { images: { one: asset.id } } } });
    assert.throws(() => store.deleteAsset(asset.id), /sử dụng|running|active/i);
    store.updateTask(task.id, { status: 'cancelled' }); store.deleteAsset(asset.id); assert.equal(store.assets().length, 0);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('projects and queued tasks persist across reopen without losing input or refs', () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-store-'));
  try {
    let store = new Store(root);
    const project = store.saveProject({ name: 'Dự án mùa đông', kind: 'studio' });
    const tasks = store.createTasks({ projectId: project.id, prompts: ['one', 'two'], kind: 'image', input: { ratio: '9:16', refIds: ['asset-a'] } });
    assert.equal(tasks.length, 2);
    store.updateTask(tasks[0].id, { status: 'queued' });
    store.close();
    store = new Store(root);
    assert.equal(store.projects()[0].name, 'Dự án mùa đông');
    assert.equal(store.tasks()[0].status, 'queued');
    assert.deepEqual(store.tasks()[0].input.refIds, ['asset-a']);
    assert.equal(store.tasks()[1].position, 1);
    store.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('store rejects invalid tasks and cannot erase referenced projects with active jobs', () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-store-'));
  const store = new Store(root);
  try {
    assert.throws(() => store.createTasks({ projectId: 'missing', prompts: ['x'], kind: 'image' }), /project|dự án/i);
    const p = store.saveProject({ name: 'one' });
    assert.throws(() => store.createTasks({ projectId: p.id, prompts: [' '], kind: 'image' }), /prompt/i);
    assert.throws(() => store.createTasks({ projectId: p.id, prompts: ['x'.repeat(32769)], kind: 'image' }), /prompt/i);
    const [task] = store.createTasks({ projectId: p.id, prompts: ['x'], kind: 'image' });
    store.updateTask(task.id, { status: 'running' });
    assert.throws(() => store.deleteProject(p.id), /running|đang/i);
    assert.equal(store.tasks().length, 1);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('asset import copies trusted media and never exposes its path in public views', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-assets-'));
  const store = new Store(root);
  try {
    const source = join(root, 'ảnh tham chiếu.png');
    writeFileSync(source, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
    const asset = await store.importAsset(source);
    assert.equal(asset.mime, 'image/png');
    assert.equal('path' in asset, false);
    assert.notEqual(store.assetPath(asset.id), source);
    assert.throws(() => store.assetPath('../../etc/passwd'), /asset|tệp/i);
    const invalid = join(root, 'fake.png'); writeFileSync(invalid, '<script>x</script>');
    await assert.rejects(store.importAsset(invalid), /media|tệp|định dạng/i);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
