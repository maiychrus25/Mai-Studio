import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { UpdateView } from '../shared/studio';
import { redact } from './store';

// Matches build.publish in package.json; electron-updater reads the same repository from app-update.yml.
export const RELEASES_URL = 'https://github.com/maiychrus25/Mai-Studio/releases';
export interface UpdateFile { url: string; sha512: string; size?: number }
export interface UpdateCheck { version: string; files: UpdateFile[]; available: boolean }
export interface UpdateDeps {
  version: string; packaged: boolean; platform: NodeJS.Platform; arch: string; appImage: boolean; downloadDir: string;
  check(allowPrerelease: boolean): Promise<UpdateCheck | null>;
  download(): Promise<unknown>;
  install(): void;
  openPath(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  fetch?: typeof fetch;
  changed(): void;
}

export const allowPrerelease = (version: string): boolean => version.includes('-');

export function pickMacDmg(files: UpdateFile[], arch: string): UpdateFile {
  const file = files.find(item => /^[\w.-]+\.dmg$/.test(item.url) && item.url.endsWith(`-${arch}.dmg`));
  if (!file) throw new Error(`Bản phát hành không có tệp dmg cho ${arch}`);
  return file;
}

export async function downloadVerified(url: string, target: string, file: UpdateFile, onProgress: (percent: number) => void, fetchImpl: typeof fetch = fetch): Promise<void> {
  // shortcut: one overall timeout instead of stall detection; enough for a ~200 MB dmg on a slow line.
  const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(60 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`Tải bản cài thất bại: HTTP ${response.status}`);
  const total = file.size || Number(response.headers.get('content-length')) || 0;
  const hash = createHash('sha512'); const partial = `${target}.part`; let received = 0, reported = -1;
  try {
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), new Transform({ transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk); received += chunk.length;
      const percent = total ? Math.min(100, Math.floor(received / total * 100)) : 0;
      if (percent !== reported) { reported = percent; onProgress(percent); }
      done(null, chunk);
    } }), createWriteStream(partial));
    if (hash.digest('base64') !== file.sha512 || (file.size && received !== file.size)) throw new Error('sha512 của bản cài không khớp latest-mac.yml; đã xóa tệp tải về');
    await rename(partial, target); onProgress(100);
  } finally { await rm(partial, { force: true }); }
}

async function matches(path: string, sha512: string): Promise<boolean> {
  try { return createHash('sha512').update(await readFile(path)).digest('base64') === sha512; } catch { return false; }
}

export class AppUpdates {
  private state: UpdateView;
  private available?: UpdateCheck;
  private dmg?: { path: string; sha512: string };
  constructor(private readonly deps: UpdateDeps) {
    const mode = deps.platform === 'darwin' ? 'dmg' : deps.platform === 'win32' || (deps.platform === 'linux' && deps.appImage) ? 'install' : 'page';
    this.state = deps.packaged ? { status: 'idle', mode, current: deps.version } : { status: 'unsupported', mode, current: deps.version, message: 'Chỉ bản cài mới cập nhật được' };
  }
  view(): UpdateView { return { ...this.state }; }
  private set(patch: Partial<UpdateView>, replace = false): void {
    this.state = replace ? { status: this.state.status, mode: this.state.mode, current: this.state.current, ...patch } : { ...this.state, ...patch };
    this.deps.changed();
  }
  async check(): Promise<UpdateView> {
    if (!this.deps.packaged || ['checking', 'downloading', 'downloaded'].includes(this.state.status)) return this.view();
    this.set({ status: 'checking' }, true);
    try {
      const result = await this.deps.check(allowPrerelease(this.deps.version));
      if (!result) throw new Error('Không đọc được thông tin bản phát hành');
      this.available = result.available ? result : undefined;
      this.set(result.available ? { status: 'available', version: result.version } : { status: 'latest' }, true);
    } catch (error) { this.failed(error); }
    return this.view();
  }
  async install(beforeInstall: () => void): Promise<unknown> {
    if (!this.deps.packaged) throw new Error('Chỉ bản cài mới cập nhật được');
    const info = this.available;
    if (!info) throw new Error('Chưa có bản cập nhật mới; bấm Kiểm tra cập nhật');
    if (this.state.mode === 'page') { await this.deps.openExternal(`${RELEASES_URL}/tag/v${info.version}`); return { opened: true }; }
    if (this.state.status === 'downloading') return { downloading: true };
    if (this.state.mode === 'dmg') {
      if (this.state.status === 'downloaded' && this.dmg && await matches(this.dmg.path, this.dmg.sha512)) { await this.deps.openPath(this.dmg.path); return { opened: true }; }
      this.set({ status: 'downloading', percent: 0, message: undefined });
      void this.downloadDmg(info).catch(error => this.failed(error));
      return { downloading: true };
    }
    if (this.state.status === 'downloaded') { beforeInstall(); this.deps.install(); return { installing: true }; }
    this.set({ status: 'downloading', percent: 0, message: undefined });
    void this.deps.download().catch(error => this.failed(error));
    return { downloading: true };
  }
  private async downloadDmg(info: UpdateCheck): Promise<void> {
    const file = pickMacDmg(info.files, this.deps.arch);
    await mkdir(this.deps.downloadDir, { recursive: true });
    const path = join(this.deps.downloadDir, file.url);
    await downloadVerified(`${RELEASES_URL}/download/v${info.version}/${file.url}`, path, file, percent => this.progress(percent), this.deps.fetch);
    this.dmg = { path, sha512: file.sha512 };
    this.set({ status: 'downloaded', percent: 100 });
    await this.deps.openPath(path);
  }
  progress(percent: number): void {
    const value = Math.floor(percent);
    if (this.state.status === 'downloading' && value !== this.state.percent) this.set({ percent: value });
  }
  downloaded(): void { this.set({ status: 'downloaded', percent: 100, message: undefined }); }
  failed(error: unknown): void {
    const message = redact((error instanceof Error ? error.message : String(error)).split('\n')[0]).slice(0, 300);
    this.set({ status: 'error', message, percent: undefined });
  }
}
