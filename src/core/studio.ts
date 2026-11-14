import { EventEmitter, once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile, rm, copyFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import type { Account, Asset, Capability, LicenseView, MediaOptions, Project, ProjectKind, Settings, StudioCommand, StudioState, Task, TaskContext, TaskKind, TaskResult } from '../shared/studio';
import { Store, object, text, publicUrl } from './store';
import { JobQueue, NeedsInputError, RetryableError } from './queue';
import { SecretVault, type EncryptionPort } from './vault';
import { BrowserManager, browserExecutable } from './browser';
import { MediaTools, parseSrt, formatSrt } from './media';
import { buildShots, validateCharacters, validateEpisodes, pipelineSteps } from './pipelines';
import { IntegrationClient } from './integrations';
import { CodexJobs } from './codex';
import { verifyLicense } from '../../services/studio-hub';
import { renderCards } from './cards';

export interface DesktopActions {
  openExternal?(url: string): Promise<void>;
  openAsset?(path: string): Promise<void>;
  exportAsset?(path: string, name: string): Promise<void>;
  checkUpdate?(): Promise<unknown>;
  installUpdate?(beforeInstall: () => void): Promise<unknown>;
}
export interface StudioOptions { encryption?: EncryptionPort; actions?: DesktopActions; commercial?: boolean; licensePublicKey?: string }
type MediaResult = { url?: string; buffer?: Buffer; mime: string };
export class StudioService extends EventEmitter {
  readonly store: Store;
  readonly vault: SecretVault;
  readonly browsers: BrowserManager;
  readonly queue: JobQueue;
  readonly codex: CodexJobs;
  private readonly actions: DesktopActions;
  private readonly commercial: boolean;
  private readonly clients = new Map<string, { fingerprint: string; client: IntegrationClient }>();
  private closed = false;
  private preparingUpdate = false;
  private activeMutations = 0;
  private mediaRunning = 0;
  constructor(root: string, private readonly options: StudioOptions = {}) {
    super(); this.store = new Store(root); this.vault = new SecretVault(root, options.encryption);
    this.actions = options.actions ?? {}; this.commercial = options.commercial ?? false;
    this.browsers = new BrowserManager(this.store, key => this.vault.get(key)); this.codex = new CodexJobs(root);
    this.queue = new JobQueue(this.store, (task, context) => this.execute(task, context), this.store.settings(), () => this.changed());
  }
  private changed(): void { if (!this.closed) this.emit('changed'); }
  private client(key: string): IntegrationClient {
    const provider = this.store.settings().providers[key];
    if (!provider?.baseUrl) throw new NeedsInputError(`Chưa cấu hình provider ${key} trong Cài đặt`);
    const apiKey = this.vault.get(`${key}.key`);
    const fingerprint = createHash('sha256').update(JSON.stringify({ ...provider, apiKey })).digest('hex');
    let entry = this.clients.get(key);
    if (!entry || entry.fingerprint !== fingerprint) { entry = { fingerprint, client: new IntegrationClient({ baseUrl: provider.baseUrl, model: provider.model, apiKey }) }; this.clients.set(key, entry); }
    return entry.client;
  }
  private media(): MediaTools {
    const settings = this.store.settings(); return new MediaTools({ ffmpegPath: settings.ffmpegPath || undefined, ffprobePath: settings.ffprobePath || undefined });
  }
  private async withMedia<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    while (this.mediaRunning >= this.store.settings().mediaConcurrency) await once(this, 'media-available', { signal });
    signal.throwIfAborted(); this.mediaRunning++;
    try { return await action(); } finally { this.mediaRunning--; this.emit('media-available'); }
  }
  private license(): LicenseView {
    if (!this.commercial) return { valid: true, mode: 'development', message: 'Bản phát triển — chưa phát hành thương mại' };
    const token = this.vault.get('license.token');
    if (!token || !this.options.licensePublicKey) return { valid: false, mode: 'commercial', message: 'Cần kích hoạt bằng License Hub của MaiStudio' };
    try {
      const data = verifyLicense(token, this.options.licensePublicKey); const expiresAt = Number(data.expiresAt);
      if (data.kind !== 'license' || data.deviceId !== createHash('sha256').update(this.store.root).digest('hex')) throw new Error('invalid device or token kind');
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('expired');
      return { valid: true, mode: String(data.mode ?? 'commercial'), expiresAt, message: 'Bản quyền đã xác minh chữ ký' };
    } catch { return { valid: false, mode: 'commercial', message: 'Bản quyền hết hạn hoặc không hợp lệ' }; }
  }
  private capabilities(): Capability[] {
    let browser: Capability;
    try { browser = { id: 'browser', ready: true, message: browserExecutable(this.store.settings().browserPath) }; }
    catch { browser = { id: 'browser', ready: false, message: 'Chọn Chrome/Chromium trong Cài đặt' }; }
    return [browser, { id: 'keystore', ready: this.vault.persistent(), message: this.vault.persistent() ? 'OS keystore sẵn sàng' : 'Secret chỉ giữ trong RAM; chưa có OS keystore an toàn' },
      ...Object.entries(this.store.settings().providers).map(([id, value]) => ({ id, ready: !!value.baseUrl, message: value.baseUrl ? 'Đã cấu hình — chưa chứng nhận kết nối live' : 'Chưa cấu hình URL/provider' }))];
  }
  snapshot(): StudioState {
    const settings = structuredClone(this.store.settings());
    for (const [key, value] of Object.entries(settings.providers)) value.hasKey = !!this.vault.get(`${key}.key`);
    return { version: '0.1.0', projects: this.store.projects(), tasks: this.store.tasks(), accounts: this.store.accounts(), proxies: this.store.proxies(), assets: this.store.assets(),
      settings, logs: this.store.logs(), capabilities: this.capabilities(), queuePaused: this.queue.isPaused(), codexJobs: this.codex.list(), license: this.license() };
  }
  async importFiles(paths: string[]): Promise<Asset[]> {
    if (this.preparingUpdate) throw new Error('Đang chuẩn bị cập nhật ứng dụng');
    if (!Array.isArray(paths) || paths.length > 100) throw new Error('Chỉ nhận tối đa 100 tệp mỗi lần');
    this.activeMutations++;
    try { const assets: Asset[] = []; for (const path of paths) assets.push(await this.store.importAsset(path)); this.changed(); return assets; }
    finally { this.activeMutations--; }
  }
  async invoke<T = unknown>(command: StudioCommand, input: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) throw new Error('Ứng dụng đang đóng'); object(input);
    if (this.preparingUpdate && command !== 'state' && command !== 'diagnostics') throw new Error('Đang chuẩn bị cập nhật ứng dụng');
    const mutation = command !== 'state' && command !== 'diagnostics' && command !== 'update.check' && command !== 'update.install';
    if (mutation) this.activeMutations++;
    try {
    let result: unknown;
    const id = (): string => text(input.id, 'ID', 100);
    switch (command) {
      case 'state': return this.snapshot() as T;
      case 'project.save': {
        let data = input.data === undefined ? undefined : object(input.data);
        const kind = input.kind ?? (typeof input.id === 'string' ? this.store.project(input.id).kind : 'studio');
        if (kind === 'dub' && data) data = this.applyDubTranscript(data);
        if (data?.characters !== undefined) validateCharacters(data.characters);
        if (data?.episodes !== undefined) validateEpisodes(data.episodes);
        if (data?.shots !== undefined) buildShots({ shots: data.shots });
        result = this.store.saveProject({ id: typeof input.id === 'string' ? input.id : undefined, name: text(input.name, 'Tên dự án'), kind: input.kind as ProjectKind | undefined, data }); break;
      }
      case 'project.delete': this.store.deleteProject(id()); result = { deleted: true }; break;
      case 'task.create': {
        this.validateInputRefs(input.input === undefined ? {} : object(input.input));
        const tasks = this.store.createTasks({ projectId: text(input.projectId, 'Project ID', 100), prompts: input.prompts as string | string[], kind: input.kind as TaskKind, accountId: typeof input.accountId === 'string' ? input.accountId : '', name: typeof input.name === 'string' ? input.name : undefined, input: input.input === undefined ? {} : object(input.input) });
        this.validateRefs(tasks); if (input.run === true) this.runTasks(tasks.map(task => task.id)); result = tasks; break;
      }
      case 'task.update': {
        const task = this.store.task(id()); if (task.status === 'running') throw new Error('Không sửa task đang chạy');
        const patch: Partial<Task> = {};
        for (const key of ['name', 'prompt'] as const) if (input[key] !== undefined) patch[key] = text(input[key], key, key === 'prompt' ? 32768 : 200);
        if (input.input !== undefined) { patch.input = object(input.input); this.validateInputRefs(patch.input); }
        result = this.store.updateTask(task.id, patch); break;
      }
      case 'task.reorder': this.store.reorder(this.ids(input.ids)); result = { reordered: true }; break;
      case 'task.action': {
        const ids = this.ids(input.ids); const action = text(input.action, 'Action', 30);
        if (['run', 'resume', 'retry'].includes(action)) this.runTasks(ids);
        else if (action === 'cancel' || action === 'pause') await this.queue.cancel(ids, action === 'cancel' ? 'cancelled' : 'paused');
        else if (action === 'delete') { if (ids.some(taskId => this.store.task(taskId).status === 'running')) throw new Error('Hủy task trước khi xóa'); for (const taskId of ids) this.store.deleteTask(taskId); }
        else throw new Error('Action không hợp lệ');
        result = { updated: true }; break;
      }
      case 'account.save': {
        if (input.id && this.store.tasks().some(task => task.accountId === input.id && task.status === 'running')) throw new Error('Không sửa tài khoản đang chạy');
        if (input.id) await this.browsers.close(id());
        result = this.store.saveAccount({ id: typeof input.id === 'string' ? input.id : undefined, name: text(input.name, 'Tên tài khoản'), url: typeof input.url === 'string' ? input.url : undefined, proxyId: typeof input.proxyId === 'string' ? input.proxyId : undefined }); break;
      }
      case 'account.delete': {
        const accountId = id();
        if (this.store.tasks().some(task => task.accountId === accountId && ['running', 'queued'].includes(task.status))) throw new Error('Tài khoản đang được công việc sử dụng');
        await this.browsers.close(accountId); this.store.deleteAccount(accountId); result = { deleted: true }; break;
      }
      case 'account.open': await this.browsers.open(this.store.account(id())); result = { opened: true }; break;
      case 'account.close': {
        if (this.store.tasks().some(task => task.accountId === input.id && task.status === 'running')) throw new Error('Hủy công việc của tài khoản trước khi đóng trình duyệt');
        await this.browsers.close(id()); result = { closed: true }; break;
      }
      case 'account.check': result = await this.browsers.check(id()); break;
      case 'proxy.save': {
        const proxy = this.store.saveProxy({ id: typeof input.id === 'string' ? input.id : undefined, name: text(input.name, 'Tên proxy'), server: text(input.server, 'Proxy server', 2048), username: typeof input.username === 'string' ? input.username : undefined, hasPassword: typeof input.password === 'string' ? !!input.password : undefined });
        if (typeof input.password === 'string') this.vault.save(`proxy.${proxy.id}`, input.password); result = proxy; break;
      }
      case 'proxy.delete': this.store.deleteProxy(id()); this.vault.save(`proxy.${input.id}`, ''); result = { deleted: true }; break;
      case 'proxy.test': result = await this.testProxy(id()); break;
      case 'settings.save': result = this.store.setSettings(input as Partial<Settings>); this.queue.setLimits(this.store.settings()); this.emit('media-available'); break;
      case 'secret.save': result = this.vault.save(text(input.key, 'Secret key', 100), text(input.value, 'Secret value', 16384, true)); break;
      case 'queue.pause': this.queue.pause(); result = { paused: true }; break;
      case 'queue.resume': this.queue.resume(); result = { paused: false }; break;
      case 'media.import': throw new Error('Chọn tệp qua dialog được cấp quyền, không nhận đường dẫn từ renderer');
      case 'asset.delete': this.store.deleteAsset(id()); result = { deleted: true }; break;
      case 'asset.export': if (!this.actions.exportAsset) throw new Error('Dialog export không sẵn sàng'); await this.actions.exportAsset(this.store.assetPath(id()), this.store.asset(id()).name); result = { exported: true }; break;
      case 'asset.open': if (!this.actions.openAsset) throw new Error('Desktop shell không sẵn sàng'); await this.actions.openAsset(this.store.assetPath(id())); result = { opened: true }; break;
      case 'media.merge': {
        const assets = this.ids(input.assetIds).map(assetId => this.store.asset(assetId));
        if (assets.length < 1) throw new Error('Chọn ít nhất một media');
        const kind = assets.every(asset => asset.mime.startsWith('image/')) ? 'slideshow' : 'merge';
        const [task] = this.store.createTasks({ projectId: text(input.projectId, 'Project ID', 100), prompts: ['Ghép media'], kind, input: { assetIds: assets.map(asset => asset.id), ...this.mediaInput(input) } });
        this.queue.enqueue([task.id]); result = task; break;
      }
      case 'studio.plan': result = await this.plan(input); break;
      case 'studio.run': {
        const project = this.store.project(text(input.projectId, 'Project ID', 100));
        if (this.store.tasks().some(task => task.projectId === project.id && task.kind === 'pipeline' && ['running', 'queued'].includes(task.status))) throw new Error('Dự án đã có pipeline đang chạy');
        const accountId = typeof input.accountId === 'string' && input.accountId ? input.accountId : this.store.accounts()[0]?.id ?? '';
        const [task] = this.store.createTasks({ projectId: project.id, prompts: [project.name], kind: 'pipeline', accountId, input: { projectSnapshot: project } });
        this.runTasks([task.id]); result = task; break;
      }
      case 'srt.parse': result = parseSrt(text(input.text, 'SRT', 10 * 1024 * 1024)); break;
      case 'srt.export': {
        const project = this.store.project(text(input.projectId, 'Project ID', 100)); const shots = buildShots(project.data); let start = 0;
        const content = typeof project.data.subtitle === 'string' ? formatSrt(parseSrt(project.data.subtitle)) : formatSrt(shots.map((shot, index) => { const cue = { index: index + 1, start, end: start + shot.duration, text: shot.dialogue || shot.prompt }; start = cue.end; return cue; }));
        const file = join(this.store.root, 'work', `${project.id}-${randomUUID()}.srt`); await writeFile(file, content); result = await this.store.importAsset(file, { projectId: project.id }); await rm(file, { force: true }); break;
      }
      case 'voice.list': result = await this.client('voice').voices(); break;
      case 'voice.favorite': {
        const voiceId = text(input.voiceId, 'Voice ID'); const project = this.store.projects().find(value => value.data.voiceFavorites === true);
        const favorites = new Set<string>(Array.isArray(project?.data.ids) ? project.data.ids as string[] : []); if (favorites.has(voiceId)) favorites.delete(voiceId); else favorites.add(voiceId);
        this.store.saveProject({ id: project?.id, name: 'Voice favorites', data: { voiceFavorites: true, ids: [...favorites] } }); result = [...favorites]; break;
      }
      case 'voice.sample': {
        const media = await this.client('voice').speak(text(input.text, 'Text', 32768), text(input.voiceId, 'Voice ID'));
        result = await this.saveMedia(media, { projectId: '', taskId: '' }, new AbortController().signal); break;
      }
      case 'voice.transcribe': {
        const asset = this.store.asset(text(input.assetId, 'Asset ID', 100)); if (!/^(audio|video)\//.test(asset.mime)) throw new Error('ASR cần audio/video asset');
        const transcript = await this.client('asr').transcribeTimed(this.store.assetPath(asset.id));
        result = { text: transcript.text, ...(transcript.segments.length ? { subtitle: formatSrt(transcript.segments.map((segment, index) => ({ ...segment, index: index + 1 }))) } : { message: 'Provider không trả timestamp; cần nhập SRT hoặc dùng ASR hỗ trợ segment timing.' }) }; break;
      }
      case 'voice.translate': result = { text: await this.client('text').translate(text(input.text, 'Text', 32768), text(input.language, 'Ngôn ngữ', 100)) }; break;
      case 'market.catalog': case 'market.login': case 'market.logout': case 'market.buy': case 'market.library': case 'market.download': {
        if (command === 'market.buy' && input.confirmed !== true) throw new Error('Cần xác nhận trước khi mua');
        const action = command.split('.')[1] as 'catalog' | 'login' | 'logout' | 'buy' | 'library' | 'download';
        const client = this.client('market');
        result = await client.market(action, { ...input, productId: input.productId ?? input.itemId });
        if (action === 'login' || action === 'logout') this.vault.save('market.key', client.exportSession());
        if (action === 'buy' && result && typeof result === 'object' && 'url' in result && typeof result.url === 'string') await this.actions.openExternal?.(publicUrl(result.url));
        if (action === 'download' && result && typeof result === 'object' && 'text' in result && typeof result.text === 'string') {
          const file = join(this.store.root, 'work', `market-${randomUUID()}.txt`); await writeFile(file, result.text, { mode: 0o600 });
          try { const asset = await this.store.importAsset(file); result = { ...result, asset }; } finally { await rm(file, { force: true }); }
        }
        break;
      }
      case 'shopee.product': result = await this.client('shopee').shopeeProduct(text(input.url, 'URL sản phẩm', 2048)); break;
      case 'codex.status': result = await this.codex.status(); break;
      case 'codex.run': result = await this.codex.run(text(input.prompt, 'Prompt', 32768), input.mode === 'edit' ? 'edit' : 'plan'); break;
      case 'codex.cancel': await this.codex.cancel(id()); result = { cancelled: true }; break;
      case 'codex.approve': if (input.confirmed !== true) throw new Error('Cần xác nhận kế hoạch trước khi duyệt'); result = await this.codex.approve(id()); break;
      case 'license.activate': case 'license.trial': case 'license.deactivate': result = await this.activateLicense(command, input); break;
      case 'update.check': if (!this.actions.checkUpdate) throw new Error('Chưa cấu hình update feed đã ký'); result = await this.actions.checkUpdate(); break;
      case 'update.install': {
        if (!this.actions.installUpdate) throw new Error('Chưa có bản cập nhật sẵn sàng');
        this.assertUpdateIdle();
        const wasPaused = this.queue.isPaused(); let installing = false;
        this.preparingUpdate = true;
        try {
          this.queue.pause();
          result = await this.actions.installUpdate(() => { this.assertUpdateIdle(); installing = true; });
        } catch (error) { installing = false; throw error; }
        finally {
          if (!installing) { this.preparingUpdate = false; if (!wasPaused) this.queue.resume(); }
        }
        break;
      }
      case 'diagnostics': result = { platform: process.platform, architecture: process.arch, node: process.versions.node, capabilities: this.capabilities(), queuePaused: this.queue.isPaused(), tasks: this.store.tasks().reduce<Record<string, number>>((counts, task) => { counts[task.status] = (counts[task.status] ?? 0) + 1; return counts; }, {}), logs: this.store.logs() }; break;
      default: throw new Error('Command/lệnh không được hỗ trợ');
    }
    this.changed(); return result as T;
    } finally { if (mutation) this.activeMutations--; }
  }
  private ids(value: unknown): string[] { if (!Array.isArray(value) || !value.length || value.length > 1000) throw new Error('Cần danh sách 1–1000 ID'); return [...new Set(value.map(id => text(id, 'ID', 100)))]; }
  private assertUpdateIdle(): void {
    if (this.closed) throw new Error('Ứng dụng đang đóng');
    if (this.activeMutations || this.store.tasks().some(task => task.status === 'running') || this.codex.list().some(job => ['queued', 'running'].includes(job.status))) throw new Error('Dừng công việc và Codex trước khi cập nhật');
  }
  private validateRefs(tasks: Task[]): void {
    for (const task of tasks) this.validateInputRefs(task.input);
  }
  private validateInputRefs(input: Record<string, unknown>): void {
    if (input.refIds !== undefined) {
      if (!Array.isArray(input.refIds) || input.refIds.length > 16) throw new Error('Tối đa 16 ảnh tham chiếu');
      for (const id of input.refIds) { const asset = this.store.asset(text(id, 'Asset ID', 100)); if (!asset.mime.startsWith('image/')) throw new Error('Ảnh tham chiếu phải là image asset'); }
    }
  }
  private runTasks(ids: string[]): void {
    if (!this.license().valid) throw new Error('Cần kích hoạt bản quyền MaiStudio');
    for (const id of ids) {
      const task = this.store.task(id); this.validateRefs([task]);
      if (['image', 'video', 'image-to-video'].includes(task.kind) && !task.accountId && !this.store.settings().providers.image.baseUrl) {
        const account = this.store.accounts()[0]; if (!account) throw new NeedsInputError('Thêm tài khoản Muse hoặc cấu hình image provider trước khi chạy');
        this.store.updateTask(id, { accountId: account.id });
      }
    }
    this.queue.enqueue(ids);
  }
  private async plan(input: Record<string, unknown>): Promise<Project> {
    const project = this.store.project(text(input.projectId, 'Project ID', 100)); const data = { ...project.data };
    if (typeof input.prompt === 'string') data.script = text(input.prompt, 'Kịch bản', 1024 * 1024);
    if (typeof input.subtitle === 'string') { parseSrt(input.subtitle); data.subtitle = input.subtitle; }
    for (const key of ['product', 'shots', 'characters', 'episodes', 'voiceId', 'renderMode'] as const) if (input[key] !== undefined) data[key] = input[key];
    if (input.shots === undefined && (input.prompt !== undefined || input.subtitle !== undefined || input.product !== undefined)) delete data.shots;
    if (data.characters !== undefined) data.characters = validateCharacters(data.characters);
    if (project.kind === 'series' && data.episodes !== undefined) validateEpisodes(data.episodes);
    else data.shots = buildShots(data);
    return this.store.saveProject({ id: project.id, name: project.name, kind: project.kind, data });
  }
  private mediaInput(input: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, fallback, min, max] of [['width', 1280, 16, 3840], ['height', 720, 16, 3840], ['fps', 24, 1, 60], ['volume', 0.2, 0, 4]] as const) {
      const value = input[key] ?? fallback; if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${key} không hợp lệ`); result[key] = value;
    }
    if (input.musicId) { const asset = this.store.asset(text(input.musicId, 'Music ID', 100)); if (!asset.mime.startsWith('audio/')) throw new Error('Nhạc phải là audio asset'); result.musicId = asset.id; }
    if (input.subtitle) result.subtitle = formatSrt(parseSrt(String(input.subtitle)));
    result.keepAudio = input.keepAudio !== false; return result;
  }
  private async execute(task: Task, context: TaskContext): Promise<TaskResult> {
    if (task.checkpoint.outputIds && Array.isArray(task.checkpoint.outputIds) && task.checkpoint.outputIds.every(id => this.store.assets().some(asset => asset.id === id))) return { outputIds: task.checkpoint.outputIds as string[] };
    if (task.kind === 'image' || task.kind === 'video' || task.kind === 'image-to-video') return this.generate(task, context);
    if (task.kind === 'pipeline') return this.executePipeline(task, context);
    if (task.kind === 'speech') {
      if (task.checkpoint.remoteSubmitted === true && !task.checkpoint.downloadUrl) throw new NeedsInputError('TTS đã nhận yêu cầu. Đối soát job trước khi tạo lại để tránh tính phí trùng.');
      let result: MediaResult;
      if (typeof task.checkpoint.downloadUrl === 'string') result = { url: task.checkpoint.downloadUrl, mime: 'audio/wav' };
      else { context.checkpoint({ remoteSubmitted: true }); result = await this.client('voice').speak(task.prompt, String(task.input.voiceId || 'alloy'), context.signal); if (result.url) context.checkpoint({ downloadUrl: result.url }); }
      const asset = await this.saveMedia(result, task, context.signal); context.checkpoint({ outputIds: [asset.id] }); return { outputIds: [asset.id] };
    }
    const input = task.input; const paths = this.ids(input.assetIds).map(id => this.store.assetPath(id));
    const folder = join(this.store.root, 'work', task.id); await mkdir(folder, { recursive: true });
    const output = join(folder, 'result.mp4'); const options: MediaOptions = {
      width: Number(input.width) || 1280, height: Number(input.height) || 720, fps: Number(input.fps) || 24, volume: Number(input.volume) || 0.2,
      keepAudio: input.keepAudio !== false, ...(input.musicId ? { musicPath: this.store.assetPath(String(input.musicId)) } : {}),
    };
    if (typeof input.subtitle === 'string' && input.subtitle.trim()) { const subtitle = join(folder, 'captions.srt'); await writeFile(subtitle, formatSrt(parseSrt(input.subtitle))); options.subtitlePath = subtitle; }
    if (task.kind === 'slideshow') await this.withMedia(context.signal, () => this.media().slideshow(paths.map(path => ({ path, duration: Number(input.duration) || 5 })), output, options, context));
    else if (task.kind === 'dub') {
      const audioInputs = Array.isArray(input.lines) ? input.lines.map(raw => { const line = object(raw); return { path: this.store.assetPath(String(line.assetId)), start: Number(line.start), duration: line.duration === undefined ? undefined : Number(line.duration) }; }) : paths.slice(1).map(path => ({ path, start: 0 }));
      await this.withMedia(context.signal, () => this.media().dub(paths[0], audioInputs, output, options, context));
    } else await this.withMedia(context.signal, () => this.media().merge(paths.map(path => ({ path })), output, options, context));
    context.signal.throwIfAborted(); const info = await this.media().probe(output, context.signal);
    const asset = await this.store.importAsset(output, { projectId: task.projectId, taskId: task.id, duration: info.duration }, context.signal);
    context.checkpoint({ outputIds: [asset.id] }); await this.exportOutput(asset, task, context.signal); return { outputIds: [asset.id] };
  }
  private async generate(task: Task, context: TaskContext): Promise<TaskResult> {
    if (task.kind === 'image' && this.store.settings().providers.image.baseUrl) {
      if (task.checkpoint.remoteSubmitted === true && !task.checkpoint.downloadUrl) throw new NeedsInputError('Provider ảnh đã nhận yêu cầu; cần đối soát kết quả trước khi gửi lại');
      let media: MediaResult;
      if (typeof task.checkpoint.downloadUrl === 'string') media = { url: task.checkpoint.downloadUrl, mime: 'image/png' };
      else {
        const refs = Array.isArray(task.input.refIds) ? task.input.refIds.map(id => { const asset = this.store.asset(String(id)); if (asset.size > 20 * 1024 * 1024) throw new Error('Ảnh tham chiếu vượt 20 MiB'); return this.store.assetPath(asset.id); }) : [];
        context.checkpoint({ remoteSubmitted: true });
        try { media = await this.client('image').generateImage(task.prompt, { size: String(task.input.size || '1024x1024'), refs }, context.signal); }
        catch (error) {
          if (error instanceof Error && /Provider HTTP 429$/.test(error.message)) { context.checkpoint({ remoteSubmitted: false }); throw new RetryableError('Provider đang giới hạn tốc độ'); }
          throw error;
        }
        if (media.url) context.checkpoint({ downloadUrl: media.url });
      }
      const asset = await this.saveMedia(media, task, context.signal); context.checkpoint({ outputIds: [asset.id] }); return { outputIds: [asset.id] };
    }
    if (!task.accountId) throw new NeedsInputError('Cần chọn tài khoản Muse cho video/browser generation');
    const result = await this.browsers.generate(task, context); context.checkpoint({ outputIds: result.outputIds }); return result;
  }
  private async executePipeline(task: Task, context: TaskContext): Promise<TaskResult> {
    const project = object(task.input.projectSnapshot) as unknown as Project;
    if (project.kind === 'series') {
      const episodes = validateEpisodes(project.data.episodes); const checkpoints = object(task.checkpoint.episodes ?? {}); const outputIds: string[] = [];
      for (const [index, episode] of episodes.entries()) {
        context.signal.throwIfAborted(); const source = object((project.data.episodes as unknown[])[index]);
        const previous = this.store.projects().find(value => value.kind === 'film' && value.data.seriesParentId === project.id && value.data.episodeId === episode.id);
        const data = { ...project.data, ...source, episodes: undefined, seriesParentId: project.id, episodeId: episode.id };
        const film = this.store.saveProject({ id: previous?.id, name: `${project.name} — ${episode.name}`, kind: 'film', data });
        const checkpoint = object(checkpoints[episode.id] ?? {});
        let ids = Array.isArray(checkpoint.outputIds) && checkpoint.outputIds.every(id => this.store.assets().some(asset => asset.id === id)) ? checkpoint.outputIds as string[] : [];
        if (!ids.length) {
          const child: Task = { ...task, input: { ...task.input, projectSnapshot: film }, checkpoint };
          const result = await this.executePipeline(child, { signal: context.signal,
            progress: (progress, message) => context.progress((index + progress) / episodes.length, `${episode.name}: ${message}`),
            checkpoint: value => { checkpoints[episode.id] = { ...object(checkpoints[episode.id] ?? {}), ...value }; context.checkpoint({ episodes: checkpoints }); },
          });
          ids = result.outputIds;
        }
        outputIds.push(...ids); this.store.saveProject({ ...film, data: { ...film.data, outputIds: ids } });
      }
      context.checkpoint({ outputIds }); return { outputIds };
    }
    if (project.kind === 'dub') return this.executeDub(task, project, context);
    const steps = pipelineSteps(project); const results = object(task.checkpoint.steps ?? {}); const clips: Array<{ path: string; duration: number; start?: number }> = []; const voices: Array<{ path: string; start: number; duration?: number }> = [];
    const stills = new Map<string, string>(); let position = 0;
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index]; context.signal.throwIfAborted();
      if (project.data.renderMode === 'slideshow' && step.kind === 'video') {
        const base = step.id.replace(/\/(image|video|speech)$/, '');
        const imageId = stills.get(base) || step.refIds[0];
        if (!imageId || !this.store.asset(imageId).mime.startsWith('image/')) throw new Error('Shot slideshow cần ảnh hợp lệ');
        clips.push({ path: this.store.assetPath(imageId), duration: step.duration, start: step.start }); position = (step.start ?? position) + step.duration; continue;
      }
      const saved = results[step.id] ? object(results[step.id]) : {};
      let assetId = typeof saved.assetId === 'string' && this.store.assets().some(asset => asset.id === saved.assetId) ? saved.assetId : '';
      if (!assetId) {
        const childContext: TaskContext = { signal: context.signal,
          progress: (progress, message) => context.progress((index + progress) / Math.max(steps.length + 1, 1), `${index + 1}/${steps.length}: ${message}`),
          checkpoint: value => { results[step.id] = { ...saved, ...object(results[step.id] ?? {}), ...value }; context.checkpoint({ steps: results }); },
        };
        const refs = [...step.refIds]; const base = step.id.replace(/\/(image|video|speech)$/, '');
        if (step.kind === 'video' && stills.has(base)) refs.push(stills.get(base)!);
        const child: Task = { ...task, kind: step.kind, prompt: step.prompt, input: { refIds: [...new Set(refs)], voiceId: step.voiceId, ratio: project.data.ratio ?? '16:9' }, checkpoint: saved };
        const result = step.kind === 'speech' ? await this.execute(child, childContext) : await this.generate(child, childContext);
        assetId = result.outputIds[0]; results[step.id] = { ...object(results[step.id] ?? {}), assetId }; context.checkpoint({ steps: results });
      }
      const base = step.id.replace(/\/(image|video|speech)$/, '');
      if (step.kind === 'image') stills.set(base, assetId);
      else if (step.kind === 'video') { clips.push({ path: this.store.assetPath(assetId), duration: step.duration, start: step.start }); position = (step.start ?? position) + step.duration; }
      else voices.push({ path: this.store.assetPath(assetId), start: step.start ?? Math.max(0, position - step.duration), duration: step.duration });
    }
    if (!clips.length) throw new Error('Pipeline chưa có clip để dựng');
    const folder = join(this.store.root, 'work', task.id); await mkdir(folder, { recursive: true }); const output = join(folder, 'pipeline.mp4');
    const mediaContext: TaskContext = { ...context, progress: (progress, message) => context.progress(0.9 + progress * 0.09, message) };
    const options: MediaOptions = { width: Number(project.data.width) || 1280, height: Number(project.data.height) || 720, fps: 24 };
    if (project.data.musicId) {
      const music = this.store.asset(text(project.data.musicId, 'Music ID', 100)); if (!music.mime.startsWith('audio/')) throw new Error('Nhạc nền phải là audio asset'); options.musicPath = this.store.assetPath(music.id); options.volume = Number(project.data.musicVolume ?? 0.2);
    }
    const title = typeof project.data.titleCard === 'string' ? project.data.titleCard.trim() : '';
    const ending = typeof project.data.endCard === 'string' ? project.data.endCard.trim() : '';
    const product = project.data.product && project.data.productOverlay !== false ? object(project.data.product) : undefined;
    const overlayText = product ? [product.price, product.cta].filter(value => typeof value === 'string' || typeof value === 'number').join(' · ') : '';
    const cards: Parameters<typeof renderCards>[0] = [];
    const intro = join(folder, 'title.png'); const outro = join(folder, 'end.png'); const overlay = join(folder, 'product-overlay.png');
    if (title) cards.push({ title, output: intro, width: options.width!, height: options.height! });
    if (ending) cards.push({ title: ending, output: outro, width: options.width!, height: options.height! });
    if (product) cards.push({ title: String(product.name || product.title || project.name), body: overlayText, overlay: true, output: overlay, width: options.width!, height: options.height! });
    if (cards.length) await this.withMedia(context.signal, () => renderCards(cards, this.store.settings().browserPath, context.signal));
    if (product) options.overlayPath = overlay;
    const titleOffset = title ? 2 : 0;
    if (title || ending) {
      let cursor = 0;
      for (const clip of clips) { const original = clip.start ?? cursor; clip.start = original + titleOffset; cursor = original + clip.duration; }
      for (const voice of voices) voice.start += titleOffset;
      const cardClip = async (path: string, name: string): Promise<string> => {
        if (project.data.renderMode === 'slideshow') return path;
        const video = join(folder, name + '.mp4'); await this.withMedia(context.signal, () => this.media().slideshow([{ path, duration: 2 }], video, { width: options.width, height: options.height, fps: 24 }, mediaContext)); return video;
      };
      if (ending) clips.push({ path: await cardClip(outro, 'end'), duration: 2, start: cursor + titleOffset });
      if (title) clips.unshift({ path: await cardClip(intro, 'title'), duration: 2, start: 0 });
    }
    if (project.data.burnSubtitles === true && typeof project.data.subtitle === 'string') {
      const captions = join(folder, 'subtitles.srt'); await writeFile(captions, formatSrt(parseSrt(project.data.subtitle).map(cue => ({ ...cue, start: cue.start + titleOffset, end: cue.end + titleOffset })))); options.subtitlePath = captions;
    }
    const visualOptions = voices.length ? { ...options, musicPath: undefined } : options;
    if (project.data.renderMode === 'slideshow') await this.withMedia(context.signal, () => this.media().slideshow(clips, output, visualOptions, mediaContext)); else await this.withMedia(context.signal, () => this.media().merge(clips, output, visualOptions, mediaContext));
    let final = output;
    if (voices.length) { final = join(folder, 'voiced.mp4'); await this.withMedia(context.signal, () => this.media().dub(output, voices, final, { width: options.width, height: options.height, fps: options.fps, musicPath: options.musicPath, volume: options.volume, keepAudio: project.data.keepAudio === true }, mediaContext)); }
    const info = await this.media().probe(final, context.signal); const asset = await this.store.importAsset(final, { taskId: task.id, projectId: task.projectId, duration: info.duration }, context.signal);
    context.checkpoint({ outputIds: [asset.id] }); await this.exportOutput(asset, task, context.signal); return { outputIds: [asset.id] };
  }
  private async executeDub(task: Task, project: Project, context: TaskContext): Promise<TaskResult> {
    const source = this.store.assetPath(text(project.data.sourceAssetId, 'Source asset ID', 100));
    const data = this.applyDubTranscript(project.data);
    const cues = parseSrt(text(data.subtitle, 'Subtitle', 10 * 1024 * 1024)); const done = object(task.checkpoint.lines ?? {});
    const audio: Array<{ path: string; start: number; duration: number }> = [];
    for (const cue of cues) {
      context.signal.throwIfAborted(); const saved = done[String(cue.index)];
      const line = typeof saved === 'string' ? { assetId: saved } : object(saved ?? {});
      let assetId = typeof line.assetId === 'string' ? line.assetId : '';
      if (!assetId) {
        if (line.remoteSubmitted === true && !line.downloadUrl) throw new NeedsInputError(`Dòng ${cue.index}: TTS đã nhận yêu cầu; đối soát trước khi thử lại.`);
        let result: MediaResult;
        if (typeof line.downloadUrl === 'string') result = { url: line.downloadUrl, mime: 'audio/wav' };
        else {
          line.remoteSubmitted = true; done[String(cue.index)] = line; context.checkpoint({ lines: done });
          result = await this.client('voice').speak(cue.text, String(project.data.voiceId || 'alloy'), context.signal);
          if (result.url) { line.downloadUrl = result.url; context.checkpoint({ lines: done }); }
        }
        assetId = (await this.saveMedia(result, task, context.signal)).id; line.assetId = assetId; done[String(cue.index)] = line; context.checkpoint({ lines: done });
      }
      audio.push({ path: this.store.assetPath(assetId), start: cue.start, duration: cue.end - cue.start }); context.progress(cue.index / (cues.length + 1) * 0.8, `Đã tạo giọng dòng ${cue.index}`);
    }
    const folder = join(this.store.root, 'work', task.id); await mkdir(folder, { recursive: true }); const output = join(folder, 'dub.mp4');
    await this.withMedia(context.signal, () => this.media().dub(source, audio, output, { keepAudio: project.data.keepAudio === true, volume: 1 }, context));
    const asset = await this.store.importAsset(output, { projectId: task.projectId, taskId: task.id }, context.signal); context.checkpoint({ outputIds: [asset.id] }); return { outputIds: [asset.id] };
  }
  private applyDubTranscript(data: Record<string, unknown>): Record<string, unknown> {
    if (typeof data.script !== 'string' || !data.script.trim() || typeof data.subtitle !== 'string' || !data.subtitle.trim()) return data;
    const cues = parseSrt(data.subtitle); const script = text(data.script, 'Transcript', 1024 * 1024);
    let blocks = cues.length === 1 ? [script.replace(/\n\s*\n/g, '\n')] : script.split(/\n\s*\n/).map(block => block.trim());
    if (blocks.length !== cues.length) blocks = script.split(/\r?\n/).map(line => line.trim());
    if (blocks.length !== cues.length || blocks.some(block => !block)) throw new Error('Số block/dòng transcript phải khớp số cue SRT để giữ timestamp');
    return { ...data, subtitle: formatSrt(cues.map((cue, index) => ({ ...cue, text: blocks[index] }))) };
  }
  private async saveMedia(media: MediaResult, owner: { projectId: string; taskId?: string; id?: string }, signal: AbortSignal): Promise<Asset> {
    signal.throwIfAborted(); const folder = join(this.store.root, 'work'); const suffix: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'audio/wav': '.wav', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg' };
    const file = join(folder, `download-${createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 16)}${suffix[media.mime] ?? '.bin'}`);
    try {
      if (media.buffer) await writeFile(file, media.buffer, { mode: 0o600 });
      else if (media.url) {
        const url = publicUrl(media.url, true); const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]) });
        if (!response.ok || !response.body) throw new Error(`Tải output thất bại HTTP ${response.status}`);
        let bytes = 0; const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; callback(bytes > 256 * 1024 * 1024 ? new Error('Output vượt 256 MiB') : null, chunk); } });
        await pipeline(Readable.fromWeb(response.body as never), limit, createWriteStream(file, { mode: 0o600 }), { signal });
      } else throw new Error('Provider không trả về media');
      signal.throwIfAborted(); return await this.store.importAsset(file, { projectId: owner.projectId, taskId: owner.taskId ?? owner.id ?? '' }, signal);
    } finally { await rm(file, { force: true }); }
  }
  private async exportOutput(asset: Asset, task: Task, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted(); const root = this.store.settings().outputDir; await mkdir(root, { recursive: true });
    const destination = join(root, `${task.id}-${asset.id}${extname(this.store.assetPath(asset.id))}`); const temporary = `${destination}.part`;
    try { await copyFile(this.store.assetPath(asset.id), temporary); signal.throwIfAborted(); const { rename } = await import('node:fs/promises'); await rename(temporary, destination); }
    finally { await rm(temporary, { force: true }); }
  }
  private async testProxy(proxyId: string): Promise<unknown> {
    const account: Account = { id: `proxy-test-${proxyId}`, name: 'Proxy test', proxyId, status: 'test', url: 'https://example.com/', createdAt: Date.now() };
    // Use an app-owned short-lived profile; no account session or credential is exported.
    const { chromium } = await import('playwright-core'); const proxy = this.store.proxy(proxyId);
    const browser = await chromium.launch({ executablePath: browserExecutable(this.store.settings().browserPath), headless: true, chromiumSandbox: true, proxy: { server: proxy.server, username: proxy.username, password: this.vault.get(`proxy.${proxy.id}`) } });
    try { const page = await browser.newPage(); const response = await page.goto(account.url, { timeout: 30000 }); return { ready: !!response?.ok(), message: `HTTP ${response?.status() ?? 'unknown'}` }; } finally { await browser.close(); }
  }
  private async activateLicense(command: string, input: Record<string, unknown>): Promise<LicenseView> {
    const base = this.store.settings().providers.license.baseUrl; if (!base) throw new Error('Chưa cấu hình License Hub');
    const action = command.split('.')[1];
    const reply = await fetch(`${publicUrl(base, true).replace(/\/$/, '')}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: input.key, token: this.vault.get('license.token'), deviceId: createHash('sha256').update(this.store.root).digest('hex') }), redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!reply.ok) { await reply.body?.cancel(); throw new Error(`License Hub HTTP ${reply.status}`); }
    const buffer = await reply.text(); if (Buffer.byteLength(buffer) > 65536) throw new Error('License Hub response quá lớn'); const response = object(JSON.parse(buffer));
    if (action === 'deactivate') this.vault.save('license.token', '');
    else { const token = text(response.token, 'License token', 16000); this.vault.save('license.token', token); }
    return this.license();
  }
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true; await this.queue.close(); await this.codex.close(); await this.browsers.shutdown(); this.store.close(); this.removeAllListeners();
  }
}
