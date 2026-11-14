import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexJobs } from '../src/core/codex';

async function setup(run: (jobs: CodexJobs, root: string, command: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'studio-codex-'));
  const command = join(root, 'controlled-cli');
  await writeFile(command, `#!/usr/bin/env node
const fs = require('node:fs'); const cp = require('node:child_process'); const a = process.argv.slice(2);
if (a.includes('--version')) { console.log('codex-cli fixture'); process.exit(0); }
if (a.includes('--help')) { console.log('--sandbox --output-last-message --output-schema --skip-git-repo-check --ignore-user-config --ephemeral'); process.exit(0); }
let input = ''; process.stdin.on('data', c => input += c); process.stdin.on('end', () => {
 fs.appendFileSync(${JSON.stringify(join(root, 'calls.jsonl'))}, JSON.stringify({ args: a, cwd: process.cwd(), input }) + '\\n');
 if (input.includes('WAIT')) {
   const child = cp.spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore'});
   fs.writeFileSync(${JSON.stringify(join(root, 'child.pid'))}, String(child.pid)); setInterval(()=>{},1000); return;
 }
 if (input.includes('FLOOD')) { process.stdout.write('x'.repeat(2*1024*1024)); return; }
 if (input.includes('LEAK')) console.log(JSON.stringify({api_key:'fixture-private-key',token:'fixture-session-secret'}));
 const edit = a[a.indexOf('--sandbox')+1] === 'workspace-write';
 if (edit) fs.writeFileSync('artifact.txt', 'approved workspace artifact');
 const result = input.includes('BADPLAN') ? {scenes:[{prompt:''}],characters:[]} : {summary:'Plan summary',scenes:[{id:'s1',prompt:input.includes('SECRETPLAN') ? 'Bearer fixture-plan-secret' : 'Sunrise',duration:5}],characters:[{id:'c1',name:'Mai',description:'Host'}]};
 if (input.includes('BADSCHEMA')) result.summary = 7;
 if (input.includes('EXPAND')) result.scenes = Array.from({length:1000}, (_,i) => ({id:'s'+i,prompt:'sk-a '.repeat(35),duration:1}));
 fs.writeFileSync(a[a.indexOf('--output-last-message')+1], JSON.stringify(result)); console.log('fixture complete');
});
`, { mode: 0o700 });
  const jobs = new CodexJobs(join(root, 'jobs'), { command });
  try { await run(jobs, root, command); } finally { await jobs.close(); await rm(root, { recursive: true, force: true }); }
}
async function settled(jobs: CodexJobs, id: string) {
  for (let i = 0; i < 200; i++) {
    const j = jobs.list().find(j => j.id === id)!;
    if (j.status !== 'running' && j.status !== 'queued') return j;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error('Job did not settle');
}

test('CLI status, private plan workspace, explicit edit approval, atomic persistence and reload', async () => setup(async (jobs, root, command) => {
  assert.equal((await jobs.status()).ready, true);
  const job = await jobs.run('Plan $(touch escaped) Unicode Việt', 'edit');
  const plan = await settled(jobs, job.id);
  assert.equal(plan.status, 'waiting_approval'); assert.equal(plan.approved, false);
  const calls = (await readFile(join(root, 'calls.jsonl'), 'utf8')).trim().split('\n').map(s => JSON.parse(s));
  assert.equal(calls.length, 1); assert.ok(calls[0].args.includes('read-only'));
  assert.equal((await stat(calls[0].cwd)).mode & 0o777, 0o700);
  assert.ok(calls[0].input.includes('$(touch escaped)'));
  assert.ok(!calls[0].args.some((a: string) => a.includes('bypass')));
  assert.ok(!((await readdir(calls[0].cwd)).includes('artifact.txt')));
  const approved = await jobs.approve(job.id); assert.equal(approved.approved, true);
  const complete = await settled(jobs, job.id); assert.equal(complete.status, 'succeeded');
  assert.equal(await readFile(join(calls[0].cwd, 'artifact.txt'), 'utf8'), 'approved workspace artifact');
  const copy = jobs.list(); copy[0].status = 'tampered'; assert.equal(jobs.list()[0].status, 'succeeded');
  await jobs.close();
  const reload = new CodexJobs(join(root, 'jobs'), { command });
  try { assert.equal(reload.list()[0].status, 'succeeded'); await assert.rejects(reload.approve(job.id), /approval|state/i); }
  finally { await reload.close(); }
}));

test('invalid plans, missing CLI and overflowing output never succeed', async () => setup(async (jobs, root) => {
  assert.equal((await settled(jobs, (await jobs.run('BADPLAN', 'plan')).id)).status, 'failed');
  assert.equal((await settled(jobs, (await jobs.run('BADSCHEMA', 'plan')).id)).status, 'failed');
  const flood = await settled(jobs, (await jobs.run('FLOOD', 'plan')).id);
  assert.equal(flood.status, 'failed'); assert.ok(flood.log.length <= 65536);
  const missing = new CodexJobs(join(root, 'missing'), { command: join(root, 'nonexistent') });
  try { assert.equal((await missing.status()).ready, false); } finally { await missing.close(); }
  await assert.rejects(jobs.run('', 'plan'), /prompt/i);
}));

test('cancel kills the process tree; reload marks running jobs interrupted without autorun', async () => setup(async (jobs, root, command) => {
  const j = await jobs.run('WAIT', 'plan');
  let pid = 0;
  for (let i = 0; i < 100; i++) {
    try { pid = Number(await readFile(join(root, 'child.pid'), 'utf8')); break; } catch { await new Promise(r => setTimeout(r, 20)); }
  }
  assert.ok(pid);
  const reload = new CodexJobs(join(root, 'jobs'), { command });
  try { assert.equal(reload.list()[0].status, 'interrupted'); } finally { await reload.close(); }
  await jobs.cancel(j.id); assert.equal(jobs.list()[0].status, 'cancelled');
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch { pid = 0; break; }
    await new Promise(r => setTimeout(r, 20));
  }
  assert.equal(pid, 0, 'descendant must exit');
}));

test('plan approval never starts an edit and closed managers reject new work', async () => setup(async jobs => {
  const plan = await settled(jobs, (await jobs.run('Plan only', 'plan')).id);
  assert.equal(plan.status, 'waiting_approval');
  assert.equal((await jobs.approve(plan.id)).status, 'succeeded');
  assert.equal(jobs.list()[0].approved, true);
  await jobs.close(); await assert.rejects(jobs.run('New job', 'plan'), /closed/);
}));


test('CLI JSON credentials are redacted before snapshots and persistence', async () => setup(async (jobs, root) => {
  const job = await settled(jobs, (await jobs.run('LEAK', 'plan')).id);
  assert.equal(job.status, 'waiting_approval');
  for (const secret of ['fixture-private-key', 'fixture-session-secret']) {
    assert.ok(!job.log.includes(secret), 'snapshot must not expose ' + secret);
    assert.ok(!(await readFile(join(root, 'jobs', 'jobs.json'), 'utf8')).includes(secret));
  }
}));


test('redacted structured results remain valid JSON and can be approved', async () => setup(async jobs => {
  const job = await settled(jobs, (await jobs.run('SECRETPLAN', 'plan')).id);
  assert.equal(job.status, 'waiting_approval');
  assert.ok(!job.result.includes('fixture-plan-secret'));
  assert.doesNotThrow(() => JSON.parse(job.result));
  assert.equal((await jobs.approve(job.id)).status, 'succeeded');
}));

test('stress: racing CLI submissions preserve the four-job limit and close cancels all descendants', async () => setup(async jobs => {
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => jobs.run('WAIT', 'plan')));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 4);
  assert.equal(jobs.list().filter(job => job.status === 'running').length, 4);
  await jobs.close(); assert.ok(jobs.list().every(job => job.status === 'cancelled'));
}));

test('all 100 retained jobs can reload with outputs within each documented bound', async () => setup(async (jobs, root, command) => {
  await jobs.close();
  const workspace = join(root, 'jobs', 'workspace-retained');
  const result = JSON.stringify({ summary: 'Retained', scenes: Array.from({ length: 1000 }, (_, i) => ({ id: 'scene-' + i, prompt: 'x'.repeat(200), duration: 1 })), characters: [] });
  assert.ok(Buffer.byteLength(result) < 256 * 1024);
  const entries = Array.from({ length: 100 }, (_, i) => ({ workspace, phase: 'plan', job: { id: '12345678-1234-1234-1234-' + String(i).padStart(12, '0'), mode: 'plan', prompt: 'p'.repeat(32768), status: 'succeeded', log: 'l'.repeat(65536), result, approved: true, createdAt: Date.now() } }));
  await writeFile(join(root, 'jobs', 'jobs.json'), JSON.stringify(entries));
  const reload = new CodexJobs(join(root, 'jobs'), { command });
  try { assert.equal(reload.list().length, 100); assert.equal(reload.list()[99].result, result); } finally { await reload.close(); }
}));


test('credential redaction cannot grow a retained result beyond the output bound', async () => setup(async (jobs, root, command) => {
  const job = await settled(jobs, (await jobs.run('EXPAND', 'plan')).id);
  assert.equal(job.status, 'failed'); assert.ok(Buffer.byteLength(job.result) <= 256 * 1024);
  await jobs.close();
  const reload = new CodexJobs(join(root, 'jobs'), { command });
  try { assert.equal(reload.list()[0].status, 'failed'); } finally { await reload.close(); }
}));
