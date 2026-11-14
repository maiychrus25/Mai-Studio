import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { existsSync, createWriteStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Store, publicUrl } from './store';
import { NeedsInputError } from './queue';
import type { Account, Task, TaskContext, TaskResult } from '../shared/studio';

export function browserExecutable(configured = ''): string {
  const paths = [configured, process.env.MAISTUDIO_BROWSER_PATH ?? '',
    ...(process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'] :
      process.platform === 'win32' ? [join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'), join(process.env.LOCALAPPDATA ?? homedir(), 'Google/Chrome/Application/chrome.exe'), join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe')] :
      ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']), chromium.executablePath()];
  const executable = paths.find(value => value && existsSync(value));
  if (!executable) throw new NeedsInputError('Chưa tìm thấy Chrome/Chromium. Chọn đường dẫn trình duyệt trong Cài đặt.');
  return executable;
}
export class BrowserManager {
  private readonly contexts = new Map<string, Promise<BrowserContext>>();
  constructor(private readonly store: Store, private readonly secret: (key: string) => string = () => '') {}
  async open(account: Account): Promise<BrowserContext> {
    let pending = this.contexts.get(account.id);
    if (pending) return pending;
    const settings = this.store.settings();
    const proxy = account.proxyId ? this.store.proxy(account.proxyId) : undefined;
    pending = chromium.launchPersistentContext(join(this.store.root, 'profiles', account.id), {
      executablePath: browserExecutable(settings.browserPath), headless: !settings.browserVisible,
      chromiumSandbox: true, viewport: { width: 1280, height: 900 }, acceptDownloads: true,
      ...(proxy ? { proxy: { server: proxy.server, username: proxy.username, password: this.secret(`proxy.${proxy.id}`) } } : {}),
      args: ['--no-first-run', '--no-default-browser-check'], timeout: 60000,
    }).then(async context => {
      context.on('close', () => { this.contexts.delete(account.id); this.store.accountStatus(account.id, 'closed'); });
      this.store.accountStatus(account.id, 'open');
      const page = context.pages()[0] ?? await context.newPage();
      if (page.url() === 'about:blank') await page.goto(account.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      return context;
    }).catch(error => { this.contexts.delete(account.id); throw new Error(`Không mở được trình duyệt: ${error instanceof Error ? error.message : 'unknown'}`); });
    this.contexts.set(account.id, pending); return pending;
  }
  async close(id: string): Promise<void> { const pending = this.contexts.get(id); if (pending) { const context = await pending; this.contexts.delete(id); await context.close(); } }
  async check(id: string): Promise<{ ready: boolean; message: string }> {
    const context = await this.open(this.store.account(id)); const page = context.pages()[0];
    const ready = !!page && await page.locator(this.store.settings().museSelectors.composer).first().isVisible().catch(() => false);
    this.store.accountStatus(id, ready ? 'ready' : 'needs_login'); return { ready, message: ready ? 'Đã thấy ô nhập prompt' : 'Cần đăng nhập hoặc cập nhật selector' };
  }
  async shutdown(): Promise<void> { await Promise.allSettled([...this.contexts.keys()].map(id => this.close(id))); }
  async generate(task: Task, context: TaskContext): Promise<TaskResult> {
    const account = this.store.account(task.accountId); const browser = await this.open(account); context.signal.throwIfAborted();
    const selectors = this.store.settings().museSelectors;
    const page = browser.pages().find(value => value.url().startsWith(new URL(account.url).origin)) ?? await browser.newPage();
    const checkpoint = { ...task.checkpoint };
    if (checkpoint.threadUrl && typeof checkpoint.threadUrl === 'string') {
      if (new URL(checkpoint.threadUrl).origin !== new URL(account.url).origin) throw new Error('Checkpoint không thuộc tài khoản/provider này');
      if (page.url() !== checkpoint.threadUrl) await page.goto(checkpoint.threadUrl, { waitUntil: 'domcontentloaded' });
    } else if (page.url() === 'about:blank') await page.goto(account.url, { waitUntil: 'domcontentloaded' });
    const before = Array.isArray(checkpoint.beforeUrls) ? checkpoint.beforeUrls as string[] : await this.mediaUrls(page, selectors.response, task.kind);
    if (checkpoint.remoteSubmitted !== true) {
      const composer = page.locator(selectors.composer).first();
      if (!await composer.isVisible().catch(() => false)) throw new NeedsInputError('Cần đăng nhập Muse hoặc cập nhật selector. Mở tài khoản rồi tiếp tục task.');
      if (Array.isArray(task.input.refIds) && task.input.refIds.length) {
        const files = task.input.refIds.map(value => this.store.assetPath(String(value)));
        await page.locator(selectors.fileInput).first().setInputFiles(files, { timeout: 15000 });
      }
      const ratio = typeof task.input.ratio === 'string' ? task.input.ratio : '16:9';
      const prompt = `${task.kind === 'image' ? 'Create an image' : 'Create a video'} with aspect ratio ${ratio}.\n\n${task.prompt}`;
      await composer.fill(prompt, { timeout: 15000 }); context.signal.throwIfAborted();
      const submit = page.locator(selectors.submit).first(); await submit.waitFor({ state: 'visible', timeout: 15000 });
      context.checkpoint({ remoteSubmitted: true, beforeUrls: before, submittedAt: Date.now() });
      await submit.click({ timeout: 15000 });
      context.checkpoint({ threadUrl: page.url() });
    }
    const requested = typeof task.input.timeoutMs === 'number' ? task.input.timeoutMs : task.kind === 'image' ? 180000 : 900000;
    const timeout = Math.max(1000, Math.min(requested, 1800000)); const started = Date.now();
    try {
      while (Date.now() - started < timeout) {
        context.signal.throwIfAborted();
        const urls = (await this.mediaUrls(page, selectors.response, task.kind)).filter(url => !before.includes(url));
        if (urls.length) {
          context.checkpoint({ threadUrl: page.url(), downloadUrl: urls[0] });
          const ids: string[] = [];
          for (const url of urls.slice(0, Number(task.input.count) || 1)) {
            const path = await this.download(page, url, task, context.signal);
            try { ids.push((await this.store.importAsset(path, { taskId: task.id, projectId: task.projectId }, context.signal)).id); }
            finally { await rm(path, { force: true }); }
          }
          this.store.accountStatus(account.id, 'ready'); return { outputIds: ids };
        }
        context.progress(Math.min(0.9, 0.05 + (Date.now() - started) / timeout * 0.8), 'Đang chờ kết quả từ Muse');
        await delay(500, undefined, { signal: context.signal });
      }
      throw new NeedsInputError('Chưa nhận được media trong thời gian chờ. Kiểm tra thread và tiếp tục để tránh gửi trùng.');
    } finally {
      if (context.signal.aborted && selectors.stop) await page.locator(selectors.stop).first().click({ timeout: 1500 }).catch(() => {});
    }
  }
  private async mediaUrls(page: Page, selector: string, kind: string): Promise<string[]> {
    const responses = page.locator(selector);
    const count = await responses.count(); if (!count) return [];
    return responses.last().locator(kind === 'image' ? 'img' : 'video, video source, a[href]').evaluateAll(elements => elements.map(element => {
      if (element instanceof HTMLImageElement) return element.currentSrc || element.src;
      if (element instanceof HTMLVideoElement) return element.currentSrc || element.src;
      if (element instanceof HTMLSourceElement) return element.src;
      if (element instanceof HTMLAnchorElement) return /\.(mp4|webm)(?:[?#]|$)/i.test(element.href) ? element.href : '';
      return '';
    }).filter(Boolean));
  }
  private async download(page: Page, source: string, task: Task, signal: AbortSignal): Promise<string> {
    const folder = join(this.store.root, 'work', task.id); await mkdir(folder, { recursive: true, mode: 0o700 });
    const output = join(folder, task.kind === 'image' ? 'result.png' : 'result.mp4');
    if (source.startsWith('blob:') || source.startsWith('data:')) {
      const encoded = await page.evaluate(async url => {
        const response = await fetch(url); const blob = await response.blob();
        if (blob.size > 256 * 1024 * 1024) throw new Error('Media vượt 256 MiB');
        return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Không đọc được blob')); reader.readAsDataURL(blob); });
      }, source);
      signal.throwIfAborted(); await writeFile(output, Buffer.from(encoded.slice(encoded.indexOf(',') + 1), 'base64'), { mode: 0o600 }); return output;
    }
    const url = new URL(publicUrl(source, true)); const origin = new URL(page.url());
    if (url.protocol === 'http:' && url.origin !== origin.origin) throw new Error('Không tải media từ loopback khác provider');
    const cookies = await page.context().cookies(url.href);
    const response = await fetch(url, { headers: cookies.length ? { Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ') } : {}, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(600000)]) });
    if (!response.ok || !response.body) throw new Error(`Tải media thất bại HTTP ${response.status}`);
    const max = 256 * 1024 * 1024; let bytes = 0;
    const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; callback(bytes > max ? new Error('Media vượt 256 MiB') : null, chunk); } });
    try { await pipeline(Readable.fromWeb(response.body as never), limit, createWriteStream(output, { mode: 0o600 }), { signal }); }
    catch (error) { await rm(output, { force: true }); throw error; }
    return output;
  }
}
