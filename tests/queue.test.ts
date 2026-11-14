import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/core/store';
import { JobQueue, RetryableError } from '../src/core/queue';

async function until(check: () => boolean): Promise<void> {
  for (let n = 0; n < 300; n++) { if (check()) return; await delay(10); }
  assert.fail('queue did not reach the expected state');
}

test('queue enforces global and per-account leases and persists completed progress', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-queue-')); const store = new Store(root);
  let active = 0; let peak = 0; const accounts = new Set<string>();
  const queue = new JobQueue(store, async (task, context) => {
    assert.equal(accounts.has(task.accountId), false); accounts.add(task.accountId);
    active++; peak = Math.max(peak, active); context.checkpoint({ thread: task.id });
    await delay(20); context.progress(0.5, 'working'); active--; accounts.delete(task.accountId);
    return { outputIds: [] };
  }, { generationConcurrency: 2, mediaConcurrency: 1 });
  try {
    const p = store.saveProject({ name: 'queue' });
    const a = store.saveAccount({ name: 'a' }); const b = store.saveAccount({ name: 'b' });
    const first = store.createTasks({ projectId: p.id, kind: 'image', prompts: ['a1', 'a2'], accountId: a.id });
    const second = store.createTasks({ projectId: p.id, kind: 'image', prompts: ['b1'], accountId: b.id });
    queue.enqueue([...first, ...second].map(t => t.id));
    await until(() => store.tasks().every(t => t.status === 'succeeded'));
    assert.equal(peak, 2);
    assert.equal(store.task(first[0].id).progress, 1);
    assert.equal(store.task(first[0].id).checkpoint.thread, first[0].id);
    await queue.cancel([first[0].id]);
    assert.equal(store.task(first[0].id).status, 'succeeded', 'stale cancel must not relabel a completed job');
  } finally { await queue.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('global pause survives application restart and does not unexpectedly submit queued paid work', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-paused-')); const store = new Store(root); let calls = 0;
  const queue = new JobQueue(store, async () => { calls++; return { outputIds: [] }; });
  const p = store.saveProject({ name: 'paused' }); const [task] = store.createTasks({ projectId: p.id, prompts: ['one'], kind: 'image' });
  queue.pause(); queue.enqueue([task.id]); await queue.close();
  const reopened = new JobQueue(store, async () => { calls++; return { outputIds: [] }; });
  try {
    await delay(20); assert.equal(calls, 0); assert.equal(reopened.isPaused(), true);
    reopened.resume(); await until(() => store.task(task.id).status === 'succeeded'); assert.equal(calls, 1);
  } finally { await reopened.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('explicit pre-admission transient failures retry with a bound and never loop forever', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-retry-')); const store = new Store(root);
  let calls = 0;
  const queue = new JobQueue(store, async () => { calls++; throw new RetryableError('rate limited before admission', 1); });
  try {
    const p = store.saveProject({ name: 'retry' });
    const [task] = store.createTasks({ projectId: p.id, kind: 'image', prompts: ['one'], input: { retryLimit: 2 } });
    queue.enqueue([task.id]); await until(() => store.task(task.id).status === 'failed');
    assert.equal(calls, 3); assert.equal(store.task(task.id).attempts, 3);
    await delay(20); assert.equal(calls, 3);
  } finally { await queue.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('cancelled in-flight jobs never become successful and restart does not auto-submit interrupted work', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-queue-')); const store = new Store(root);
  let runs = 0;
  const queue = new JobQueue(store, async (_task, context) => {
    runs++; await delay(100, undefined, { signal: context.signal }); return { outputIds: [] };
  });
  try {
    const p = store.saveProject({ name: 'cancel' });
    const [task] = store.createTasks({ projectId: p.id, kind: 'image', prompts: ['one'] });
    queue.enqueue([task.id]); await until(() => store.task(task.id).status === 'running');
    await queue.cancel([task.id]);
    assert.equal(store.task(task.id).status, 'cancelled');
    await delay(120); assert.equal(store.task(task.id).status, 'cancelled');
    store.updateTask(task.id, { status: 'running', checkpoint: { remoteSubmitted: true } });
    await queue.close();
    const recovery = new JobQueue(store, async () => { runs++; return { outputIds: [] }; });
    assert.equal(store.task(task.id).status, 'interrupted');
    assert.equal(runs, 1); await recovery.close();
  } finally { await queue.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});
