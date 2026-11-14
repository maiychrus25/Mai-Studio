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
  async open(account: Account, signal?: AbortSignal): Promise<BrowserContext> {
    signal?.throwIfAborted();
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
      let closing: Promise<void> | undefined;
      const abort = () => { closing ??= context.close().catch(() => {}); };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        signal?.throwIfAborted(); this.store.accountStatus(account.id, 'open');
        const page = context.pages()[0] ?? await context.newPage();
        if (page.url() === 'about:blank') await page.goto(account.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        signal?.throwIfAborted(); return context;
      } catch (error) { abort(); await closing; throw error; }
      finally { signal?.removeEventListener('abort', abort); }
    }).catch(error => { this.contexts.delete(account.id); signal?.throwIfAborted(); throw new Error(`Không mở được trình duyệt: ${error instanceof Error ? error.message : 'unknown'}`); });
    this.contexts.set(account.id, pending); return pending;
  }
  async close(id: string): Promise<void> { const pending = this.contexts.get(id); if (pending) { const context = await pending; this.contexts.delete(id); await context.close(); } }
  async check(id: string): Promise<{ ready: boolean; message: string }> {
    const context = await this.open(this.store.account(id)); const page = context.pages()[0];
    const ready = !!page && await page.locator(this.store.settings().museSelectors.composer).first().isVisible().catch(() => false);
    this.store.accountStatus(id, ready ? 'ready' : 'needs_login'); return { ready, message: ready ? 'Đã thấy ô nhập prompt' : 'Cần đăng nhập hoặc cập nhật selector' };
  }
  async shutdown(): Promise<void> { await Promise.allSettled([...this.contexts.keys()].map(id => this.close(id))); }
  async completeText(task: Task, context: TaskContext): Promise<string> {
    context.signal.throwIfAborted();
    const account = this.store.account(task.accountId); const selectors = this.store.settings().museSelectors;
    const checkpoint = { ...task.checkpoint }; const maxBytes = 512 * 1024;
    const saveCheckpoint = (value: Record<string, unknown>) => {
      const next = { ...checkpoint, ...value };
      // Store caps the entire task JSON at 1 MiB; leave room for queue status/error updates.
      if (Buffer.byteLength(JSON.stringify({ ...task, checkpoint: next })) > 1024 * 1024 - 16384) throw new NeedsInputError('Checkpoint vượt ngân sách task 1 MiB; kiểm tra thread trước khi tiếp tục.');
      context.checkpoint(value); Object.assign(checkpoint, value);
    };
    let threadUrl = typeof checkpoint.threadUrl === 'string' ? checkpoint.threadUrl : '';
    if (threadUrl && URL.parse(threadUrl)?.origin !== new URL(account.url).origin) throw new NeedsInputError('Checkpoint không thuộc tài khoản/provider này');
    if (checkpoint.remoteSubmitted === true) {
      if (!threadUrl || !Number.isSafeInteger(checkpoint.beforeReplyCount) || Number(checkpoint.beforeReplyCount) < 0) {
        throw new NeedsInputError('Chưa xác định remote đã nhận việc. Kiểm tra thread trước khi tiếp tục; không tự gửi lại.');
      }
      if (typeof checkpoint.textResult === 'string' && checkpoint.textResult.trim()) {
        if (Buffer.byteLength(checkpoint.textResult) > maxBytes) throw new NeedsInputError('Text reply vượt 512 KiB');
        return checkpoint.textResult;
      }
    }
    if (!selectors.composer || !selectors.submit || !selectors.response || !selectors.stop) throw new NeedsInputError('Thiếu selector composer/submit/response/stop để xác định reply hoàn tất.');
    const files = checkpoint.remoteSubmitted === true ? [] : this.referencePaths(task);
    const browser = await this.open(account, context.signal); context.signal.throwIfAborted();
    const page = browser.pages().find(value => threadUrl ? value.url() === threadUrl : new URL(value.url()).origin === new URL(account.url).origin) ?? await browser.newPage();
    let stopping: Promise<void> | undefined;
    const stop = () => {
      stopping ??= (async () => {
        try { if (await page.locator(selectors.stop).first().isVisible()) await page.locator(selectors.stop).first().click({ timeout: 1500 }); }
        catch { /* Closing the task page also terminates pending browser requests. */ }
        finally { await page.close().catch(() => {}); }
      })();
    };
    context.signal.addEventListener('abort', stop, { once: true });
    if (context.signal.aborted) stop();
    const requested = typeof task.input.timeoutMs === 'number' && Number.isFinite(task.input.timeoutMs) ? task.input.timeoutMs : 180000;
    const timeout = Math.max(1000, Math.min(requested, 1800000)); const started = Date.now();
    try {
      context.signal.throwIfAborted();
      if (page.url() !== (threadUrl || account.url)) await page.goto(threadUrl || account.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const composer = page.locator(selectors.composer).first(); const submit = page.locator(selectors.submit).first();
      if (!await composer.isVisible() || !await submit.isVisible()) throw new NeedsInputError('Cần đăng nhập Muse hoặc cập nhật selector trước khi tiếp tục.');
      let before = Number(checkpoint.beforeReplyCount);
      if (checkpoint.remoteSubmitted !== true) {
        if (await page.locator(selectors.stop).first().isVisible()) throw new NeedsInputError('Thread đang có yêu cầu khác; chờ hoàn tất trước khi gửi kế hoạch.');
        if (files.length) await this.attachReferences(page, files, selectors.fileInput, context.signal);
        await composer.fill(task.prompt, { timeout: 15000 });
        await submit.waitFor({ state: 'visible', timeout: 15000 });
        // Capture the assistant count immediately before admission, as MuseStudio _ask does.
        before = await page.locator(selectors.response).count(); context.signal.throwIfAborted();
        saveCheckpoint({ remoteSubmitted: true, beforeReplyCount: before, submittedAt: Date.now() });
        await submit.click({ timeout: 15000 }); context.signal.throwIfAborted();
        threadUrl = page.url(); saveCheckpoint({ threadUrl });
      }
      // shortcut: require an observed Stop-to-idle cycle; extend only with verified provider completion markers.
      let last = ''; let stableSince = Date.now(); let busySeen = false; let completed = checkpoint.textCompleted === true;
      while (Date.now() - started < timeout) {
        context.signal.throwIfAborted();
        if (page.url() !== threadUrl) {
          if (new URL(page.url()).origin !== new URL(account.url).origin) throw new NeedsInputError('Provider chuyển sang trang khác; cần kiểm tra đăng nhập/thread.');
          threadUrl = page.url(); saveCheckpoint({ threadUrl });
        }
        if (await page.locator(selectors.errorNotice || '[data-testid="assistant-response-error-notice"]').first().isVisible()) throw new NeedsInputError('Muse báo lỗi trong reply; kiểm tra thread, không tự gửi lại.');
        const reply = await page.locator(selectors.response).evaluateAll((elements, limit) => {
          const text = (elements.at(-1) as HTMLElement | undefined)?.innerText?.trim() ?? '';
          return { count: elements.length, text: text.slice(0, limit + 1) };
        }, maxBytes);
        if (reply.count > before && Buffer.byteLength(reply.text) > maxBytes) throw new NeedsInputError('Text reply vượt 512 KiB');
        const busy = await page.locator(selectors.stop).first().isVisible();
        if (busy && !busySeen) { busySeen = true; saveCheckpoint({ textBusy: true }); }
        const ready = await composer.isVisible();
        if (reply.count > before && reply.text && busySeen && !busy && ready && !completed) { completed = true; saveCheckpoint({ textCompleted: true }); }
        if (reply.count > before && reply.text && completed && !busy && ready) {
          if (reply.text !== last) { last = reply.text; stableSince = Date.now(); }
          else if (Date.now() - stableSince >= 1000) {
            context.signal.throwIfAborted(); saveCheckpoint({ threadUrl, textResult: reply.text });
            this.store.accountStatus(account.id, 'ready'); return reply.text;
          }
        } else { last = ''; stableSince = Date.now(); }
        context.progress(Math.min(0.9, (Date.now() - started) / timeout), 'Đang chờ reply chữ hoàn tất từ Muse');
        await delay(100, undefined, { signal: context.signal });
      }
      throw new NeedsInputError('Chưa có reply chữ mới hoàn tất. Kiểm tra thread rồi tiếp tục để tránh gửi trùng.');
    } catch (error) {
      context.signal.throwIfAborted();
      if (error instanceof NeedsInputError) throw error;
      throw new NeedsInputError('Không xác định được trạng thái DOM/submit của Muse. Kiểm tra thread và selector trước khi tiếp tục.');
    } finally {
      context.signal.removeEventListener('abort', stop);
      if (context.signal.aborted) { stop(); await stopping; }
    }
  }
  private referencePaths(task: Task): string[] {
    if (task.input.refIds === undefined) return [];
    if (!Array.isArray(task.input.refIds) || task.input.refIds.length > 16) throw new Error('Tối đa 16 ảnh tham chiếu');
    return task.input.refIds.map(id => {
      if (typeof id !== 'string') throw new Error('Asset ID không hợp lệ');
      const asset = this.store.asset(id);
      if (!asset.mime.startsWith('image/') || asset.size > 20 * 1024 * 1024) throw new Error('Ảnh tham chiếu phải là image asset tối đa 20 MiB');
      return this.store.assetPath(id);
    });
  }
  private async attachReferences(page: Page, files: string[], selector: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (!selector || !await page.locator(selector).count()) throw new NeedsInputError('Thiếu file input để đính kèm ảnh tham chiếu.');
    await page.locator(selector).first().setInputFiles(files, { timeout: 15000 });
    // FilmStudio._ask_files gives Muse two seconds to process attached images before send.
    await delay(2000, undefined, { signal });
  }
  async generate(task: Task, context: TaskContext): Promise<TaskResult> {
    const account = this.store.account(task.accountId); const browser = await this.open(account, context.signal); context.signal.throwIfAborted();
    const selectors = this.store.settings().museSelectors;
    const page = browser.pages().find(value => new URL(value.url()).origin === new URL(account.url).origin) ?? await browser.newPage();
    const checkpoint = { ...task.checkpoint };
    if (checkpoint.threadUrl && typeof checkpoint.threadUrl === 'string') {
      if (new URL(checkpoint.threadUrl).origin !== new URL(account.url).origin) throw new Error('Checkpoint không thuộc tài khoản/provider này');
      if (page.url() !== checkpoint.threadUrl) await page.goto(checkpoint.threadUrl, { waitUntil: 'domcontentloaded' });
    } else if (page.url() === 'about:blank') await page.goto(account.url, { waitUntil: 'domcontentloaded' });
    const before = Array.isArray(checkpoint.beforeUrls) ? checkpoint.beforeUrls as string[] : await this.mediaUrls(page, selectors.response, task.kind);
    if (checkpoint.remoteSubmitted !== true) {
      const composer = page.locator(selectors.composer).first();
      if (!await composer.isVisible().catch(() => false)) throw new NeedsInputError('Cần đăng nhập Muse hoặc cập nhật selector. Mở tài khoản rồi tiếp tục task.');
      const files = this.referencePaths(task);
      if (files.length) await this.attachReferences(page, files, selectors.fileInput, context.signal);
      const ratio = typeof task.input.ratio === 'string' ? task.input.ratio : '16:9';
      // config.pyc DEFAULT_TEMPLATES uses distinct templates for image/video with references.
      const prompt = task.kind === 'music' ? task.prompt : task.kind === 'image'
        ? `Create ${Number(task.input.count) || 1} image(s) with aspect ratio ${ratio}${files.length ? ', using the attached image(s) as reference (keep the subject, face and style). Do not ask follow-up questions, just generate.' : '. Do not ask follow-up questions, just generate the image(s) directly.'}\n\n${task.prompt}`
        : `Create a video with aspect ratio ${ratio}${files.length ? ' from the attached image (image-to-video)' : ''}. Do not ask follow-up questions, just generate the video directly.\n\n${task.prompt}`;
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
        if (await page.locator(selectors.errorNotice || '[data-testid="assistant-response-error-notice"]').first().isVisible()) throw new NeedsInputError('Muse báo lỗi trong reply; kiểm tra thread trước khi tiếp tục.');
        const busy = !!selectors.stop && await page.locator(selectors.stop).first().isVisible();
        const urls = (await this.mediaUrls(page, selectors.response, task.kind)).filter(url => !before.includes(url));
        if (urls.length && !busy) {
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
    return responses.last().locator(kind === 'image' ? 'img' : kind === 'music' ? 'audio, audio source, a[href]' : 'video, video source, a[href]').evaluateAll((elements, music) => elements.map(element => {
      if (element instanceof HTMLImageElement) return element.currentSrc || element.src;
      if (element instanceof HTMLVideoElement || element instanceof HTMLAudioElement) return element.currentSrc || element.src;
      if (element instanceof HTMLSourceElement) return element.src;
      if (element instanceof HTMLAnchorElement) return (music ? /\.(mp3|wav|m4a|ogg)(?:[?#]|$)/i : /\.(mp4|webm)(?:[?#]|$)/i).test(element.href) ? element.href : '';
      return '';
    }).filter(Boolean), kind === 'music');
  }
  private async download(page: Page, source: string, task: Task, signal: AbortSignal): Promise<string> {
    const folder = join(this.store.root, 'work', task.id); await mkdir(folder, { recursive: true, mode: 0o700 });
    const music = task.kind === 'music';
    let output = join(folder, task.kind === 'image' ? 'result.png' : music ? `result.${/\.(mp3|wav|m4a|ogg)(?:[?#]|$)/i.exec(source)?.[1].toLowerCase() ?? 'mp3'}` : 'result.mp4');
    const setAudioExtension = (type: string) => {
      const extension = ({ 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'application/ogg': 'ogg' } as Record<string, string>)[type.split(';')[0].trim().toLowerCase()];
      if (music && extension) output = join(folder, `result.${extension}`);
    };
    if (source.startsWith('blob:') || source.startsWith('data:')) {
      const encoded = await page.evaluate(async url => {
        const response = await fetch(url); const blob = await response.blob();
        if (blob.size > 256 * 1024 * 1024) throw new Error('Media vượt 256 MiB');
        return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Không đọc được blob')); reader.readAsDataURL(blob); });
      }, source);
      setAudioExtension(encoded.slice(5, encoded.indexOf(';')));
      signal.throwIfAborted(); await writeFile(output, Buffer.from(encoded.slice(encoded.indexOf(',') + 1), 'base64'), { mode: 0o600 }); return output;
    }
    const url = new URL(publicUrl(source, true)); const origin = new URL(page.url());
    if (url.protocol === 'http:' && url.origin !== origin.origin) throw new Error('Không tải media từ loopback khác provider');
    const cookies = await page.context().cookies(url.href);
    const response = await fetch(url, { headers: cookies.length ? { Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ') } : {}, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(600000)]) });
    if (!response.ok || !response.body) throw new Error(`Tải media thất bại HTTP ${response.status}`);
    setAudioExtension(response.headers.get('content-type') ?? '');
    const max = 256 * 1024 * 1024; let bytes = 0;
    const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; callback(bytes > max ? new Error('Media vượt 256 MiB') : null, chunk); } });
    try { await pipeline(Readable.fromWeb(response.body as never), limit, createWriteStream(output, { mode: 0o600 }), { signal }); }
    catch (error) { await rm(output, { force: true }); throw error; }
    return output;
  }
}
