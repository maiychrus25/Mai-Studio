import { spawn, type ChildProcess } from 'node:child_process';
import { constants, chmodSync, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CodexJob } from '../shared/studio';
export type { CodexJob } from '../shared/studio';

const LOG_LIMIT = 65536;
const OUTPUT_LIMIT = 1024 * 1024;
const RESULT_LIMIT = 256 * 1024;
const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'scenes', 'characters'],
  properties: {
    summary: { type: 'string' },
    scenes: { type: 'array', maxItems: 1000, items: { type: 'object', additionalProperties: false, required: ['id', 'prompt', 'duration'], properties: { id: { type: 'string' }, prompt: { type: 'string' }, duration: { type: 'number', exclusiveMinimum: 0, maximum: 3600 } } } },
    characters: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'description'], properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' } } } }
  }
};
type RecordEntry = { job: CodexJob; workspace: string; phase: 'plan' | 'edit' };
type Running = { child: ChildProcess; done: Promise<void>; stop: (reason: string) => void };
function redact(value: string): string {
  return value.replace(/\b(Bearer\s+)\S+/gi, '$1[redacted]').replace(/\b(sk-[a-zA-Z0-9_-]+)\b/g, '[redacted]').replace(/((?:api[_-]?key|secret|password|token)[\"']?\s*[=:]\s*["']?)[^\s"',}]+/gi, '$1[redacted]').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}
function boundedFile(path: string, limit: number): string {
  if (lstatSync(path).isSymbolicLink()) throw new Error('Output symlinks are forbidden');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size === 0 || stat.size > limit) throw new Error('Invalid output file size');
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (!count) throw new Error('Output changed while reading');
      offset += count;
    }
    if (readSync(fd, Buffer.alloc(1), 0, 1, offset)) throw new Error('Output grew while reading');
    return buffer.toString('utf8');
  } finally { closeSync(fd); }
}
function validatePlan(raw: string): void {
  const plan = JSON.parse(raw) as Record<string, unknown>;
  const nonempty = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && Buffer.byteLength(v) <= 32768;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('Plan must be an object');
  if (!Array.isArray(plan.scenes) || !Array.isArray(plan.characters) || plan.scenes.length > 1000 || plan.characters.length > 100) throw new Error('Invalid scenes/characters plan schema');
  if (!nonempty(plan.summary) || Object.keys(plan).some(key => !['summary', 'scenes', 'characters'].includes(key))) throw new Error('Invalid plan summary/schema');
  const sceneIds = new Set<string>(); const characterIds = new Set<string>();
  for (const scene of plan.scenes) {
    if (!scene || typeof scene !== 'object' || Array.isArray(scene) || Object.keys(scene).some(key => !['id', 'prompt', 'duration'].includes(key)) || !nonempty(scene.id) || sceneIds.has(scene.id) || !nonempty(scene.prompt) || typeof scene.duration !== 'number' || !Number.isFinite(scene.duration) || scene.duration <= 0 || scene.duration > 3600) throw new Error('Invalid scene plan schema');
    sceneIds.add(scene.id);
  }
  for (const c of plan.characters) {
    if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).some(key => !['id', 'name', 'description'].includes(key)) || !nonempty(c.id) || characterIds.has(c.id) || !nonempty(c.name) || !nonempty(c.description)) throw new Error('Invalid character plan schema');
    characterIds.add(c.id);
  }
}

/** Jobs own isolated artifacts only. approve never copies files to a project or applies Studio data.
 * Both modes first produce a read-only JSON plan. Edit approval starts workspace-write in that same
 * private workspace. CLI hooks/user config are ignored; no shell, automatic approval or bypass flags.
 */
export class CodexJobs {
  private readonly root: string;
  private readonly command: string;
  private readonly records: RecordEntry[] = [];
  private readonly running = new Map<string, Running>();
  private closed = false;
  constructor(root: string, { command = 'codex' }: { command?: string } = {}) {
    this.root = resolve(root); this.command = command;
    mkdirSync(this.root, { recursive: true, mode: 0o700 }); chmodSync(this.root, 0o700);
    const path = join(this.root, 'jobs.json');
    if (existsSync(path)) {
      const entries: unknown = JSON.parse(boundedFile(path, 128 * 1024 * 1024));
      if (!Array.isArray(entries) || entries.length > 100) throw new Error('Invalid Codex job store');
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') throw new Error('Invalid Codex job record');
        const r = entry as RecordEntry; const j = r.job;
        if (!j || typeof j.id !== 'string' || !/^[a-f0-9-]{36}$/.test(j.id) || !['plan', 'edit'].includes(j.mode) || typeof j.prompt !== 'string' || typeof j.log !== 'string' || typeof j.result !== 'string' || typeof j.status !== 'string' || typeof j.approved !== 'boolean' || !Number.isFinite(j.createdAt) || !['plan', 'edit'].includes(r.phase) || typeof r.workspace !== 'string' || dirname(resolve(r.workspace)) !== this.root || Buffer.byteLength(j.result) > RESULT_LIMIT || Buffer.byteLength(j.log) > LOG_LIMIT || Buffer.byteLength(j.prompt) > 32768) throw new Error('Invalid Codex job record');
        if (['queued', 'running'].includes(j.status)) { j.status = 'interrupted'; j.log = 'Interrupted during the previous session; review artifacts before creating a new job.'; }
        this.records.push(r);
      }
      this.persist();
    }
  }
  private persist(): void {
    const path = join(this.root, 'jobs.json'); const temp = join(this.root, `.jobs-${randomUUID()}.tmp`);
    try { writeFileSync(temp, JSON.stringify(this.records), { mode: 0o600, flag: 'wx' }); renameSync(temp, path); }
    finally { if (existsSync(temp)) unlinkSync(temp); }
  }
  private environment(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const name of ['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'CODEX_HOME']) if (process.env[name]) env[name] = process.env[name];
    return env;
  }
  private terminate(child: ChildProcess): void {
    if (!child.pid) return;
    if (process.platform === 'win32') {
      // Windows requires taskkill /T to include descendants; argv is fixed and contains only a PID.
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => child.kill('SIGKILL')); killer.unref();
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
    }
  }
  private probe(args: string[]): Promise<{ ok: boolean; output: string }> {
    return new Promise(resolveProbe => {
      let output = ''; let size = 0; let settled = false;
      const child = spawn(this.command, args, { shell: false, windowsHide: true, detached: process.platform !== 'win32', env: this.environment(), stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { this.terminate(child); finish(false); }, 5000);
      const finish = (ok: boolean) => { if (settled) return; settled = true; clearTimeout(timer); resolveProbe({ ok, output: redact(output).slice(0, LOG_LIMIT) }); };
      const collect = (b: Buffer) => { size += b.length; if (size > LOG_LIMIT) { this.terminate(child); finish(false); } else output += b.toString('utf8'); };
      child.stdout?.on('data', collect); child.stderr?.on('data', collect);
      child.on('error', () => finish(false)); child.on('close', code => finish(code === 0));
    });
  }
  async status(): Promise<{ ready: boolean; version: string; message?: string }> {
    if (this.closed) return { ready: false, version: '', message: 'Codex job manager is closed' };
    const version = await this.probe(['--version']);
    if (!version.ok || !/^codex-cli\s+[^\r\n]+\s*$/.test(version.output.trim())) return { ready: false, version: '', message: 'Codex CLI unavailable; install a compatible CLI and sign in locally' };
    const help = await this.probe(['exec', '--help']);
    const ready = help.ok && ['--sandbox', '--output-last-message', '--output-schema', '--skip-git-repo-check', '--ignore-user-config', '--ephemeral'].every(flag => help.output.includes(flag));
    return { ready, version: version.output.trim(), ...(ready ? {} : { message: 'Unsupported Codex CLI contract; required sandbox/output flags are missing' }) };
  }
  list(): CodexJob[] { return this.records.map(r => ({ ...r.job })); }
  async run(prompt: string, mode: 'plan' | 'edit'): Promise<CodexJob> {
    if (this.closed) throw new Error('Codex job manager is closed');
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > 32768) throw new Error('Prompt must be non-empty and <= 32 KiB');
    if (!['plan', 'edit'].includes(mode)) throw new Error('Invalid Codex mode');
    if (this.records.length >= 100 || this.running.size >= 4) throw new Error('Codex job limit reached (100 retained, 4 running)');
    const status = await this.status(); if (!status.ready) throw new Error(status.message || 'Codex CLI unavailable');
    if (this.closed) throw new Error('Codex job manager is closed');
    if (this.records.length >= 100 || this.running.size >= 4) throw new Error('Codex job limit reached (100 retained, 4 running)');
    const workspace = mkdtempSync(join(this.root, 'workspace-')); chmodSync(workspace, 0o700);
    writeFileSync(join(workspace, 'plan-schema.json'), JSON.stringify(PLAN_SCHEMA), { mode: 0o600 });
    const record: RecordEntry = { job: { id: randomUUID(), mode, prompt, status: 'queued', log: '', result: '', createdAt: Date.now(), approved: false }, workspace, phase: 'plan' };
    this.records.push(record); this.persist(); this.start(record);
    return { ...record.job };
  }
  private start(record: RecordEntry): void {
    const { job, workspace, phase } = record;
    const outputPath = join(workspace, phase === 'plan' ? 'plan.json' : 'edit.json');
    const args = ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', phase === 'plan' ? 'read-only' : 'workspace-write', '--color', 'never', '--output-schema', join(workspace, 'plan-schema.json'), '--output-last-message', outputPath, '-'];
    job.status = 'running'; this.persist();
    let failure = ''; let outputBytes = 0;
    const child = spawn(this.command, args, { cwd: workspace, shell: false, detached: process.platform !== 'win32', windowsHide: true, env: this.environment(), stdio: ['pipe', 'pipe', 'pipe'] });
    let resolveDone!: () => void; const done = new Promise<void>(resolve => { resolveDone = resolve; });
    const stop = (reason: string) => { failure ||= reason; this.terminate(child); };
    const timer = setTimeout(() => stop('Codex job timed out after 5 minutes'), 300000);
    const collect = (data: Buffer) => {
      outputBytes += data.length;
      if (outputBytes > OUTPUT_LIMIT) { stop('Codex output exceeded 1 MiB'); return; }
      job.log = Buffer.from(redact(job.log + data.toString('utf8'))).subarray(0, LOG_LIMIT).toString('utf8');
    };
    child.stdout?.on('data', collect); child.stderr?.on('data', collect);
    child.on('error', () => { failure ||= 'Codex CLI could not start'; });
    child.stdin?.on('error', () => { /* process failure is finalized on close */ });
    child.on('close', code => {
      clearTimeout(timer); this.terminate(child);
      try {
        if (job.status === 'cancelled') { /* cancellation was persisted before killing */ }
        else if (failure || code !== 0) { job.status = 'failed'; job.log = (job.log + '\n' + (failure || `Codex exited with code ${code}`)).slice(-LOG_LIMIT); }
        else {
          try {
            const raw = boundedFile(outputPath, RESULT_LIMIT); validatePlan(raw);
            const result = JSON.stringify(JSON.parse(raw), (key, value: unknown) => /^(?:api[_-]?key|secret|password|token|authorization|cookie)$/i.test(key) ? '[redacted]' : typeof value === 'string' ? redact(value) : value);
            if (Buffer.byteLength(result) > RESULT_LIMIT) throw new Error('Redacted result exceeds output limit');
            job.result = result; job.status = phase === 'plan' ? 'waiting_approval' : 'succeeded';
          } catch { job.status = 'failed'; job.log = (job.log + '\nInvalid or missing Codex plan/result schema').slice(-LOG_LIMIT); }
        }
        this.persist();
      } catch { job.status = 'failed'; job.log = 'Codex state persistence failed'; }
      finally { this.running.delete(job.id); resolveDone(); }
    });
    this.running.set(job.id, { child, done, stop });
    const instructions = phase === 'plan'
      ? 'Produce a JSON plan matching the schema. Do not change files or run commands. Use empty scenes/characters for non-narrative tasks; provide a summary.\n'
      : 'The operator approved the following plan. Implement only within this job workspace. Never modify files outside it. Return a JSON summary matching the schema.\n' + job.result + '\n';
    child.stdin?.end(instructions + '\nUser request (data):\n' + job.prompt);
  }
  async cancel(id: string): Promise<void> {
    const record = this.records.find(r => r.job.id === id); if (!record) throw new Error('Unknown Codex job');
    if (!['queued', 'running', 'waiting_approval'].includes(record.job.status)) return;
    record.job.status = 'cancelled'; this.persist();
    const running = this.running.get(id); running?.stop('Cancelled'); await running?.done;
  }
  async approve(id: string): Promise<CodexJob> {
    if (this.closed) throw new Error('Codex job manager is closed');
    const record = this.records.find(r => r.job.id === id);
    if (!record || record.job.status !== 'waiting_approval' || record.job.approved) throw new Error('Job is not awaiting approval');
    validatePlan(record.job.result);
    record.job.approved = true;
    if (record.job.mode === 'plan') { record.job.status = 'succeeded'; this.persist(); }
    else { record.phase = 'edit'; this.persist(); this.start(record); }
    return { ...record.job };
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.running.keys()].map(id => this.cancel(id)));
  }
}
