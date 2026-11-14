import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, existsSync, lstatSync, openSync, readSync, closeSync, unlinkSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { basename, extname, join, resolve } from 'node:path';
import type { Account, Asset, LogEntry, Project, ProjectKind, Proxy, Settings, Task, TaskKind } from '../shared/studio';

export const MAX_BATCH = 1000;
export const MAX_PROMPT_BYTES = 32768;
export const MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024;
const TABLES = ['projects', 'tasks', 'accounts', 'proxies', 'assets', 'settings'] as const;
type Table = typeof TABLES[number];
const KINDS: ProjectKind[] = ['studio', 'srt', 'film', 'series', 'affiliate', 'dub'];
const TASK_KINDS: TaskKind[] = ['image', 'video', 'image-to-video', 'merge', 'slideshow', 'dub', 'speech', 'pipeline'];
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Dữ liệu phải là object');
  return value as Record<string, unknown>;
}
export function text(value: unknown, field: string, max = 200, optional = false): string {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || Buffer.byteLength(value) > max || value.includes('\0')) throw new Error(`${field} không hợp lệ (tối đa ${max} bytes)`);
  return value.trim();
}
export function publicUrl(value: unknown, allowLoopback = false): string {
  const url = new URL(text(value, 'URL', 2048));
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(allowLoopback && local && url.protocol === 'http:'))) throw new Error('URL phải dùng HTTPS, không chứa mật khẩu');
  return url.href;
}
export function redact(value: string): string {
  return value.replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]').replace(/([?&](?:key|token|secret|password|session)=)[^&\s]+/gi, '$1[redacted]').replace(/((?:api[_-]?key|password|secret|token)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]').slice(0, 4000);
}
function encoded(value: unknown): string {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > 1024 * 1024) throw new Error('Dữ liệu vượt giới hạn 1 MiB');
  return json;
}
function defaultSettings(root: string): Settings {
  return {
    theme: 'system', language: 'vi', generationConcurrency: 2, mediaConcurrency: 1, outputDir: join(root, 'output'),
    browserPath: '', ffmpegPath: '', ffprobePath: '', browserVisible: true,
    providers: Object.fromEntries(['image', 'video', 'text', 'voice', 'asr', 'market', 'shopee', 'license'].map(key => [key, { baseUrl: '', model: '', hasKey: false }])),
    museSelectors: {
      composer: '[data-hatch-composer-root] [contenteditable="true"]', submit: '[data-hatch-composer-action-slot] button',
      response: '[data-message-item][data-message-role="assistant"]', fileInput: '[data-hatch-composer-root] input[type="file"]',
      stop: '[data-testid="hatch-composer-stop-button"]',
    },
  };
}
export class Store {
  readonly root: string;
  private readonly db: DatabaseSync;
  constructor(root: string) {
    this.root = resolve(root); mkdirSync(this.root, { recursive: true, mode: 0o700 });
    for (const folder of ['assets', 'profiles', 'output', 'work']) mkdirSync(join(this.root, folder), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(this.root, 'studio.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;');
    const version = Number(this.db.prepare('PRAGMA user_version').get()!['user_version']);
    if (version > 1) { this.db.close(); throw new Error('Database được tạo bởi phiên bản MaiStudio mới hơn'); }
    for (const table of TABLES) this.db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)))`);
    this.db.exec('CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, task_id TEXT NOT NULL); CREATE INDEX IF NOT EXISTS tasks_status ON tasks(json_extract(data,\'$.status\')); PRAGMA user_version=1;');
    if (!this.get<Settings>('settings', 'app')) this.put('settings', 'app', defaultSettings(this.root));
  }
  close(): void { this.db.close(); }
  private all<T>(table: Table): T[] { return (this.db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all() as { data: string }[]).map(row => JSON.parse(row.data) as T); }
  private get<T>(table: Table, id: string): T | undefined { const row = this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id) as { data: string } | undefined; return row ? JSON.parse(row.data) as T : undefined; }
  private put(table: Table, id: string, value: unknown): void { this.db.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(id, encoded(value)); }
  private remove(table: Table, id: string): void { this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id); }
  transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  projects(): Project[] { return this.all<Project>('projects').sort((a, b) => b.updatedAt - a.updatedAt); }
  project(id: string): Project { const value = this.get<Project>('projects', id); if (!value) throw new Error('Không tìm thấy dự án'); return value; }
  saveProject(input: { id?: string; name: string; kind?: ProjectKind; data?: Record<string, unknown> }): Project {
    const previous = input.id ? this.project(text(input.id, 'Project ID', 100)) : undefined;
    const kind = input.kind ?? previous?.kind ?? 'studio'; if (!KINDS.includes(kind)) throw new Error('Loại dự án không hợp lệ');
    const value: Project = { id: previous?.id ?? randomUUID(), name: text(input.name, 'Tên dự án'), kind, createdAt: previous?.createdAt ?? Date.now(), updatedAt: Date.now(), data: input.data ? object(input.data) : previous?.data ?? {} };
    this.put('projects', value.id, value); return value;
  }
  deleteProject(id: string): void {
    this.project(id);
    const tasks = this.tasks().filter(task => task.projectId === id);
    if (tasks.some(task => ['running', 'queued'].includes(task.status))) throw new Error('Dự án đang có công việc đang chạy hoặc chờ');
    this.transaction(() => { for (const task of tasks) this.remove('tasks', task.id); this.remove('projects', id); });
  }
  tasks(): Task[] { return this.all<Task>('tasks').sort((a, b) => a.position - b.position || a.createdAt - b.createdAt); }
  task(id: string): Task { const value = this.get<Task>('tasks', id); if (!value) throw new Error('Không tìm thấy task'); return value; }
  createTasks(input: { projectId: string; prompts: string | string[]; kind: TaskKind; accountId?: string; name?: string; input?: Record<string, unknown> }): Task[] {
    this.project(input.projectId); if (!TASK_KINDS.includes(input.kind)) throw new Error('Loại task không hợp lệ');
    const prompts = typeof input.prompts === 'string' ? input.prompts.split(/\r?\n/).filter(value => value.trim()) : input.prompts;
    if (!Array.isArray(prompts) || !prompts.length || prompts.length > MAX_BATCH) throw new Error(`Batch cần 1–${MAX_BATCH} prompt`);
    const data = input.input ? object(input.input) : {};
    const count = data.count === undefined ? 1 : data.count;
    if (data.retryLimit !== undefined && (typeof data.retryLimit !== 'number' || !Number.isInteger(data.retryLimit) || data.retryLimit < 0 || data.retryLimit > 2)) throw new Error('Retry limit phải từ 0–2');
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 16 || prompts.length * count > MAX_BATCH) throw new Error('Count/số lượng phải từ 1–16, tổng batch không quá 1000');
    const normalized = prompts.flatMap(value => Array.from({ length: count }, () => text(value, 'Prompt', MAX_PROMPT_BYTES)));
    if (data.refIds && (!Array.isArray(data.refIds) || data.refIds.length > 16 || data.refIds.some(id => typeof id !== 'string'))) throw new Error('Tối đa 16 ảnh tham chiếu');
    const accountId = input.accountId ? this.account(input.accountId).id : '';
    const start = Math.max(-1, ...this.tasks().map(task => task.position)) + 1;
    return this.transaction(() => normalized.map((prompt, index) => {
      const task: Task = { id: randomUUID(), projectId: input.projectId, kind: input.kind, prompt, name: input.name ? text(input.name, 'Tên task') : `${index + 1}. ${prompt.slice(0, 50)}`, accountId,
        position: start + index, progress: 0, status: 'draft', message: '', error: '', attempts: 0, createdAt: Date.now(), updatedAt: Date.now(), input: structuredClone({ ...data, count: 1 }), checkpoint: {}, outputIds: [] };
      this.put('tasks', task.id, task); return task;
    }));
  }
  updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>): Task {
    const value = { ...this.task(id), ...patch, id, updatedAt: Date.now() };
    if (patch.prompt !== undefined) value.prompt = text(patch.prompt, 'Prompt', MAX_PROMPT_BYTES);
    if (patch.name !== undefined) value.name = text(patch.name, 'Tên task');
    if (!Number.isFinite(value.progress) || value.progress < 0 || value.progress > 1) throw new Error('Tiến độ không hợp lệ');
    this.put('tasks', id, value); return value;
  }
  deleteTask(id: string): void { const task = this.task(id); if (task.status === 'running') throw new Error('Task đang chạy'); this.remove('tasks', id); }
  reorder(ids: string[]): void {
    if (ids.length !== new Set(ids).size || ids.some(id => !this.get('tasks', id))) throw new Error('Thứ tự task không hợp lệ');
    const rest = this.tasks().filter(task => !ids.includes(task.id)).map(task => task.id);
    this.transaction(() => [...ids, ...rest].forEach((id, position) => this.updateTask(id, { position })));
  }
  accounts(): Account[] { return this.all<Account>('accounts'); }
  account(id: string): Account { const value = this.get<Account>('accounts', id); if (!value) throw new Error('Không tìm thấy tài khoản'); return value; }
  saveAccount(input: { id?: string; name: string; url?: string; proxyId?: string }): Account {
    const previous = input.id ? this.account(input.id) : undefined;
    if (input.proxyId) this.proxy(input.proxyId);
    const value: Account = { id: previous?.id ?? randomUUID(), name: text(input.name, 'Tên tài khoản'), url: publicUrl(input.url || previous?.url || 'https://muse.ai/', true), proxyId: input.proxyId ?? previous?.proxyId ?? '', status: previous?.status ?? 'needs_login', createdAt: previous?.createdAt ?? Date.now() };
    this.put('accounts', value.id, value); return value;
  }
  accountStatus(id: string, status: string): void { this.put('accounts', id, { ...this.account(id), status }); }
  deleteAccount(id: string): void {
    this.account(id); if (this.tasks().some(task => task.accountId === id && ['running', 'queued'].includes(task.status))) throw new Error('Tài khoản đang được dùng bởi hàng đợi');
    this.remove('accounts', id);
  }
  proxies(): Proxy[] { return this.all<Proxy>('proxies'); }
  proxy(id: string): Proxy { const value = this.get<Proxy>('proxies', id); if (!value) throw new Error('Không tìm thấy proxy'); return value; }
  saveProxy(input: { id?: string; name: string; server: string; username?: string; hasPassword?: boolean }): Proxy {
    const server = new URL(text(input.server, 'Proxy server', 2048));
    if (!['http:', 'https:', 'socks5:'].includes(server.protocol) || server.username || server.password || server.pathname !== '/' || server.search || server.hash) throw new Error('Proxy cần http(s) hoặc socks5, không nhúng mật khẩu trong URL');
    const previous = input.id ? this.proxy(input.id) : undefined;
    const value: Proxy = { id: previous?.id ?? randomUUID(), name: text(input.name, 'Tên proxy'), server: server.origin === 'null' ? `${server.protocol}//${server.host}` : server.origin,
      username: text(input.username ?? previous?.username ?? '', 'Proxy username', 200, true), hasPassword: input.hasPassword ?? previous?.hasPassword ?? false };
    this.put('proxies', value.id, value); return value;
  }
  deleteProxy(id: string): void { this.proxy(id); if (this.accounts().some(account => account.proxyId === id)) throw new Error('Proxy còn đang gắn với tài khoản'); this.remove('proxies', id); }
  settings(): Settings { return this.get<Settings>('settings', 'app')!; }
  queuePaused(): boolean { return this.get<{ paused: boolean }>('settings', 'queue')?.paused === true; }
  setQueuePaused(paused: boolean): void { this.put('settings', 'queue', { paused }); }
  setSettings(patch: Partial<Settings>): Settings {
    const current = this.settings(); const next = { ...current, ...patch };
    if (Object.keys(patch).some(key => !Object.hasOwn(current, key))) throw new Error('Settings key không hợp lệ');
    if (!['light', 'dark', 'system'].includes(next.theme) || !['vi', 'en'].includes(next.language)) throw new Error('Theme/ngôn ngữ không hợp lệ');
    if (!Number.isInteger(next.generationConcurrency) || next.generationConcurrency < 1 || next.generationConcurrency > 8 || !Number.isInteger(next.mediaConcurrency) || next.mediaConcurrency < 1 || next.mediaConcurrency > 2) throw new Error('Concurrency không hợp lệ');
    if (typeof next.browserVisible !== 'boolean') throw new Error('Browser visibility không hợp lệ');
    for (const key of ['outputDir', 'browserPath', 'ffmpegPath', 'ffprobePath'] as const) if (typeof next[key] !== 'string' || next[key].includes('\0')) throw new Error('Đường dẫn không hợp lệ');
    if (patch.providers) {
      next.providers = { ...current.providers };
      for (const [key, raw] of Object.entries(object(patch.providers))) {
        if (!Object.hasOwn(current.providers, key)) throw new Error('Provider không hợp lệ');
        const item = object(raw); const baseUrl = text(item.baseUrl ?? '', 'Provider URL', 2048, true);
        next.providers[key] = { baseUrl: baseUrl ? publicUrl(baseUrl, true).replace(/\/$/, '') : '', model: text(item.model ?? '', 'Model', 200, true), hasKey: current.providers[key].hasKey };
      }
    }
    if (patch.museSelectors) { next.museSelectors = {}; for (const [key, value] of Object.entries(object(patch.museSelectors))) next.museSelectors[text(key, 'Selector key', 80)] = text(value, 'CSS selector', 2000); }
    this.put('settings', 'app', next); return next;
  }
  assets(): Asset[] { return this.all<Asset & { path: string }>('assets').map(({ path: _path, ...asset }) => asset); }
  asset(id: string): Asset { const value = this.assets().find(asset => asset.id === id); if (!value) throw new Error('Không tìm thấy asset/tệp'); return value; }
  assetPath(id: string): string {
    const row = this.get<Asset & { path: string }>('assets', id); if (!row || !existsSync(row.path) || lstatSync(row.path).isSymbolicLink() || !lstatSync(row.path).isFile()) throw new Error('Không tìm thấy asset/tệp');
    return row.path;
  }
  async importAsset(source: string, metadata: { projectId?: string; taskId?: string; duration?: number } = {}, signal?: AbortSignal): Promise<Asset> {
    signal?.throwIfAborted(); const stat = lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_ASSET_BYTES) throw new Error('Tệp media không hợp lệ hoặc vượt 2 GiB');
    const header = Buffer.alloc(64); const fd = openSync(source, 'r'); try { readSync(fd, header, 0, 64, 0); } finally { closeSync(fd); }
    const ext = extname(source).toLowerCase(); const magic = header.toString('hex'); let mime = '';
    if (magic.startsWith('89504e470d0a1a0a')) mime = 'image/png';
    else if (magic.startsWith('ffd8ff')) mime = 'image/jpeg';
    else if (header.toString('ascii', 0, 4) === 'RIFF') mime = header.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : header.toString('ascii', 8, 12) === 'WAVE' ? 'audio/wav' : '';
    else if (header.toString('ascii', 4, 8) === 'ftyp') mime = ext === '.m4a' ? 'audio/mp4' : 'video/mp4';
    else if (header.toString('ascii', 0, 3) === 'ID3' || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)) mime = 'audio/mpeg';
    else if (magic.startsWith('1a45dfa3')) mime = ext === '.webm' ? 'video/webm' : 'video/x-matroska';
    else if (header.toString('ascii', 0, 4) === 'OggS') mime = 'audio/ogg';
    else if (ext === '.srt' || ext === '.txt') mime = 'text/plain';
    if (!mime) throw new Error('Định dạng tệp media chưa được hỗ trợ');
    const suffix: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'audio/wav': '.wav', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/x-matroska': '.mkv', 'text/plain': ext };
    const id = randomUUID(); const path = join(this.root, 'assets', id + suffix[mime]); const part = `${path}.part`;
    try { await pipeline(createReadStream(source), createWriteStream(part, { flags: 'wx', mode: 0o600 }), { signal }); signal?.throwIfAborted(); await rename(part, path); }
    catch (error) { await rm(part, { force: true }); throw error; }
    const asset: Asset = { id, projectId: metadata.projectId ?? '', taskId: metadata.taskId ?? '', name: basename(source), mime, size: stat.size, createdAt: Date.now(), ...(metadata.duration === undefined ? {} : { duration: metadata.duration }) };
    try { this.put('assets', id, { ...asset, path }); } catch (error) { await rm(path, { force: true }); throw error; }
    return asset;
  }
  deleteAsset(id: string): void {
    const path = this.assetPath(id);
    if (this.tasks().some(task => ['running', 'queued'].includes(task.status) && JSON.stringify(task.input).includes(id))) throw new Error('Tệp đang được công việc sử dụng');
    unlinkSync(path); this.remove('assets', id);
  }
  log(message: string, level = 'info', taskId = ''): void {
    this.db.prepare('INSERT INTO logs(at,level,message,task_id) VALUES(?,?,?,?)').run(Date.now(), level, redact(message), taskId);
    this.db.exec('DELETE FROM logs WHERE id < (SELECT MAX(id)-2000 FROM logs)');
  }
  logs(): LogEntry[] { return (this.db.prepare('SELECT id,at,level,message,task_id AS taskId FROM logs ORDER BY id DESC LIMIT 500').all() as unknown as LogEntry[]).reverse(); }
}
