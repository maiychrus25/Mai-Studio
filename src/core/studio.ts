import { execFile } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile, rm, copyFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import type { Account, Asset, Capability, Character, LicenseView, MediaOptions, Project, ProjectKind, Settings, Shot, StudioCommand, StudioState, Task, TaskContext, TaskKind, TaskResult } from '../shared/studio';
import { Store, object, text, publicUrl } from './store';
import { JobQueue, NeedsInputError, RetryableError, hasPendingAdmission } from './queue';
import { SecretVault, type EncryptionPort } from './vault';
import { BrowserManager, browserExecutable } from './browser';
import { MediaTools, parseSrt, formatSrt } from './media';
import { createRecap } from './series';
import { buildShots, validateCharacters, validateEpisodes, pipelineSteps, affiliateDubbing } from './pipelines';
import { IntegrationClient } from './integrations';
import { CodexJobs } from './codex';
import { verifyLicense } from '../../services/studio-hub';
import { renderCards } from './cards';
import { planningPrompt, parsePlan } from './planning';
import { direct, toPlan, budget, DirectorIncomplete, type IO as DirectorIO, type State as DirectorState, type Pace, type Plan } from './director';
import { parseProducts } from './products';
import { splitStory, cuesFromDurations, groupNarration, alignScript } from './story';
import { OfflineAsr } from './offline-asr';
import { analyzeSpeech, compareTranscripts, compareSpeakers } from './acoustics';
import { parseVideoReview, qualityRetries, reviewScore, videoReviewPrompt, VIDEO_REVIEW_FRAMES } from './quality';
import { downloadShopeeImage, parseShopeeCapture, resolveShopeeLink, shopeeImageUrl, shopeeLink, shopeeOffer, MAX_SHOPEE_IMAGES, MAX_SHOPEE_CAPTURE_BYTES } from './shopee';
import { shopeeBookmarklet } from '../shared/shopee-capture';
import { readAffiliateSettings, affiliateMode, MAX_AFFILIATE_REFERENCES } from '../shared/affiliate';
import { affiliateReviewPrompt, parseAffiliateReview } from './affiliate';
import { affiliateCaptionCues, affiliatePostText, alignAffiliateShots, detectAffiliateBeats } from './affiliate-edit';

export interface DesktopActions {
  openExternal?(url: string): Promise<void>;
  copyText?(value: string): Promise<void>;
  openAsset?(path: string): Promise<void>;
  exportAsset?(path: string, name: string): Promise<void>;
  checkUpdate?(): Promise<unknown>;
  installUpdate?(beforeInstall: () => void): Promise<unknown>;
}
export interface StudioOptions { encryption?: EncryptionPort; actions?: DesktopActions; commercial?: boolean; licensePublicKey?: string }
type MediaResult = { url?: string; buffer?: Buffer; mime: string };
// MuseStudio plans films with a multi-turn director (filmstudio.write_script). Projects locked to subtitle cues,
// measured narration or the customer's verbatim script keep the single planning request, whose shot count is fixed.
function directorEligible(project: Project): boolean {
  const d = project.data;
  return project.kind === 'film' && typeof d.script === 'string' && !!d.script.trim() && d.keepScript !== true && d.storyMode !== true
    && !(Array.isArray(d.visualGroups) && d.visualGrouped === true) && !(typeof d.subtitle === 'string' && d.subtitle.trim());
}

function clipWindow(data: Record<string, unknown>, duration: number, requested: number, speech?: Awaited<ReturnType<typeof analyzeSpeech>>, affiliate = false): { start: number; duration: number; speechOverflow?: boolean } {
  if (!speech) return { start: 0, duration: Math.min(requested, duration) };
  if (!speech.parts.length) throw new NeedsInputError('Clip chưa phát hiện lời nói để căn hình và phụ đề');
  const lead = data.pace === 'drama' ? 0.18 : 0.45, hold = data.pace === 'drama' ? 0.4 : 0.75, minimum = data.pace === 'drama' ? 1.6 : 2.6;
  const start = Math.max(0, speech.parts[0].start - lead), end = Math.min(duration, Math.max(speech.parts.at(-1)!.end + hold, start + minimum));
  if (affiliate) return { start, duration: Math.min(requested, duration - start), speechOverflow: speech.parts.at(-1)!.end - start > requested - 0.1 };
  const fps = Number(data.fps) || 24;
  return { start, duration: Math.floor((end - start) * fps) / fps };
}

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
  private offline: OfflineAsr;
  private readonly closing = new AbortController();
  constructor(root: string, private readonly options: StudioOptions = {}) {
    super(); this.store = new Store(root); this.vault = new SecretVault(root, options.encryption);
    this.actions = options.actions ?? {}; this.commercial = options.commercial ?? false;
    this.browsers = new BrowserManager(this.store, key => this.vault.get(key)); this.codex = new CodexJobs(root);
    this.offline = new OfflineAsr(root, this.store.settings().ffmpegPath || undefined);
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
      { id: 'offline-asr', ready: this.offline.ready(), message: this.offline.ready() ? 'Mô hình giọng local đã xác minh; không cần API ASR' : 'Tải mô hình giọng local (~86 MB) trong Cài đặt để dùng ASR và đối chiếu giọng offline' },
      ...Object.entries(this.store.settings().providers).map(([id, value]) => ({ id, ready: !!value.baseUrl, message: value.baseUrl ? 'Đã cấu hình — chưa chứng nhận kết nối live' : 'Chưa cấu hình URL/provider' }))];
  }
  snapshot(): StudioState {
    const settings = structuredClone(this.store.settings());
    for (const [key, value] of Object.entries(settings.providers)) value.hasKey = !!this.vault.get(`${key}.key`);
    return { version: '0.2.0-dev.1', projects: this.store.projects(), tasks: this.store.tasks(), accounts: this.store.accounts(), proxies: this.store.proxies(), assets: this.store.assets(),
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
        if (data) {
          qualityRetries(data.qualityRetries);
          for (const key of ['autoChecks', 'videoReview']) if (data[key] !== undefined && typeof data[key] !== 'boolean') throw new Error(`Invalid ${key}`);
        }
        if (data?.productAssetIds !== undefined) this.validateInputRefs({ refIds: data.productAssetIds });
        if (kind === 'affiliate' && data?.affiliate !== undefined) {
          data = { ...data, affiliate: this.validateAffiliateRefs(data) };
          affiliateDubbing({ kind, data });
        }
        if (data && typeof input.id === 'string') {
          const previous = this.store.project(input.id);
          const affiliateIntent = (value: unknown, review = false) => {
            if (value === undefined) return undefined;
            const settings: Record<string, unknown> = { ...readAffiliateSettings(value) };
            for (const key of ['showPrice', 'screenText', 'aiLabel', 'adLabel', 'endCard', 'affiliateUrl', ...(!review ? ['caption', 'cta'] : [])]) delete settings[key];
            return settings;
          };
          const affiliateChanged = kind === 'affiliate' && JSON.stringify(affiliateIntent(data.affiliate)) !== JSON.stringify(affiliateIntent(previous.data.affiliate));
          const affiliateCopyChanged = kind === 'affiliate' && JSON.stringify(affiliateIntent(data.affiliate, true)) !== JSON.stringify(affiliateIntent(previous.data.affiliate, true));
          if (this.contentFingerprint(data) !== this.contentFingerprint(previous.data) && previous.data.production) data = { ...data, productionStale: true };
          if (['ai-api', 'muse-browser'].includes(String(object(previous.data.planning ?? {}).source))) {
            if (['shots', 'scenes'].some(key => JSON.stringify(data![key]) !== JSON.stringify(previous.data[key]))) data = { ...data, planningNeedsUpdate: false };
            else if (affiliateChanged || ['script', 'minutes', 'genre', 'language', 'product', ...(kind === 'affiliate' && data.affiliate !== undefined ? ['productAssetIds', 'style', 'styleText'] : [])].some(key => JSON.stringify(data![key]) !== JSON.stringify(previous.data[key]))) data = { ...data, planningNeedsUpdate: true };
          }
          if (kind === 'affiliate' && previous.data.affiliateReview && (affiliateCopyChanged || ['shots', 'scenes', 'characters', 'product', 'productAssetIds', 'language', 'style', 'styleText', 'suggestedTitle', 'affiliatePost', 'affiliateCaption'].some(key => JSON.stringify(data![key]) !== JSON.stringify(previous.data[key])))) data = { ...data, affiliateReview: { ...object(previous.data.affiliateReview), stale: true } };
        }
        const previous = typeof input.id === 'string' ? this.store.project(input.id) : undefined;
        this.store.transaction(() => {
          const saved = this.store.saveProject({ id: previous?.id, name: text(input.name, 'Tên dự án'), kind: input.kind as ProjectKind | undefined, data });
          if (saved.kind === 'series' && previous) {
            const sharedChanged = ['characters', 'style', 'styleText', 'bible', 'ratio', 'musicId', 'musicMode'].some(key => JSON.stringify(saved.data[key]) !== JSON.stringify(previous.data[key]));
            const before = new Map((Array.isArray(previous.data.episodes) ? previous.data.episodes : []).map(value => { const episode = object(value); return [String(episode.id), episode]; }));
            const after = new Map((Array.isArray(saved.data.episodes) ? saved.data.episodes : []).map(value => { const episode = object(value); return [String(episode.id), episode]; }));
            for (const film of this.store.projects().filter(item => item.kind === 'film' && item.data.seriesParentId === saved.id)) {
              if (sharedChanged || JSON.stringify(before.get(String(film.data.episodeId))) !== JSON.stringify(after.get(String(film.data.episodeId)))) this.store.saveProject({ ...film, data: { ...film.data, productionStale: true } });
            }
          }
          result = saved;
        }); break;
      }
      case 'project.delete': this.store.deleteProject(id()); result = { deleted: true }; break;
      case 'project.import.products': {
        if (input.format !== 'csv' && input.format !== 'json') throw new Error('Định dạng sản phẩm phải là csv hoặc json');
        const products = parseProducts(input.text as string, input.format);
        result = this.store.transaction(() => products.map((product, index) => this.store.saveProject({ name: String(product.name || product.title || product.productName || product.product_name || `Product ${index + 1}`).slice(0, 90), kind: 'affiliate', data: { product, productSource: { format: input.format, index, importedAt: Date.now() } } }))); break;
      }
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
      case 'settings.save': result = this.store.setSettings(input as Partial<Settings>); if (input.ffmpegPath !== undefined) this.offline = new OfflineAsr(this.store.root, this.store.settings().ffmpegPath || undefined); this.queue.setLimits(this.store.settings()); this.emit('media-available'); break;
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
      case 'media.extractAudio': {
        const asset = this.store.asset(text(input.assetId, 'Asset ID', 100)); if (!/^(audio|video)\//.test(asset.mime)) throw new Error('Chọn audio/video để tách âm thanh');
        const [task] = this.store.createTasks({ projectId: text(input.projectId, 'Project ID', 100), prompts: ['Tách âm thanh'], kind: 'extract-audio', input: { assetIds: [asset.id] } });
        this.queue.enqueue([task.id]); result = task; break;
      }
      case 'studio.plan': result = await this.plan(input); break;
      case 'studio.run': {
        const project = this.store.project(text(input.projectId, 'Project ID', 100));
        const stage = input.stage ?? 'all';
        if (!['plan', 'music', 'characters', 'images', 'videos', 'speech', 'check', 'render', 'all'].includes(String(stage))) throw new Error('Bước sản xuất không hợp lệ');
        if (project.kind === 'dub' && !['speech', 'check', 'render', 'all'].includes(String(stage))) throw new Error('Dubbing chỉ hỗ trợ lời đọc, kiểm tra local, dựng từ output và chạy toàn bộ');
        if (project.kind === 'dub' && input.shotIds !== undefined && stage !== 'speech') throw new Error('Dubbing chỉ chọn cue khi chạy bước lời đọc');
        const dubbing = affiliateDubbing(project);
        if (project.kind === 'affiliate' && project.data.affiliate !== undefined && stage === 'speech' && !dubbing) throw new NeedsInputError('Affiliate dùng giọng trong clip hoặc chế độ không lời đã chọn; không tạo TTS riêng');
        if (dubbing && !['render', 'check'].includes(String(stage))) this.client('voice');
        if (project.data.planningNeedsUpdate === true && ['images', 'videos', 'check', 'render'].includes(String(stage))) throw new NeedsInputError('Cần cập nhật kế hoạch AI hoặc chỉnh storyboard trước khi dùng các bước tạo media, review và dựng');
        if (input.force !== undefined && typeof input.force !== 'boolean') throw new Error('force must be boolean');
        if (input.force === true && !['music', 'characters', 'images', 'videos', 'speech'].includes(String(stage))) throw new Error('Chỉ tạo lại ở bước nhạc, nhân vật, ảnh, video hoặc lời đọc');
        this.assertProductionAdmission(project.id, String(stage));
        if (this.store.tasks().some(task => task.projectId === project.id && ['pipeline', 'plan'].includes(task.kind) && ['running', 'queued'].includes(task.status))) throw new Error('Dự án đã có pipeline đang chạy');
        let shotIds: string[] | undefined;
        if (input.shotIds !== undefined) {
          if (!['images', 'videos', 'speech', 'check'].includes(String(stage))) throw new Error('Chỉ chọn shot khi chạy bước ảnh, video, giọng hoặc kiểm tra');
          shotIds = this.ids(input.shotIds);
          const bases = new Set(pipelineSteps(project, { speech: false }).map(step => step.id.replace(/\/(image|video|speech)$/, '')));
          if (project.kind === 'series') for (const film of this.store.projects().filter(item => item.kind === 'film' && item.data.seriesParentId === project.id && validateEpisodes(project.data.episodes).some(episode => episode.id === item.data.episodeId))) {
            for (const step of pipelineSteps(film, { speech: false })) bases.add(`${encodeURIComponent(project.id)}/${encodeURIComponent(String(film.data.episodeId))}${step.id.slice(encodeURIComponent(film.id).length).replace(/\/(image|video|speech)$/, '')}`);
          }
          shotIds = shotIds.map(id => { if (bases.has(id)) return id; const matches = [...bases].filter(base => decodeURIComponent(base.split('/').at(-1)!) === id); if (matches.length !== 1) throw new Error('Shot không thuộc dự án hoặc ID shot bị trùng; chọn ID đầy đủ'); return matches[0]; });
        }
        const accountId = typeof input.accountId === 'string' && input.accountId ? input.accountId : this.store.accounts()[0]?.id ?? '';
        const [task] = this.store.createTasks({ projectId: project.id, prompts: [project.name], kind: stage === 'plan' && project.kind !== 'series' ? 'plan' : 'pipeline', accountId, input: { projectSnapshot: project, stage, ...(input.force === true ? { force: true } : {}), ...(shotIds ? { shotIds } : {}) } });
        this.runTasks([task.id]); result = task; break;
      }
      case 'srt.parse': result = parseSrt(text(input.text, 'SRT', 10 * 1024 * 1024)); break;
      case 'srt.export': {
        const project = this.store.project(text(input.projectId, 'Project ID', 100)); const shots = buildShots(project.data); let start = 0;
        const production = object(project.data.production ?? {}); const generated = production.subtitle;
        let content: string;
        if (typeof generated === 'string' && production.subtitleInputHash === this.contentFingerprint(project.data)) content = formatSrt(parseSrt(generated));
        else {
          if (project.data.nativeAudio === true && (typeof generated === 'string' || typeof project.data.subtitle !== 'string')) throw new NeedsInputError('Dựng lại từ clip hiện tại để có clock phụ đề; không xuất mốc thoại cũ hoặc ước lượng');
          const offset = project.kind !== 'dub' && typeof project.data.titleCard === 'string' && project.data.titleCard.trim() ? Number(project.data.titleDuration ?? 2) : 0;
          if (!Number.isFinite(offset) || offset < 0 || offset > 15) throw new Error('Invalid title duration');
          const cues = typeof project.data.subtitle === 'string' ? parseSrt(project.data.subtitle) : shots.map((shot, index) => { const at = shot.start ?? start; const cue = { index: index + 1, start: at, end: at + shot.duration, text: shot.dialogue || shot.prompt }; start = cue.end; return cue; });
          content = formatSrt(cues.map(cue => ({ ...cue, start: cue.start + offset, end: cue.end + offset })));
        }
        const file = join(this.store.root, 'work', `${project.id}-${randomUUID()}.srt`); await writeFile(file, content); result = await this.store.importAsset(file, { projectId: project.id }); await rm(file, { force: true }); break;
      }
      case 'voice.list': result = await this.client('voice').voices(); break;
      case 'voice.offline.prepare': {
        const existing = this.store.tasks().find(task => task.kind === 'model-prepare' && ['queued', 'running'].includes(task.status));
        if (existing) { result = existing; break; }
        const project = this.store.projects().find(project => project.data.system === 'speech-models') ?? this.store.saveProject({ name: 'Offline speech models', data: { system: 'speech-models' } });
        const [task] = this.store.createTasks({ projectId: project.id, kind: 'model-prepare', prompts: ['Chuẩn bị mô hình giọng local'] });
        this.queue.enqueue([task.id]); result = task; break;
      }
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
        const transcript = this.store.settings().providers.asr.baseUrl ? await this.client('asr').transcribeTimed(this.store.assetPath(asset.id), this.closing.signal) : await this.localTranscript(this.store.assetPath(asset.id), this.closing.signal);
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
      case 'shopee.open': {
        const link = shopeeLink(input.url);
        if (!this.actions.openExternal) throw new Error('Không có trình duyệt hệ thống để mở sản phẩm');
        await this.actions.openExternal(link.url); result = link; break;
      }
      case 'shopee.bookmarklet': {
        const code = shopeeBookmarklet(); await this.actions.copyText?.(code); result = { code, copied: !!this.actions.copyText }; break;
      }
      case 'shopee.import': {
        const project = this.store.project(text(input.projectId, 'Project ID', 100));
        if (project.kind !== 'affiliate') throw new Error('Nhập sản phẩm Shopee vào dự án Affiliate');
        const link = shopeeLink(input.url);
        const raw = typeof input.text === 'string' && input.text.trim() ? text(input.text, 'Product capture JSON', MAX_SHOPEE_CAPTURE_BYTES) : '';
        const capture = raw ? parseShopeeCapture(raw, link.short ? String(object(JSON.parse(raw)).url) : link.url) : undefined;
        if (this.store.tasks().some(task => task.projectId === project.id && task.kind === 'product-import' && ['queued', 'running'].includes(task.status))) throw new Error('Dự án đang nhập sản phẩm; chờ hoặc hủy tác vụ hiện tại');
        const [task] = this.store.createTasks({ projectId: project.id, kind: 'product-import', prompts: ['Nhập sản phẩm Shopee'], input: { url: link.inputUrl, ...(capture ? { capture } : {}), inputHash: this.contentFingerprint(project.data) } });
        this.queue.enqueue([task.id]); result = task; break;
      }
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
  private validateAffiliateRefs(data: Record<string, unknown>): ReturnType<typeof readAffiliateSettings> {
    const affiliate = readAffiliateSettings(data.affiliate), model = affiliateMode(affiliate).model;
    this.validateInputRefs({ refIds: [affiliate.presenterAssetId, affiliate.backgroundAssetId, ...affiliate.outfitAssetIds].filter(Boolean) });
    const refs = new Set([...(Array.isArray(data.productAssetIds) ? data.productAssetIds as string[] : []), model ? affiliate.presenterAssetId : '', affiliate.backgroundAssetId, ...(affiliate.contentStyle === 'lookbook' ? affiliate.outfitAssetIds : [])].filter(Boolean));
    const generatedHost = model && !affiliate.presenterAssetId ? 1 : 0;
    if (refs.size + generatedHost > MAX_AFFILIATE_REFERENCES) throw new Error(`Affiliate giới hạn ${MAX_AFFILIATE_REFERENCES} ảnh tham chiếu kể cả người mẫu tự tạo để còn chỗ cho ảnh cần review`);
    return affiliate;
  }
  private planningRefs(project: Project): string[] {
    const products = project.data.productAssetIds === undefined ? [] : project.data.productAssetIds; this.validateInputRefs({ refIds: products });
    const affiliate = project.kind === 'affiliate' && project.data.affiliate !== undefined ? readAffiliateSettings(project.data.affiliate) : undefined;
    const cast = affiliate && !affiliateMode(affiliate).model ? [] : validateCharacters(project.data.characters);
    const ids = [...new Set([...cast.flatMap(character => character.assetId ? [character.assetId] : []), ...products as string[], ...(affiliate ? [affiliateMode(affiliate).model ? affiliate.presenterAssetId : '', affiliate.backgroundAssetId, ...(affiliate.contentStyle === 'lookbook' ? affiliate.outfitAssetIds : [])].filter(Boolean) : [])])];
    this.validateInputRefs({ refIds: ids }); return ids;
  }
  private runTasks(ids: string[]): void {
    if (!this.license().valid) throw new Error('Cần kích hoạt bản quyền MaiStudio');
    for (const id of ids) {
      const task = this.store.task(id); this.validateRefs([task]);
      if (['pipeline', 'plan'].includes(task.kind)) this.assertProductionAdmission(task.projectId, String(task.input.stage || (task.kind === 'plan' ? 'plan' : 'all')), task.id);
      if (['image', 'video', 'image-to-video'].includes(task.kind) && !task.accountId && !this.store.settings().providers.image.baseUrl) {
        const account = this.store.accounts()[0]; if (!account) throw new NeedsInputError('Thêm tài khoản Muse hoặc cấu hình image provider trước khi chạy');
        this.store.updateTask(id, { accountId: account.id });
      }
    }
    this.queue.enqueue(ids);
  }
  private assertProductionAdmission(projectId: string, stage: string, ownId = ''): void {
    if (stage === 'render') return;
    const project = this.store.project(projectId);
    if (project.kind === 'affiliate' && project.data.affiliate !== undefined) this.validateAffiliateRefs(project.data);
    if (affiliateDubbing(project) && !['render', 'check'].includes(stage)) this.client('voice');
    const family = project.data.seriesParentId || project.id;
    const pending = this.store.tasks().find(task => {
      if (task.id === ownId || task.status === 'succeeded' || !['pipeline', 'plan'].includes(task.kind)) return false;
      const other = this.store.project(task.projectId); if ((other.data.seriesParentId || other.id) !== family) return false;
      const previousStage = String(task.input.stage || (task.kind === 'plan' ? 'plan' : 'all'));
      return hasPendingAdmission(object(task.checkpoint.qualityControl ?? {})) || (stage === 'all' || previousStage === 'all' || stage === previousStage || ['images', 'characters'].includes(stage) && ['images', 'characters'].includes(previousStage)) && hasPendingAdmission(task.checkpoint);
    });
    if (pending) throw new NeedsInputError(`Task ${pending.id} còn yêu cầu provider chưa rõ kết quả; đối soát và tiếp tục task đó trước khi gửi việc mới`);
  }
  private async plan(input: Record<string, unknown>): Promise<Project> {
    const project = this.store.project(text(input.projectId, 'Project ID', 100)); const data = { ...project.data };
    if (typeof input.prompt === 'string') data.script = text(input.prompt, 'Kịch bản', 1024 * 1024);
    if (typeof input.subtitle === 'string') { parseSrt(input.subtitle); data.subtitle = input.subtitle; }
    for (const key of ['product', 'shots', 'characters', 'episodes', 'voiceId', 'renderMode'] as const) if (input[key] !== undefined) data[key] = input[key];
    if (input.shots === undefined && (input.prompt !== undefined || input.subtitle !== undefined || input.product !== undefined)) delete data.shots;
    if (data.characters !== undefined) data.characters = validateCharacters(data.characters);
    if (project.kind === 'series' && data.episodes !== undefined) validateEpisodes(data.episodes);
    else if (data.visualGrouped === true && Array.isArray(data.visualGroups)) data.shots = data.visualGroups.map((value, index) => { const group = object(value); return { id: `shot-${index + 1}`, prompt: text(group.text, 'Visual group text', 32768), start: group.start, duration: Number(group.end) - Number(group.start) }; });
    else data.shots = buildShots(data);
    data.planning = { source: 'manual', at: Date.now() }; data.planningNeedsUpdate = false;
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
    if (task.kind === 'model-prepare') { await this.offline.prepare(context.signal, (progress, message) => context.progress(progress, message)); return { outputIds: [], message: 'Mô hình giọng local đã xác minh và sẵn sàng' }; }
    if (task.kind === 'product-import') return this.executeProductImport(task, context);
    if (task.kind === 'image' || task.kind === 'video' || task.kind === 'image-to-video' || task.kind === 'music') return this.generate(task, context);
    if (task.kind === 'plan') return this.executePlan(task, context);
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
    if (task.kind === 'extract-audio') {
      const output = join(folder, 'audio.wav'); const info = await this.withMedia(context.signal, () => this.media().extractAudio(paths[0], output, {}, context));
      const asset = await this.store.importAsset(output, { projectId: task.projectId, taskId: task.id, duration: info.duration }, context.signal);
      context.checkpoint({ outputIds: [asset.id] }); await this.exportOutput(asset, task, context.signal); return { outputIds: [asset.id] };
    }
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
  private async executeProductImport(task: Task, context: TaskContext): Promise<TaskResult> {
    context.signal.throwIfAborted();
    const original = this.store.project(task.projectId);
    if (original.kind !== 'affiliate') throw new Error('Shopee import requires an Affiliate project');
    const link = await resolveShopeeLink(task.input.url, context.signal);
    let capture = task.checkpoint.capture ?? task.input.capture;
    if (!capture) {
      if (!this.store.settings().providers.shopee.baseUrl) throw new NeedsInputError('Chưa cấu hình API Shopee. Mở sản phẩm trong Chrome thường, bấm nút Lấy SP rồi dán dữ liệu vào MaiStudio');
      context.progress(0.05, 'Đang đọc sản phẩm qua API Shopee');
      capture = shopeeOffer(await this.client('shopee').shopeeProduct(link.url, context.signal), link.url);
    }
    const candidate = object(capture), product = parseProducts(JSON.stringify(candidate.product), 'json')[0], source = object(candidate.source);
    const identity = shopeeLink(product.url);
    if (identity.short || identity.url !== link.url || source.url !== link.url || !['page', 'cached', 'api'].includes(String(source.method))) throw new Error('Product capture identity does not match requested Shopee link');
    text(product.name ?? product.title, 'Product name', 2000);
    if (!Array.isArray(candidate.images) || candidate.images.length > MAX_SHOPEE_IMAGES) throw new Error('Invalid product image count');
    const images = [...new Set(candidate.images.map(shopeeImageUrl))];
    if (!images.length) throw new NeedsInputError('Chưa có ảnh thật sản phẩm. Mở phần ảnh trên trang Shopee, lấy lại dữ liệu rồi nhập');
    const warnings = Array.isArray(source.warnings) ? source.warnings.map(value => text(value, 'Product warning', 1000)) : [];
    const missingFields = Array.isArray(source.missingFields) ? source.missingFields.map(value => text(value, 'Missing field', 64)) : [];
    context.checkpoint({ capture: { product, images, source } });
    const imported = { ...object(task.checkpoint.productImages ?? {}) }, imageErrors: Array<{ url: string; message: string }> = [];
    const folder = join(this.store.root, 'work', task.id); await mkdir(folder, { recursive: true });
    for (const [index, url] of images.entries()) {
      context.signal.throwIfAborted();
      if (typeof imported[url] === 'string' && this.store.assets().some(asset => asset.id === imported[url] && asset.projectId === task.projectId && asset.taskId === task.id && asset.mime.startsWith('image/'))) continue;
      try {
        const image = await downloadShopeeImage(url, context.signal);
        const file = join(folder, `product-${index + 1}-${randomUUID()}${image.extension}`);
        try {
          await writeFile(file, image.buffer, { mode: 0o600, flag: 'wx' });
          await this.withMedia(context.signal, () => this.media().validateImage(file, context.signal));
          const asset = await this.store.importAsset(file, { projectId: task.projectId, taskId: task.id }, context.signal);
          if (!asset.mime.startsWith('image/')) throw new Error('Product reference must be an image');
          imported[url] = asset.id; context.checkpoint({ productImages: imported });
        } finally { await rm(file, { force: true }); }
      } catch (error) {
        context.signal.throwIfAborted(); imageErrors.push({ url, message: error instanceof Error && /^(Invalid Shopee image|Shopee image|Product image)/.test(error.message) ? error.message : 'Không tải hoặc giải mã được ảnh sản phẩm' });
        context.checkpoint({ productImageErrors: imageErrors });
      }
      context.progress(0.1 + (index + 1) / images.length * 0.8, `Đã xử lý ${index + 1}/${images.length} ảnh sản phẩm`);
    }
    const outputIds = images.map(url => imported[url]).filter((id): id is string => typeof id === 'string' && this.store.assets().some(asset => asset.id === id && asset.projectId === task.projectId && asset.taskId === task.id && asset.mime.startsWith('image/')));
    if (!outputIds.length) throw new NeedsInputError('Không nhập được ảnh thật sản phẩm; dữ liệu dự án cũ được giữ nguyên. ' + (imageErrors[0]?.message || 'Kiểm tra ảnh nguồn rồi thử lại'));
    const current = this.store.project(task.projectId);
    if (this.contentFingerprint(current.data) !== task.input.inputHash) throw new NeedsInputError('Dự án đã được chỉnh trong lúc nhập sản phẩm; giữ ảnh ở task để anh kiểm tra, không ghi đè dữ liệu mới');
    const productSource = { ...source, inputUrl: link.inputUrl, url: link.url, shopId: link.shopId, itemId: link.itemId, taskId: task.id, importedAt: Date.now(), warnings, missingFields, imageCount: images.length, importedImageCount: outputIds.length, imageErrors };
    this.store.transaction(() => {
      context.signal.throwIfAborted();
      this.store.saveProject({ ...current, data: { ...current.data, product, productAssetIds: outputIds, productSource, productionStale: !!current.data.production, planningNeedsUpdate: true } });
      context.checkpoint({ outputIds, productApplied: true });
    });
    return { outputIds, message: `Đã nhập sản phẩm và ${outputIds.length}/${images.length} ảnh thật${imageErrors.length ? '; có ảnh lỗi, xem nguồn sản phẩm' : ''}${missingFields.length ? '; xem các trường nguồn chưa cung cấp' : ''}` };
  }
  private async executePipeline(task: Task, context: TaskContext, repair?: Record<string, string>): Promise<TaskResult> {
    let project = object(task.input.projectSnapshot) as unknown as Project;
    const stage = String(task.input.stage ?? 'all');
    const latest = this.store.project(project.id);
    if (task.checkpoint.workingHash && this.contentFingerprint(latest.data) === task.checkpoint.workingHash) project = latest;
    else if (this.contentFingerprint(latest.data) !== this.contentFingerprint(project.data)) throw new NeedsInputError('Dự án đã thay đổi sau khi nhận việc; chạy task mới để dùng bản chỉnh');
    const dubbing = affiliateDubbing(project);
    if (dubbing && !['render', 'check'].includes(stage)) this.client('voice');
    if (project.data.planningNeedsUpdate === true && ['images', 'videos', 'check', 'render'].includes(stage)) throw new NeedsInputError('Cần cập nhật kế hoạch AI hoặc chỉnh storyboard trước khi tiếp tục bước này');
    if (stage === 'music') return this.executeMusic(task, project, context);
    if (project.kind === 'series') {
      const episodes = validateEpisodes(project.data.episodes);
      if (episodes.length > 30) throw new Error('Series giới hạn 30 tập trước khi tạo media');
      if (stage === 'characters') return this.executeCharacters(task, project, context);
      if (stage === 'all' && project.data.musicMode === 'auto') { await this.executeMusic(task, project, context); project = this.store.project(project.id); }
      if (['all', 'images'].includes(stage) && validateCharacters(project.data.characters).length) await this.executeCharacters(task, project, context);
      const checkpoints = object(task.checkpoint.episodes ?? {}); const outputIds: string[] = [];
      const rendering = ['all', 'render'].includes(stage);
      const available = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(id => typeof id === 'string' && this.store.assets().some(asset => asset.id === id));
      for (const [index, episode] of episodes.entries()) {
        context.signal.throwIfAborted(); const source = object((project.data.episodes as unknown[])[index]);
        const prefix = `${encodeURIComponent(project.id)}/${encodeURIComponent(episode.id)}/`;
        const selected = Array.isArray(task.input.shotIds) ? (task.input.shotIds as string[]).filter(id => id.startsWith(prefix)) : undefined;
        if (selected && !selected.length) continue;
        const previous = this.store.projects().find(value => value.kind === 'film' && value.data.seriesParentId === project.id && value.data.episodeId === episode.id);
        const shared = { ...project.data }; for (const key of ['episodes', 'production', 'outputIds', 'qualityReviews', 'shots', 'scenes', 'script', 'planning']) delete shared[key];
        const production = { ...object(previous?.data.production ?? {}) }; const parentProduction = object(this.store.project(project.id).data.production ?? {});
        production.characterImages = { ...object(production.characterImages ?? {}), ...object(parentProduction.characterImages ?? {}) };
        production.fingerprints = { ...object(production.fingerprints ?? {}), ...Object.fromEntries(Object.entries(object(parentProduction.fingerprints ?? {})).filter(([key]) => key.startsWith('character/'))) };
        const data: Record<string, unknown> = { ...previous?.data, ...shared, ...source, production, seriesParentId: project.id, episodeId: episode.id };
        if (source.shots !== undefined || source.scenes !== undefined) {
          data.planningNeedsUpdate = false;
          if (source.scenes !== undefined && source.shots === undefined) delete data.shots;
        } else if (previous && ['ai-api', 'muse-browser'].includes(String(object(previous.data.planning ?? {}).source)) && (source.script !== previous.data.script || previous.data.planningNeedsUpdate === true)) {
          data.planningNeedsUpdate = true; data.productionStale = true;
        }
        const film = this.store.saveProject({ id: previous?.id, name: `${project.name} — ${episode.name}`, kind: 'film', data });
        const checkpoint = object(checkpoints[episode.id] ?? {});
        const filmHash = this.contentFingerprint(film.data);
        const episodeContext: TaskContext = { signal: context.signal,
          progress: (progress, message) => context.progress((index + progress) / episodes.length, `${episode.name}: ${message}`),
          checkpoint: value => { checkpoints[episode.id] = { ...object(checkpoints[episode.id] ?? {}), ...value }; context.checkpoint({ episodes: checkpoints }); },
        };
        if (rendering && checkpoint.rawInputHash && checkpoint.rawInputHash !== filmHash) throw new NeedsInputError('Film đã đổi sau khi lưu raw output; chạy task mới');
        let ids = rendering && available(checkpoint.rawOutputIds) ? checkpoint.rawOutputIds : available(checkpoint.outputIds) ? checkpoint.outputIds : [];
        // A completed concat is never a substitute for a missing raw checkpoint.
        if (rendering && ids[0] === object(production.recap ?? {}).assetId && !available(checkpoint.rawOutputIds)) ids = [];
        if (!ids.length && rendering && film.data.productionStale !== true) {
          const rendered = object(production.render ?? {}); const recap = object(production.recap ?? {});
          if (rendered.inputHash === filmHash && available([rendered.assetId])) {
            ids = recap.assetId === rendered.assetId ? recap.inputHash === filmHash && available(recap.rawOutputIds) ? recap.rawOutputIds : [] : [rendered.assetId as string];
          }
        }
        if (!ids.length) {
          const child: Task = { ...task, input: { ...task.input, projectSnapshot: film, ...(selected ? { shotIds: selected.map(id => `${encodeURIComponent(film.id)}/${id.slice(prefix.length)}`) } : {}) }, checkpoint };
          const result = await this.executePipeline(child, episodeContext);
          ids = result.outputIds;
        }
        if (rendering) {
          const current = this.store.project(film.id); const currentHash = this.contentFingerprint(current.data);
          episodeContext.checkpoint({ rawOutputIds: ids, rawInputHash: currentHash });
          if (project.data.recap === true && index > 0) {
            const priorFilm = this.store.projects().find(value => value.kind === 'film' && value.data.seriesParentId === project.id && value.data.episodeId === episodes[index - 1].id);
            if (!priorFilm) throw new NeedsInputError('Dựng tập liền trước trước khi tạo recap');
            ids = await this.appendRecap({ ...task, checkpoint: object(checkpoints[episode.id]) }, current, priorFilm, ids, episodeContext);
          } else {
            const savedProduction = { ...object(current.data.production ?? {}) }; const recap = object(savedProduction.recap ?? {});
            if (recap.inputHash === currentHash && JSON.stringify(recap.rawOutputIds) === JSON.stringify(ids)) {
              savedProduction.render = { ...object(savedProduction.render ?? {}), assetId: ids[0], inputHash: currentHash };
              if (typeof recap.rawSubtitle === 'string' && recap.rawSubtitle) { savedProduction.subtitle = recap.rawSubtitle; savedProduction.subtitleInputHash = currentHash; }
              else { delete savedProduction.subtitle; delete savedProduction.subtitleInputHash; }
              delete savedProduction.recap;
            }
            this.store.transaction(() => {
              this.store.saveProject({ ...current, data: { ...current.data, production: savedProduction, outputIds: ids } });
              episodeContext.checkpoint({ outputIds: ids });
            });
          }
        }
        outputIds.push(...ids);
      }
      context.checkpoint({ outputIds }); return { outputIds };
    }
    if (stage === 'plan') return this.executePlan({ ...task, kind: 'plan', input: { ...task.input, projectSnapshot: project } }, context);
    if (project.kind === 'dub') return this.executeDub(task, project, context);
    if (stage === 'check') {
      if (project.kind === 'affiliate' && project.data.affiliate !== undefined && (!project.data.affiliateReview || object(project.data.affiliateReview).stale === true)) project = await this.reviewAffiliateProject(task, project, context);
      const production = object(project.data.production ?? {});
      if (project.kind === 'affiliate' && project.data.affiliate !== undefined && !Object.keys(object(production.images ?? {})).length && !Object.keys(object(production.videos ?? {})).length && !buildShots(project.data).some(shot => shot.assetId || shot.videoAssetId)) return { outputIds: [], message: 'Đã đối chiếu kịch bản đã chỉnh với nguồn sản phẩm; chưa có media để review' };
      return this.executeReview(task, project, context);
    }
    if (project.data.storyMode === true && !(project.kind === 'affiliate' && project.data.affiliate !== undefined) && ['speech', 'all'].includes(stage)) {
      const narration = await this.executeNarration(task, project, context);
      if (stage === 'speech') return narration;
      project = this.store.project(project.id);
    }
    if (stage === 'all' && (project.data.planningNeedsUpdate === true || (project.kind === 'affiliate' && project.data.affiliate !== undefined && (!Array.isArray(project.data.shots) || !project.data.shots.length)) || (!project.data.shots && !project.data.scenes && !project.data.subtitle))) {
      let state = object(task.checkpoint.plan ?? {});
      await this.executePlan({ ...task, kind: 'plan', input: { ...task.input, projectSnapshot: project }, checkpoint: state }, { ...context, checkpoint: value => {
        state = { ...state, ...value }; context.checkpoint({ plan: state, workingHash: this.contentFingerprint(this.store.project(project.id).data) });
      } });
      project = this.store.project(project.id);
    }
    if (['all', 'images', 'videos', 'characters'].includes(stage) && project.kind === 'affiliate' && project.data.affiliate !== undefined && (!project.data.affiliateReview || object(project.data.affiliateReview).stale === true)) project = await this.reviewAffiliateProject(task, project, context);
    if (stage === 'characters') return this.executeCharacters(task, project, context);
    if (stage === 'all' && project.data.musicMode === 'auto') {
      await this.executeMusic(task, project, context); project = this.store.project(project.id);
    }
    if (['all', 'images'].includes(stage) && project.kind === 'affiliate' && project.data.affiliate !== undefined) project = await this.alignAffiliateMusic(task, project, context);
    if (!repair && ['all', 'images'].includes(stage) && validateCharacters(project.data.characters).length) await this.executeCharacters(task, project, context);
    const production = structuredClone(object(this.store.project(project.id).data.production ?? {})); const fingerprints = object(production.fingerprints ?? {}); production.fingerprints = fingerprints;
    const characters = validateCharacters(project.data.characters).map(character => {
      const id = object(production.characterImages ?? {})[character.id]; const signature = this.characterFingerprint(project, character);
      return !character.assetId && fingerprints[`character/${character.id}`] === signature && typeof id === 'string' && this.store.assets().some(asset => asset.id === id) ? { ...character, assetId: id } : character;
    });
    const steps = pipelineSteps({ ...project, data: { ...project.data, characters } }, { speech: !['images', 'videos'].includes(stage) }); const results = object(task.checkpoint.steps ?? {}); const clips: Array<{ path: string; duration: number; start?: number; trimStart?: number; trimEnd?: number; base?: string }> = []; const voices: Array<{ path: string; start: number; duration?: number }> = []; const nativeCues: ReturnType<typeof parseSrt> = [];
    const selected = Array.isArray(task.input.shotIds) ? new Set(task.input.shotIds as string[]) : undefined;
    const stageIds: string[] = [];
    const projectHash = this.contentFingerprint(project.data);
    const remember = (): void => {
      const latest = this.store.project(project.id);
      if (this.contentFingerprint(latest.data) !== projectHash) throw new NeedsInputError('Dự án đã được chỉnh trong lúc chạy; kết quả giữ ở task để đối soát trước khi áp dụng');
      this.store.saveProject({ ...latest, data: { ...latest.data, production } });
    };
    const stills = new Map<string, string>(); let position = 0;
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index]; context.signal.throwIfAborted();
      const base = step.id.replace(/\/(image|video|speech)$/, '');
      if (selected && !selected.has(base) && !selected.has(decodeURIComponent(base.split('/').at(-1)!))) continue;
      const bucket = step.kind === 'image' ? 'images' : step.kind === 'video' ? 'videos' : 'speech';
      const savedAssets = object(production[bucket] ?? {}); production[bucket] = savedAssets;
      const completedImage = object(production.images ?? {})[base];
      const imageStep = steps.find(candidate => candidate.id === `${base}/image`);
      const imageSignature = imageStep ? createHash('sha256').update(JSON.stringify({ ...imageStep, refIds: [...new Set(imageStep.refIds)], ratio: project.data.ratio ?? '16:9' })).digest('hex') : '';
      if (imageStep && fingerprints[imageStep.id] === imageSignature && typeof completedImage === 'string' && this.store.assets().some(asset => asset.id === completedImage)) stills.set(base, completedImage);
      const requestedKind = stage === 'images' ? 'image' : stage === 'videos' ? 'video' : stage === 'speech' ? 'speech' : undefined;
      if (requestedKind && step.kind !== requestedKind) continue;
      if (project.data.renderMode === 'slideshow' && step.kind === 'video' && ['all', 'render'].includes(stage)) {
        const imageId = stills.get(base) || (!imageStep ? step.refIds[0] : '');
        if (!imageId || !this.store.asset(imageId).mime.startsWith('image/')) throw new Error('Shot slideshow cần ảnh hợp lệ');
        clips.push({ path: this.store.assetPath(imageId), duration: step.duration, start: step.start }); position = (step.start ?? position) + step.duration; continue;
      }
      let saved = results[step.id] ? object(results[step.id]) : {};
      let assetId = typeof saved.assetId === 'string' && this.store.assets().some(asset => asset.id === saved.assetId) ? saved.assetId : '';
      if (step.kind === 'video' && step.videoAssetId) { if (!this.store.asset(step.videoAssetId).mime.startsWith('video/')) throw new Error('Clip nguồn phải là video asset'); assetId = step.videoAssetId; }
      const refs = step.kind === 'video' && stills.has(base) ? [stills.get(base)!] : [...step.refIds];
      if (stage === 'videos' && imageStep && !stills.has(base)) throw new Error(`Chạy bước ảnh cho shot ${base} trước khi tạo video`);
      const voiceInput = object(object(production.affiliateSpeechInputs ?? {})[base] ?? {});
      const signature = dubbing && step.kind === 'speech' ? this.affiliateSpeechFingerprint(step.prompt, dubbing.voiceId, stage === 'render' && voiceInput.assetId === savedAssets[base] ? voiceInput.provider : undefined) : createHash('sha256').update(JSON.stringify({ ...step, refIds: [...new Set(refs)], ratio: project.data.ratio ?? '16:9' })).digest('hex');
      if (typeof saved.signature === 'string' && saved.signature !== signature) {
        if (hasPendingAdmission(saved)) throw new NeedsInputError('Input của shot đã đổi khi provider còn xử lý; đối soát lượt cũ trước khi gửi lại');
        saved = {}; assetId = step.kind === 'video' && step.videoAssetId ? step.videoAssetId : '';
        results[step.id] = { signature }; context.checkpoint({ steps: results });
      }
      if ((!assetId || typeof saved.assetId === 'string') && (task.input.force !== true || typeof saved.assetId === 'string') && fingerprints[step.id] === signature && typeof savedAssets[base] === 'string' && this.store.assets().some(asset => asset.id === savedAssets[base])) assetId = savedAssets[base] as string;
      if (!assetId) {
        if (stage === 'render') {
          if (step.kind === 'image') continue;
          if (dubbing && step.kind === 'speech') throw new NeedsInputError(`Chưa có lời đọc hiện tại cho ${base}; chạy bước speech trước khi dựng`);
          throw new Error(`Chưa có ${bucket} cho shot ${base}; chạy bước tương ứng trước khi dựng`);
        }
        const childContext: TaskContext = { signal: context.signal,
          progress: (progress, message) => context.progress((index + progress) / Math.max(steps.length + 1, 1), `${index + 1}/${steps.length}: ${message}`),
          checkpoint: value => { results[step.id] = { ...saved, ...object(results[step.id] ?? {}), ...value, signature }; context.checkpoint({ steps: results }); },
        };
        const prompt = repair?.[base] && step.kind !== 'speech' ? text(`${step.prompt}\nCorrect the following observed problems while keeping the same scene, story, cast and requested action: ${repair[base]}`, 'Quality repair prompt', 32768) : step.prompt;
        const child: Task = { ...task, kind: step.kind, prompt, input: { refIds: [...new Set(refs)], voiceId: step.voiceId, ratio: project.data.ratio ?? '16:9' }, checkpoint: saved };
        if (repair) { results[step.id] = { ...object(results[step.id] ?? {}), generationPrompt: prompt }; context.checkpoint({ steps: results }); }
        const result = step.kind === 'speech' ? await this.execute(child, childContext) : await this.generate(child, childContext);
        assetId = result.outputIds[0]; results[step.id] = { ...object(results[step.id] ?? {}), assetId, signature }; context.checkpoint({ steps: results });
      }
      if (dubbing && step.kind === 'speech') production.affiliateSpeechInputs = { ...object(production.affiliateSpeechInputs ?? {}), [base]: { assetId, provider: this.store.settings().providers.voice.baseUrl ? this.store.settings().providers.voice : voiceInput.provider } };
      savedAssets[base] = assetId; fingerprints[step.id] = signature; remember(); stageIds.push(assetId);
      if (step.kind === 'image') stills.set(base, assetId);
      else if (step.kind === 'video') {
        const path = this.store.assetPath(assetId); const info = await this.media().probe(path, context.signal); let duration = Math.min(step.duration, info.duration); let trimStart = 0;
        const start = step.start ?? position;
        if (!dubbing && project.data.nativeAudio === true && step.dialogue) {
          if (!info.hasAudio) throw new NeedsInputError(`Clip ${base} chưa có lời thoại; kiểm tra hoặc tạo lại trước khi dựng`);
          const analysis = await this.withMedia(context.signal, () => analyzeSpeech(path, this.media().executablePath, context.signal));
          if (!analysis.parts.length) throw new NeedsInputError(`Clip ${base} chưa phát hiện lời nói để căn hình và phụ đề`);
          const window = clipWindow(project.data, info.duration, step.duration, analysis, project.kind === 'affiliate' && project.data.affiliate !== undefined); trimStart = window.start; duration = window.duration;
          if (window.speechOverflow && (stage === 'render' || project.data.autoChecks !== true)) throw new NeedsInputError(`Lời thoại shot ${base} vượt khoảng dựng; review và tạo lại clip trước khi xuất để không cắt mất lời`);
          nativeCues.push({ index: nativeCues.length + 1, start: start + analysis.parts[0].start - trimStart, end: Math.min(start + duration, start + analysis.parts.at(-1)!.end - trimStart), text: step.dialogue });
        }
        clips.push({ path, duration: dubbing ? step.duration : duration, start: dubbing || project.data.nativeAudio === true ? start : step.start, ...(dubbing ? { base } : trimStart || project.data.nativeAudio === true ? { trimStart, trimEnd: trimStart + duration } : {}) }); position = start + (dubbing ? step.duration : duration);
      }
      else if (!dubbing) voices.push({ path: this.store.assetPath(assetId), start: step.start ?? Math.max(0, position - step.duration), duration: step.duration });
    }
    if (!repair && stage === 'videos' && project.data.autoChecks === true) {
      await this.reviewAndRepair(task, this.store.project(project.id), context);
      const videos = object(object(this.store.project(project.id).data.production ?? {}).videos ?? {});
      const outputIds = steps.filter(step => step.kind === 'video').filter(step => !selected || selected.has(step.id.replace(/\/video$/, '')) || selected.has(decodeURIComponent(step.id.split('/').at(-2)!)))
        .map(step => step.videoAssetId ?? videos[step.id.replace(/\/video$/, '')]).filter((id): id is string => typeof id === 'string');
      context.checkpoint({ outputIds }); return { outputIds, message: 'Đã tạo và review clip; xem các đánh giá nội dung trước khi dựng' };
    }
    if (['images', 'videos', 'speech'].includes(stage)) { context.checkpoint({ outputIds: [...new Set(stageIds)] }); return { outputIds: [...new Set(stageIds)], message: `Hoàn tất bước ${stage}` }; }
    if (!clips.length) throw new Error('Pipeline chưa có clip để dựng');
    if (dubbing) {
      project = await this.prepareAffiliateDubs(task, this.store.project(project.id), context);
      production.affiliateDubs = object(object(project.data.production).affiliateDubs);
      for (const clip of clips) {
        clip.path = this.store.assetPath(String(object(object(production.affiliateDubs)[clip.base!]).assetId));
        if (steps.find(step => step.id === `${clip.base}/video`)?.dialogue) {
          const speech = await this.withMedia(context.signal, () => analyzeSpeech(clip.path, this.media().executablePath, context.signal));
          if (speech.parts.length) nativeCues.push({ index: nativeCues.length + 1, start: (clip.start ?? 0) + speech.parts[0].start, end: (clip.start ?? 0) + Math.min(clip.duration, speech.parts.at(-1)!.end), text: steps.find(step => step.id === `${clip.base}/video`)!.dialogue! });
        }
      }
    }
    if (stage === 'all' && project.data.autoChecks === true) {
      await this.reviewAndRepair(task, this.store.project(project.id), context);
      let rendered = object(task.checkpoint.qualityRender ?? {});
      return this.executePipeline({ ...task, input: { ...task.input, projectSnapshot: this.store.project(project.id), stage: 'render', force: false }, checkpoint: rendered }, { ...context, checkpoint: value => { rendered = { ...rendered, ...value }; context.checkpoint({ qualityRender: rendered }); } });
    }
    const narration = object(production.narration ?? {});
    if (!dubbing && typeof narration.assetId === 'string' && project.data.narrationMode === 'source') {
      const path = this.store.assetPath(narration.assetId); const info = await this.media().probe(path, context.signal);
      const end = clips.reduce((end, clip) => (clip.start ?? end) + clip.duration, 0);
      voices.push({ path, start: 0, duration: Math.min(info.duration, end) });
    }
    const folder = join(this.store.root, 'work', task.id); await mkdir(folder, { recursive: true }); const output = join(folder, 'pipeline.mp4');
    const mediaContext: TaskContext = { ...context, progress: (progress, message) => context.progress(0.9 + progress * 0.09, message) };
    const dimensions: Record<string, [number, number]> = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [1024, 1024], '4:3': [1024, 768], '3:4': [768, 1024] };
    const [width, height] = dimensions[String(project.data.ratio || '16:9')] ?? dimensions['16:9'];
    const options: MediaOptions = { width: Number(project.data.width) || width, height: Number(project.data.height) || height, fps: Number(project.data.fps) || 24,
      fit: project.data.fit === 'crop' ? 'crop' : 'pad', keepAudio: dubbing ? true : typeof project.data.keepAudio === 'boolean' ? project.data.keepAudio : undefined,
      ...(!dubbing && project.data.voiceVolume !== undefined ? { voiceVolume: project.data.voiceVolume as number } : {}),
      fadeIn: Number(project.data.fadeIn) || 0, fadeOut: Number(project.data.fadeOut) || 0, ducking: project.data.musicDucking === true, motion: project.data.motion === 'kenburns' ? 'kenburns' : 'none' };
    if (project.data.musicId) {
      const music = this.store.asset(text(project.data.musicId, 'Music ID', 100)); if (!music.mime.startsWith('audio/')) throw new Error('Nhạc nền phải là audio asset'); options.musicPath = this.store.assetPath(music.id); options.volume = Number(project.data.musicVolume ?? 0.2);
    }
    const affiliate = project.kind === 'affiliate' && project.data.affiliate !== undefined ? readAffiliateSettings(project.data.affiliate) : undefined;
    if (affiliate) options.subtitleMarginV = 52;
    const title = !affiliate && typeof project.data.titleCard === 'string' ? project.data.titleCard.trim() : '';
    const ending = !affiliate && typeof project.data.endCard === 'string' ? project.data.endCard.trim() : '';
    const product = project.data.product && project.data.productOverlay !== false ? object(project.data.product) : undefined;
    const overlayText = product ? (affiliate ? [affiliate.showPrice ? product.price : '', affiliate.adLabel ? (project.data.language === 'en' ? 'Advertisement' : 'Quảng cáo') : '', affiliate.aiLabel ? (project.data.language === 'en' ? 'AI visuals' : 'Hình ảnh AI') : ''] : [product.price, product.cta]).filter(value => (typeof value === 'string' || typeof value === 'number') && String(value).trim()).join(' · ') : '';
    const cards: Parameters<typeof renderCards>[0] = [];
    const intro = join(folder, 'title.png'); const outro = join(folder, 'end.png'); const overlay = join(folder, 'product-overlay.png');
    if (title) cards.push({ title, output: intro, width: options.width!, height: options.height! });
    if (ending) cards.push({ title: ending, output: outro, width: options.width!, height: options.height! });
    if (product && (!affiliate || affiliate.screenText)) cards.push({ title: String(affiliate ? project.data.suggestedTitle || product.name || product.title || project.name : product.name || product.title || project.name), body: overlayText, overlay: true, compact: !!affiliate, output: overlay, width: options.width!, height: options.height! });
    if (affiliate?.screenText && affiliate.endCard) cards.push({ title: String(project.data.suggestedTitle || object(project.data.product ?? {}).name || object(project.data.product ?? {}).title || project.name), body: [affiliate.cta, affiliate.affiliateUrl ? (project.data.language === 'en' ? 'Product link in the description' : 'Liên kết sản phẩm trong phần mô tả') : '', overlayText].filter(Boolean).join('\n'), output: outro, width: options.width!, height: options.height! });
    if (cards.length) await this.withMedia(context.signal, () => renderCards(cards, this.store.settings().browserPath, context.signal));
    if (product && (!affiliate || affiliate.screenText)) options.overlayPath = overlay;
    if (affiliate?.screenText && affiliate.endCard) {
      const end = clips.reduce((end, clip) => (clip.start ?? end) + clip.duration, 0);
      options.overlays = [{ path: outro, start: Math.max(0, end - 2), end }];
    }
    if (affiliate) {
      const captionEnd = options.overlays?.[0]?.start ?? Infinity;
      const captions = affiliateCaptionCues(project, nativeCues).map(cue => ({ ...cue, end: Math.min(cue.end, captionEnd) })).filter(cue => cue.end > cue.start);
      if (captions.length) { const path = join(folder, 'affiliate-captions.srt'); await writeFile(path, formatSrt(captions)); options.captionPath = path; }
      options.flashes = buildShots(project.data).filter(shot => shot.transition === 'flash' && Number(shot.start) > 0).map(shot => Number(shot.start));
    }
    const titleSeconds = Number(project.data.titleDuration ?? 2); const endSeconds = Number(project.data.endDuration ?? 2);
    if (![titleSeconds, endSeconds].every(value => Number.isFinite(value) && value >= 0.5 && value <= 15)) throw new Error('Thời lượng thẻ phải từ 0.5–15 giây');
    const titleOffset = title ? titleSeconds : 0;
    const sourceCues = nativeCues.length ? nativeCues : !affiliate && typeof project.data.subtitle === 'string' ? parseSrt(project.data.subtitle) : [];
    const subtitle = sourceCues.length ? formatSrt(sourceCues.map(cue => ({ ...cue, start: cue.start + titleOffset, end: cue.end + titleOffset }))) : undefined;
    if (subtitle) { production.subtitle = subtitle; production.subtitleInputHash = projectHash; }
    else { delete production.subtitle; delete production.subtitleInputHash; }
    remember();
    if (title || ending) {
      let cursor = 0;
      for (const clip of clips) { const original = clip.start ?? cursor; clip.start = original + titleOffset; cursor = original + clip.duration; }
      for (const voice of voices) voice.start += titleOffset;
      const cardClip = async (path: string, name: string, duration: number): Promise<string> => {
        if (project.data.renderMode === 'slideshow') return path;
        const video = join(folder, name + '.mp4'); await this.withMedia(context.signal, () => this.media().slideshow([{ path, duration }], video, { width: options.width, height: options.height, fps: options.fps }, mediaContext)); return video;
      };
      if (ending) clips.push({ path: await cardClip(outro, 'end', endSeconds), duration: endSeconds, start: cursor + titleOffset });
      if (title) clips.unshift({ path: await cardClip(intro, 'title', titleSeconds), duration: titleSeconds, start: 0 });
    }
    if (project.data.burnSubtitles === true && (!affiliate || affiliate.screenText) && typeof subtitle === 'string') {
      const captions = join(folder, 'subtitles.srt'); await writeFile(captions, subtitle); options.subtitlePath = captions;
    }
    const visualOptions = voices.length ? { ...options, musicPath: undefined, voiceVolume: undefined } : options;
    if (project.data.renderMode === 'slideshow') await this.withMedia(context.signal, () => this.media().slideshow(clips, output, visualOptions, mediaContext)); else await this.withMedia(context.signal, () => this.media().merge(clips, output, visualOptions, mediaContext));
    let final = output;
    if (voices.length) {
      const rendered = await this.media().probe(output, context.signal);
      const timed = voices.map(voice => ({ ...voice, duration: Math.min(voice.duration ?? rendered.duration - voice.start, rendered.duration - voice.start) }));
      if (timed.some(voice => voice.duration <= 0)) throw new Error('Lời đọc bắt đầu ngoài timeline đã dựng');
      final = join(folder, 'voiced.mp4'); await this.withMedia(context.signal, () => this.media().dub(output, timed, final, { width: options.width, height: options.height, fps: options.fps, musicPath: options.musicPath, volume: options.volume, voiceVolume: options.voiceVolume, ducking: options.ducking, keepAudio: project.data.keepAudio === true }, mediaContext));
    }
    const info = await this.media().probe(final, context.signal); const asset = await this.store.importAsset(final, { taskId: task.id, projectId: task.projectId, duration: info.duration }, context.signal);
    const current = this.store.project(project.id);
    if (this.contentFingerprint(current.data) === projectHash) { production.render = { assetId: asset.id, inputHash: projectHash }; this.store.saveProject({ ...current, data: { ...current.data, production, productionStale: false } }); }
    if (affiliate) {
      const file = join(folder, 'affiliate-caption.txt'); await writeFile(file, affiliatePostText(project), { mode: 0o600 });
      const post = await this.store.importAsset(file, { taskId: task.id, projectId: task.projectId }, context.signal);
      await this.exportOutput(asset, task, context.signal); await this.exportOutput(post, task, context.signal);
      const latest = this.store.project(project.id);
      if (this.contentFingerprint(latest.data) !== projectHash) throw new NeedsInputError('Dự án đã đổi trong lúc xuất Affiliate; giữ output ở công việc để kiểm tra');
      this.store.saveProject({ ...latest, data: { ...latest.data, production: { ...object(latest.data.production ?? {}), affiliatePostAssetId: post.id } } });
      context.checkpoint({ outputIds: [asset.id, post.id] }); return { outputIds: [asset.id, post.id], message: 'Đã xuất video Affiliate và nội dung đăng bài' };
    }
    context.checkpoint({ outputIds: [asset.id] }); await this.exportOutput(asset, task, context.signal); return { outputIds: [asset.id] };
  }
  private async appendRecap(task: Task, film: Project, prior: Project, rawOutputIds: string[], context: TaskContext): Promise<string[]> {
    const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const inputHash = this.contentFingerprint(film.data); const production = object(film.data.production ?? {});
    const old = object(production.recap ?? {}); const state = object(task.checkpoint.recap ?? {});
    if (rawOutputIds.length !== 1 || !this.store.asset(rawOutputIds[0]).mime.startsWith('video/')) throw new NeedsInputError('Recap cần một raw episode video hợp lệ');
    const collect = (previous: Project) => {
      if (previous.data.productionStale === true) throw new NeedsInputError('Output tập trước đang stale; dựng và kiểm tra lại trước khi recap');
      const data = previous.data, saved = object(data.production ?? {}), fingerprints = object(saved.fingerprints ?? {});
      const characters = validateCharacters(data.characters).map(character => {
        const assetId = object(saved.characterImages ?? {})[character.id];
        return !character.assetId && fingerprints[`character/${character.id}`] === this.characterFingerprint(previous, character) && typeof assetId === 'string' ? { ...character, assetId } : character;
      });
      const steps = pipelineSteps({ ...previous, data: { ...data, characters } }, { speech: false });
      return steps.filter(step => step.kind === 'video').map(step => ({ step, base: step.id.replace(/\/video$/, ''), assetId: step.videoAssetId ?? object(saved.videos ?? {})[step.id.replace(/\/video$/, '')] }))
        .filter((value): value is typeof value & { assetId: string } => typeof value.assetId === 'string').slice(-3).map(({ step, base, assetId }) => {
          if (!this.store.asset(assetId).mime.startsWith('video/')) throw new NeedsInputError('Recap source phải là raw video asset');
          const imageStep = steps.find(value => value.id === `${base}/image`); const imageId = object(saved.images ?? {})[base];
          const frameValid = imageStep && fingerprints[imageStep.id] === hash({ ...imageStep, refIds: [...new Set(imageStep.refIds)], ratio: data.ratio ?? '16:9' });
          const refs = frameValid && typeof imageId === 'string' ? [imageId] : step.refIds;
          if (!step.videoAssetId && fingerprints[step.id] !== hash({ ...step, refIds: refs, ratio: data.ratio ?? '16:9' })) throw new NeedsInputError('Raw video tập trước không còn khớp kế hoạch');
          const review = object(data.qualityReviews ?? {})[base]; const reviewed = review === undefined ? undefined : object(review).speech;
          let speech: { start: number; end: number } | undefined;
          if (reviewed !== undefined) {
            const qa = object(reviewed); const expected = hash({ video: assetId, dialogue: step.dialogue, speaker: step.speaker, characters, language: data.language, provider: this.store.settings().providers.asr });
            if (qa.assetId !== assetId || qa.fingerprint !== expected || qa.status === 'fail') throw new NeedsInputError('QA speech tập trước đã cũ hoặc fail; kiểm tra lại clip hiện tại');
            const parts = object(qa.acoustic ?? {}).parts;
            if (!Array.isArray(parts) || !parts.length || parts.length > 1000) throw new NeedsInputError('QA speech chưa có acoustic parts hợp lệ');
            let end = 0;
            for (const raw of parts) { const part = object(raw); if (!Number.isFinite(part.start) || !Number.isFinite(part.end) || Number(part.start) < end || Number(part.end) <= Number(part.start)) throw new NeedsInputError('QA speech span không hợp lệ'); end = Number(part.end); }
            speech = { start: Number(object(parts[0]).start), end: Number(object(parts.at(-1)).end) };
          }
          return { path: this.store.assetPath(assetId), assetId, base, dialogue: step.dialogue, speech, review: reviewed };
        });
    };
    const sources = collect(prior); if (!sources.length) throw new NeedsInputError('Tập liền trước chưa có raw video hợp lệ để recap');
    let rawSubtitle = '';
    if (state.rawSubtitleInputHash === inputHash && typeof state.rawSubtitle === 'string') rawSubtitle = state.rawSubtitle;
    else if (old.inputHash === inputHash && hash(old.rawOutputIds) === hash(rawOutputIds) && typeof old.rawSubtitle === 'string') rawSubtitle = old.rawSubtitle;
    else if (typeof production.subtitle === 'string') {
      if (production.subtitleInputHash !== inputHash) throw new NeedsInputError('Clock phụ đề raw episode đã cũ; dựng lại trước khi prepend recap');
      rawSubtitle = production.subtitle;
    } else if (typeof film.data.subtitle === 'string' && film.data.subtitle.trim()) {
      const offset = typeof film.data.titleCard === 'string' && film.data.titleCard.trim() ? Number(film.data.titleDuration ?? 2) : 0;
      if (!Number.isFinite(offset) || offset < 0 || offset > 15) throw new Error('Invalid title duration');
      rawSubtitle = formatSrt(parseSrt(film.data.subtitle).map(cue => ({ ...cue, start: cue.start + offset, end: cue.end + offset })));
    }
    const fingerprint = hash({ inputHash, priorHash: this.contentFingerprint(prior.data), sources, rawOutputIds, rawSubtitle });
    const rendered = object(production.render ?? {});
    if (old.fingerprint === fingerprint && old.assetId === rendered.assetId && rendered.inputHash === inputHash && typeof old.assetId === 'string' && this.store.assets().some(asset => asset.id === old.assetId) && old.subtitleHash === hash(production.subtitle ?? '')) {
      this.store.assetPath(old.assetId); context.checkpoint({ outputIds: [old.assetId], recap: { ...state, fingerprint, assetId: old.assetId, rawSubtitle, rawSubtitleInputHash: inputHash } }); return [old.assetId];
    }
    context.checkpoint({ rawOutputIds, rawInputHash: inputHash, recap: { ...state, rawSubtitle, rawSubtitleInputHash: inputHash } });
    const folder = join(this.store.root, 'work', task.id); await mkdir(folder, { recursive: true });
    const recapFile = join(folder, `recap-${film.id}.mp4`); const output = join(folder, `episode-recap-${film.id}.mp4`);
    const tools = this.media(); const rawPath = this.store.assetPath(rawOutputIds[0]); const rawInfo = await tools.probe(rawPath, context.signal);
    const options: MediaOptions = { width: rawInfo.width, height: rawInfo.height, fps: Number(film.data.fps) || 24, keepAudio: true };
    const mediaContext: TaskContext = { ...context, progress: (value, message) => context.progress(value, `Recap: ${message}`) };
    try {
      context.progress(0, 'Đang dựng recap từ raw clips tập trước');
      const recap = await this.withMedia(context.signal, () => createRecap(tools, sources, recapFile, options, mediaContext));
      // Episode music/captions/fades are already rendered. The recap keeps raw shot audio without added global music.
      await this.withMedia(context.signal, () => tools.merge([{ path: recap.path }, { path: rawPath }], output, options, mediaContext));
      const info = await tools.probe(output, context.signal); const cues: ReturnType<typeof parseSrt> = [];
      for (const segment of recap.segments) {
        const source = sources[segment.inputIndex]; const speech = source.speech;
        if (speech && source.dialogue && segment.trimStart <= speech.start && segment.trimStart + segment.duration + 1e-6 >= speech.end) {
          const start = segment.start + speech.start - segment.trimStart; const end = Math.min(recap.duration, segment.start + speech.end - segment.trimStart);
          if (end - start >= 0.001) cues.push({ index: cues.length + 1, start, end, text: source.dialogue });
        }
      }
      if (rawSubtitle) for (const cue of parseSrt(rawSubtitle)) {
        if (cue.end > rawInfo.duration + 0.001) throw new NeedsInputError('Clock phụ đề vượt raw episode đã dựng');
        cues.push({ ...cue, index: cues.length + 1, start: cue.start + recap.duration, end: cue.end + recap.duration });
      }
      const subtitle = cues.length ? formatSrt(cues) : undefined;
      const asset = await this.store.importAsset(output, { taskId: task.id, projectId: film.id, duration: info.duration }, context.signal);
      try {
        const current = this.store.project(film.id); const previous = this.store.project(prior.id);
        if (this.contentFingerprint(current.data) !== inputHash || this.contentFingerprint(previous.data) !== this.contentFingerprint(prior.data) || hash(collect(previous)) !== hash(sources)) throw new NeedsInputError('Film hoặc QA nguồn đã đổi trong lúc dựng recap; giữ raw checkpoint để review');
        const nextProduction = { ...object(current.data.production ?? {}) };
        const warnings = sources.filter(source => !source.speech).map(source => `Unreviewed tail fallback: ${source.base}`);
        warnings.push('Recap uses raw shot audio without added global music; existing episode music is preserved.');
        nextProduction.recap = { assetId: asset.id, fingerprint, inputHash, sourceProjectId: prior.id, sourceAssetIds: sources.map(source => source.assetId), rawOutputIds, rawSubtitle, duration: recap.duration, segments: recap.segments, warnings, subtitleHash: hash(subtitle ?? '') };
        nextProduction.render = { ...object(nextProduction.render ?? {}), assetId: asset.id, inputHash };
        if (subtitle) { nextProduction.subtitle = subtitle; nextProduction.subtitleInputHash = inputHash; }
        else { delete nextProduction.subtitle; delete nextProduction.subtitleInputHash; }
        this.store.transaction(() => {
          this.store.saveProject({ ...current, data: { ...current.data, production: nextProduction, outputIds: [asset.id], productionStale: false } });
          context.checkpoint({ outputIds: [asset.id], recap: { ...state, fingerprint, assetId: asset.id, rawSubtitle, rawSubtitleInputHash: inputHash } });
          context.signal.throwIfAborted();
        });
        return [asset.id];
      } catch (error) { this.store.deleteAsset(asset.id); throw error; }
    } finally { await rm(recapFile, { force: true }); await rm(output, { force: true }); }
  }
  private affiliateSpeechFingerprint(dialogue: string, voiceId: string, cachedProvider?: unknown): string {
    const provider = this.store.settings().providers.voice;
    return createHash('sha256').update(JSON.stringify({ dialogue, voiceId, provider: provider.baseUrl ? provider : cachedProvider ?? provider })).digest('hex');
  }
  private async prepareAffiliateDubs(task: Task, project: Project, context: TaskContext): Promise<Project> {
    const dubbing = affiliateDubbing(project); if (!dubbing) return project;
    const initialHash = this.contentFingerprint(project.data), production = object(project.data.production ?? {});
    const dubs = { ...object(production.affiliateDubs ?? {}) }, selected = Array.isArray(task.input.shotIds) ? new Set(task.input.shotIds as string[]) : undefined;
    const folder = join(this.store.root, 'work', task.id); await mkdir(folder, { recursive: true });
    for (const step of pipelineSteps(project, { speech: false }).filter(step => step.kind === 'video')) {
      context.signal.throwIfAborted(); const base = step.id.replace(/\/video$/, '');
      if (selected && !selected.has(base) && !selected.has(decodeURIComponent(base.split('/').at(-1)!))) continue;
      const videoId = step.videoAssetId ?? object(production.videos ?? {})[base];
      if (typeof videoId !== 'string') throw new NeedsInputError(`Chưa có clip hiện tại cho ${base}; tạo clip trước khi lồng tiếng`);
      const speechId = step.dialogue ? object(production.speech ?? {})[base] : undefined;
      const voiceInput = object(object(production.affiliateSpeechInputs ?? {})[base] ?? {});
      if (step.dialogue && (typeof speechId !== 'string' || object(production.fingerprints ?? {})[`${base}/speech`] !== this.affiliateSpeechFingerprint(step.dialogue, dubbing.voiceId, voiceInput.assetId === speechId ? voiceInput.provider : undefined))) throw new NeedsInputError(`Chưa có lời đọc hiện tại cho ${base}; chạy bước speech trước khi kiểm tra hoặc dựng`);
      const fingerprint = createHash('sha256').update(JSON.stringify({ videoId, speechId, duration: step.duration, speed: dubbing.speed, volume: project.data.voiceVolume ?? 1, fps: project.data.fps ?? 24 })).digest('hex');
      const saved = object(dubs[base] ?? {});
      if (saved.fingerprint === fingerprint && typeof saved.assetId === 'string' && this.store.assets().some(asset => asset.id === saved.assetId)) continue;
      const source = this.store.assetPath(videoId), info = await this.media().probe(source, context.signal);
      if (!info.width || !info.height) throw new NeedsInputError('Affiliate dubbing cần clip có luồng hình');
      const silent = join(folder, `silent-${fingerprint}.mp4`), output = join(folder, `dub-${fingerprint}.mp4`);
      const options: MediaOptions = { width: info.width, height: info.height, fps: Number(project.data.fps) || 24, keepAudio: false };
      try {
        await this.withMedia(context.signal, () => this.media().merge([{ path: source, duration: step.duration }], silent, options, context));
        if (typeof speechId === 'string') await this.withMedia(context.signal, () => this.media().dub(silent, [{ path: this.store.assetPath(speechId), start: 0, duration: step.duration }], output, { ...options, fitVoice: true, voiceSpeed: dubbing.speed, ...(project.data.voiceVolume !== undefined ? { voiceVolume: project.data.voiceVolume as number } : {}) }, context));
        const rendered = await this.store.importAsset(typeof speechId === 'string' ? output : silent, { projectId: project.id, taskId: task.id, duration: step.duration }, context.signal);
        const latest = this.store.project(project.id);
        const latestProduction = object(latest.data.production ?? {});
        if (this.contentFingerprint(latest.data) !== initialHash || (step.videoAssetId ?? object(latestProduction.videos ?? {})[base]) !== videoId || (step.dialogue ? object(latestProduction.speech ?? {})[base] : undefined) !== speechId) throw new NeedsInputError('Clip/lời/giọng đã đổi khi dựng dub; giữ output ở task, không áp vào dự án mới');
        dubs[base] = { assetId: rendered.id, fingerprint, videoId, speechId };
        this.store.saveProject({ ...latest, data: { ...latest.data, production: { ...latestProduction, affiliateDubs: { ...object(latestProduction.affiliateDubs ?? {}), [base]: dubs[base] } } } });
      } catch (error) {
        if (error instanceof Error && /^Voice fit/.test(error.message)) throw new NeedsInputError(`Affiliate dub chưa vừa thời lượng cảnh; chỉnh lời hoặc thời lượng, không cắt mất từ. TTS đã tạo được giữ lại. ${error.message}`);
        throw error;
      } finally { await rm(silent, { force: true }); await rm(output, { force: true }); }
    }
    return this.store.project(project.id);
  }
  private async executeMusic(task: Task, project: Project, context: TaskContext): Promise<TaskResult> {
    const production = structuredClone(object(project.data.production ?? {})); const previous = object(production.music ?? {});
    const description = typeof project.data.musicPrompt === 'string' && project.data.musicPrompt.trim() ? project.data.musicPrompt : `Instrumental film background for ${project.name}. Genre: ${String(project.data.genre || '')}. Mood: ${String(project.data.style || '')}.`;
    const prompt = text(`${description}\nPlease go ahead now and create the instrumental background music as an MP3 audio file (no vocals). Do not ask questions.`, 'Music prompt', 32768);
    const fingerprint = createHash('sha256').update(prompt).digest('hex'); const initialHash = this.contentFingerprint(project.data);
    let state = object(task.checkpoint.music ?? {});
    let assetId = typeof state.assetId === 'string' ? state.assetId : '';
    if (!assetId && task.input.force !== true && typeof project.data.musicId === 'string' && (previous.assetId !== project.data.musicId || previous.fingerprint === fingerprint)) assetId = project.data.musicId;
    if (!assetId) {
      if (!task.accountId) throw new NeedsInputError('Chọn tài khoản Muse đã đăng nhập để tạo nhạc nền hoặc nhập audio có sẵn');
      const result = await this.generate({ ...task, kind: 'music', prompt, input: {}, checkpoint: state }, { ...context, checkpoint: value => { state = { ...state, ...value }; context.checkpoint({ music: state }); } });
      assetId = result.outputIds[0]; context.checkpoint({ music: { ...state, assetId } });
    }
    if (!this.store.asset(assetId).mime.startsWith('audio/')) throw new Error('Nhạc nền phải là audio asset');
    const info = await this.media().probe(this.store.assetPath(assetId), context.signal); if (!info.hasAudio) throw new Error('Nhạc nền không có audio stream hợp lệ');
    const latest = this.store.project(project.id); if (this.contentFingerprint(latest.data) !== initialHash) throw new NeedsInputError('Dự án đã thay đổi khi tạo nhạc; giữ audio ở task để review');
    production.music = { assetId, fingerprint }; const data = { ...latest.data, production, musicId: assetId };
    this.store.transaction(() => { this.store.saveProject({ ...latest, data }); context.checkpoint({ workingHash: this.contentFingerprint(data) }); });
    return { outputIds: [assetId], message: 'Nhạc nền đã sẵn sàng' };
  }
  private async executePlan(task: Task, context: TaskContext): Promise<TaskResult> {
    const project = object(task.input.projectSnapshot) as unknown as Project; const current = this.store.project(project.id);
    if (affiliateDubbing(project)) this.client('voice');
    if (task.checkpoint.planApplied === true) {
      if (this.contentFingerprint(current.data) !== task.checkpoint.planFingerprint) throw new NeedsInputError('Kế hoạch đã được chỉnh sau khi task lưu; tạo tác vụ mới để dùng bản chỉnh');
      return { outputIds: [], message: 'Kế hoạch đã lưu, sẵn sàng review' };
    }
    if (this.contentFingerprint(current.data) !== this.contentFingerprint(project.data)) throw new NeedsInputError('Dự án đã thay đổi; giữ kế hoạch hiện tại và chạy phân tích mới');
    if (project.data.storyMode === true && !(project.kind === 'affiliate' && project.data.affiliate !== undefined) && !object(project.data.production ?? {}).narration) throw new NeedsInputError('Chạy bước lời đọc trước để lập kế hoạch khớp thời gian giọng thật');
    const throughApi = !!this.store.settings().providers.text.baseUrl;
    const affiliate = project.kind === 'affiliate' && project.data.affiliate !== undefined ? await this.planAffiliate(task, project, context, throughApi) : undefined;
    const directed = !affiliate && directorEligible(project) ? await this.directFilm(task, project, context, throughApi) : undefined;
    let response = affiliate?.response || (directed ? JSON.stringify(directed.plan) : typeof task.checkpoint.planText === 'string' ? task.checkpoint.planText : '');
    if (!response) {
      const prompt = planningPrompt(project);
      const refs = this.planningRefs(project);
      context.progress(0.1, 'AI đang phân tích kịch bản, nhân vật, giọng và cảnh');
      if (throughApi) {
        if (task.checkpoint.remoteSubmitted === true) throw new NeedsInputError('AI đã nhận yêu cầu lập kế hoạch; đối soát trước khi gửi lại');
        context.checkpoint({ remoteSubmitted: true });
        try { response = refs.length ? await this.client('text').reviewImages(prompt, refs.map(id => this.store.assetPath(id)), context.signal) : await this.client('text').plan(prompt, context.signal); }
        catch (error) { if (error instanceof Error && /Provider HTTP 429$/.test(error.message)) { context.checkpoint({ remoteSubmitted: false }); throw new RetryableError('Text provider đang giới hạn tốc độ'); } throw error; }
      } else {
        if (!task.accountId) throw new NeedsInputError('Chọn tài khoản Muse đã đăng nhập hoặc cấu hình text provider để lập kế hoạch AI');
        response = await this.browsers.completeText({ ...task, prompt, input: { ...task.input, refIds: [...new Set(refs)] } }, context);
      }
      context.checkpoint({ planText: response });
    }
    const data = parsePlan(response, project); context.signal.throwIfAborted();
    if (affiliate) data.affiliateReview = { ...affiliate.review, attempts: affiliate.attempts, modelAssessed: true, taskId: task.id, at: Date.now() };
    if (directed) data.director = { review: directed.state.review ?? null, lint: directed.state.lint ?? [], logline: directed.state.bible?.logline ?? '', question: directed.state.bible?.question ?? '' };
    for (const character of validateCharacters(data.characters)) if (character.assetId && !this.store.asset(character.assetId).mime.startsWith('image/')) throw new Error('Tham chiếu nhân vật không phải ảnh');
    const latest = this.store.project(project.id);
    if (this.contentFingerprint(latest.data) !== this.contentFingerprint(project.data)) throw new NeedsInputError('Dự án đã thay đổi trong lúc AI phân tích; kết quả giữ ở task để đối soát');
    data.planning = { source: throughApi ? 'ai-api' : 'muse-browser', taskId: task.id, at: Date.now(), inputHash: this.contentFingerprint(project.data) };
    this.store.transaction(() => {
      this.store.saveProject({ ...latest, data }); context.checkpoint({ planApplied: true, planFingerprint: this.contentFingerprint(data) });
    });
    context.progress(1, 'Đã lưu kế hoạch AI: kiểm tra nhân vật và từng shot trước khi tạo media'); return { outputIds: [] };
  }
  private async planAffiliate(task: Task, project: Project, context: TaskContext, throughApi: boolean, reviewOnly = false) {
    const product = object(project.data.product ?? {});
    text(product.name ?? product.title, 'Product name', 2000);
    if (!Array.isArray(project.data.productAssetIds) || !project.data.productAssetIds.length) throw new NeedsInputError('Nhập hoặc chọn ảnh thật của sản phẩm trước khi lập kịch bản Affiliate');
    const refs = this.planningRefs(project), turns = structuredClone(object(task.checkpoint.affiliateTurns ?? {})) as Record<string, Record<string, unknown>>;
    const complete = async (turn: string, prompt: string): Promise<string> => {
      const saved = object(turns[turn] ?? {}); if (typeof saved.text === 'string') return saved.text;
      context.signal.throwIfAborted(); text(prompt, 'Affiliate planning request', 32768);
      context.progress(0.1, turn.startsWith('review') ? 'Đang đối chiếu kịch bản với nguồn sản phẩm' : 'Đang viết kịch bản Affiliate theo kiểu đã chọn');
      let response: string;
      if (throughApi) {
        if (saved.submitted === true) throw new NeedsInputError('Lượt Affiliate đã gửi; đối soát trước khi gửi lại');
        turns[turn] = { submitted: true }; context.checkpoint({ affiliateTurns: structuredClone(turns) });
        try { response = await this.client('text').reviewImages(prompt, refs.map(id => this.store.assetPath(id)), context.signal); }
        catch (error) {
          if (error instanceof Error && /Provider HTTP 429$/.test(error.message)) { turns[turn] = { submitted: false }; context.checkpoint({ affiliateTurns: structuredClone(turns) }); throw new RetryableError('Text provider đang giới hạn tốc độ'); }
          throw error;
        }
      } else {
        if (!task.accountId) throw new NeedsInputError('Chọn profile đã đăng nhập hoặc text provider để lập kịch bản Affiliate');
        response = await this.browsers.completeText({ ...task, prompt, input: { ...task.input, refIds: refs }, checkpoint: object(saved.browser ?? {}) }, { ...context, checkpoint: value => {
          turns[turn] = { ...object(turns[turn] ?? {}), browser: { ...object(object(turns[turn] ?? {}).browser ?? {}), ...value } }; context.checkpoint({ affiliateTurns: structuredClone(turns) });
        } });
      }
      turns[turn] = { ...object(turns[turn] ?? {}), text: response }; context.checkpoint({ affiliateTurns: structuredClone(turns) }); return response;
    };
    if (reviewOnly) {
      const data = project.data, post = object(data.affiliatePost ?? {});
      const response = JSON.stringify({ name: data.suggestedTitle || project.name, summary: data.summary, characters: data.characters ?? [], scenes: data.scenes ?? [], shots: data.shots, caption: data.affiliateCaption, postCaption: post.caption, hashtags: post.hashtags });
      const checked = parsePlan(response, project);
      const review = parseAffiliateReview(await complete('review:edited', affiliateReviewPrompt(project, checked)));
      context.checkpoint({ affiliateReview: review });
      if (review.status !== 'pass') throw new NeedsInputError('Kịch bản đã chỉnh chưa được duyệt; giữ nguyên nội dung của anh: ' + JSON.stringify(review));
      return { response, review, attempts: 1 };
    }
    let feedback = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await complete(`plan:${attempt}`, text(`${planningPrompt(project)}${feedback ? `\nRevise the previous failed draft. Fix these observed problems without changing the product facts or requested settings:\n${feedback}` : ''}`, 'Affiliate planning request', 32768));
      let data: Record<string, unknown>;
      try { data = parsePlan(response, project); }
      catch (error) {
        feedback = error instanceof Error ? error.message : 'Invalid Affiliate plan';
        context.checkpoint({ affiliatePlanError: feedback });
        if (attempt === 1) throw new NeedsInputError('Kịch bản Affiliate chưa đúng cấu hình sau một lượt sửa: ' + feedback);
        continue;
      }
      const review = parseAffiliateReview(await complete(`review:${attempt}`, affiliateReviewPrompt(project, data)));
      context.checkpoint({ affiliateReview: review });
      if (review.status === 'pass') return { response, review, attempts: attempt + 1 };
      feedback = JSON.stringify(review);
      if (review.status === 'unknown') throw new NeedsInputError('Chưa đủ bằng chứng để duyệt kịch bản Affiliate: ' + feedback);
      if (attempt === 1) throw new NeedsInputError('Kịch bản Affiliate chưa đạt sau một lượt sửa: ' + feedback);
    }
    throw new NeedsInputError('Chưa có kịch bản Affiliate được duyệt');
  }
  private async reviewAffiliateProject(task: Task, project: Project, context: TaskContext): Promise<Project> {
    const result = await this.planAffiliate(task, project, context, !!this.store.settings().providers.text.baseUrl, true);
    const latest = this.store.project(project.id);
    if (this.contentFingerprint(latest.data) !== this.contentFingerprint(project.data)) throw new NeedsInputError('Kịch bản đã đổi trong lúc review; không áp đánh giá cũ');
    const saved = this.store.saveProject({ ...latest, data: { ...latest.data, affiliateReview: { ...result.review, modelAssessed: true, attempts: 1, taskId: task.id, at: Date.now() } } });
    context.checkpoint({ workingHash: this.contentFingerprint(saved.data) }); return saved;
  }
  private async alignAffiliateMusic(task: Task, project: Project, context: TaskContext): Promise<Project> {
    const settings = readAffiliateSettings(project.data.affiliate);
    if (!['fashion', 'lookbook', 'asmr', 'pov'].includes(settings.contentStyle)) return project;
    const shots = buildShots(project.data), musicId = typeof project.data.musicId === 'string' ? project.data.musicId : '';
    const signature = (shots: Shot[]) => createHash('sha256').update(JSON.stringify({ musicId, seconds: settings.seconds, shots: shots.map(({ id, start, duration, dialogue }) => ({ id, start, duration, dialogue })) })).digest('hex');
    const production = object(project.data.production ?? {}), saved = object(production.affiliateBeatSync ?? {});
    if (saved.signature === signature(shots)) return project;
    const before = this.contentFingerprint(project.data); let beats: number[] = [];
    if (musicId) {
      const music = this.store.asset(musicId); if (!music.mime.startsWith('audio/')) throw new Error('Nhạc Affiliate phải là audio asset');
      context.progress(0.05, 'Đang đo nhịp từ file nhạc thực');
      beats = await this.withMedia(context.signal, () => detectAffiliateBeats(this.store.assetPath(musicId), this.media().executablePath, context.signal));
    }
    const aligned = beats.length ? alignAffiliateShots(shots, beats, settings.seconds) : shots;
    const moved = aligned.filter((shot, index) => Math.abs(Number(shot.start ?? 0) - Number(shots[index].start ?? 0)) > 0.001).length;
    const latest = this.store.project(project.id);
    if (this.contentFingerprint(latest.data) !== before) throw new NeedsInputError('Dự án đã đổi trong lúc đo nhịp; giữ kế hoạch mới của anh');
    const result = this.store.saveProject({ ...latest, data: { ...latest.data, shots: aligned, production: { ...object(latest.data.production ?? {}), affiliateBeatSync: {
      signature: signature(aligned), status: moved ? 'aligned' : 'unchanged', sourceAssetId: musicId, beats, cuts: aligned.slice(1).map(shot => shot.start), movedCuts: moved,
      reason: moved ? 'Các điểm cắt không có lời được căn vào onset đo từ nhạc' : musicId ? 'Không có điểm cắt phù hợp để đổi; giữ timeline và lời nói' : 'Chưa có nhạc; giữ timeline đã duyệt', taskId: task.id,
    } } } });
    context.checkpoint({ workingHash: this.contentFingerprint(result.data) }); return result;
  }
  // Each director turn keeps its own admission checkpoint (turns[turn]); a resumed task reuses every answered turn
  // and the saved director state, so Muse/the model is never asked twice for work it already returned.
  private async directFilm(task: Task, project: Project, context: TaskContext, throughApi: boolean): Promise<{ plan: Plan; state: DirectorState }> {
    const d = project.data; const pace: Pace = (['flow', 'drama', 'tight', 'full'] as const).find(value => value === d.pace) ?? 'flow';
    const minutes = d.minutes === undefined ? 2 : Number(d.minutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 90) throw new Error('Film minutes must be between 1 and 90');
    const planned = budget(minutes, pace).shots;
    const stepsPerShot = d.nativeAudio === false && d.voiceId ? 3 : 2;
    if (planned * stepsPerShot > 1000) throw new NeedsInputError(`Phim ${minutes} phút cần ${planned * stepsPerShot} bước tạo media, vượt giới hạn 1000 bước — giảm số phút trước khi lập kế hoạch`);
    if (!throughApi && !task.accountId) throw new NeedsInputError('Chọn tài khoản Muse đã đăng nhập hoặc cấu hình text provider để lập kế hoạch AI');
    const supplied = validateCharacters(d.characters);
    const refs = this.planningRefs(project);
    const turns = structuredClone(object(task.checkpoint.turns ?? {})) as Record<string, Record<string, unknown>>;
    let state = structuredClone(object(task.checkpoint.director ?? { shots: {} })) as unknown as DirectorState;
    const io: DirectorIO = {
      complete: async (turn, prompt) => {
        const saved = object(turns[turn] ?? {});
        if (typeof saved.text === 'string') return saved.text;
        text(prompt, 'Director turn prompt', 32768);
        const done = Object.keys(state.shots ?? {}).length; const total = state.budget?.shots ?? planned;
        context.progress(Math.min(0.95, 0.05 + 0.85 * done / total), turn === 'bible' ? 'AI đang dựng bible: nhân vật, bối cảnh, cảnh'
          : turn.startsWith('scene:') ? `AI đang viết cảnh ${turn.split(':')[1]} (${done}/${total} shot)` : 'Đạo diễn AI đang soát kịch bản');
        let reply: string;
        if (throughApi) {
          if (saved.submitted === true) throw new NeedsInputError(`AI đã nhận lượt lập kế hoạch "${turn}"; đối soát trước khi gửi lại`);
          turns[turn] = { submitted: true }; context.checkpoint({ turns: structuredClone(turns) });
          try { reply = turn === 'bible' && refs.length ? await this.client('text').reviewImages(prompt, refs.map(id => this.store.assetPath(id)), context.signal) : await this.client('text').plan(prompt, context.signal); }
          catch (error) { if (error instanceof Error && /Provider HTTP 429$/.test(error.message)) { turns[turn] = { ...turns[turn], submitted: false }; context.checkpoint({ turns: structuredClone(turns) }); throw new RetryableError('Text provider đang giới hạn tốc độ'); } throw error; }
        } else {
          const write = (value: Record<string, unknown>) => {
            const entry = object(turns[turn] ?? {}); turns[turn] = { ...entry, browser: { ...object(entry.browser ?? {}), ...value } }; context.checkpoint({ turns: structuredClone(turns) });
          };
          reply = await this.browsers.completeText({ ...task, prompt, checkpoint: object(saved.browser ?? {}), input: { ...task.input, refIds: turn === 'bible' ? refs : [] } }, { ...context, checkpoint: write });
        }
        turns[turn] = { ...object(turns[turn] ?? {}), text: reply }; context.checkpoint({ turns: structuredClone(turns) });
        return reply;
      },
      save: value => { state = value; context.checkpoint({ director: structuredClone(value) }); },
    };
    const settings = { idea: text(d.script, 'Ý tưởng phim', 32768), minutes, pace, lang: typeof d.language === 'string' && d.language ? d.language : 'vi', narrator: d.narrator === true,
      style: [d.style, d.styleText].filter((value): value is string => typeof value === 'string' && !!value.trim()).join(', ') || undefined,
      cast: supplied.map(character => ({ id: character.id, name: character.name, description: character.description })) };
    try { state = await direct(settings, io, state); }
    catch (error) {
      if (error instanceof DirectorIncomplete) throw new NeedsInputError(`${error.message} — chạy lại để AI viết nốt; các cảnh đã có được giữ nguyên`);
      throw error;
    }
    return { plan: toPlan(state, pace), state };
  }
  private characterFingerprint(project: Project, character: Character): string {
    const data = project.data, affiliate = project.kind === 'affiliate' && data.affiliate !== undefined ? readAffiliateSettings(data.affiliate) : undefined;
    return createHash('sha256').update(JSON.stringify({ character, style: data.style ?? '', styleText: data.styleText ?? '', ...(affiliate ? { product: data.product, productAssetIds: data.productAssetIds, outfits: affiliate.contentStyle === 'lookbook' ? affiliate.outfitAssetIds : [] } : {}) })).digest('hex');
  }
  private async executeCharacters(task: Task, project: Project, context: TaskContext): Promise<TaskResult> {
    const characters = validateCharacters(project.data.characters);
    const affiliate = project.kind === 'affiliate' && project.data.affiliate !== undefined ? readAffiliateSettings(project.data.affiliate) : undefined;
    const refs = affiliate ? affiliate.contentStyle === 'lookbook' && affiliate.outfitAssetIds.length ? [affiliate.outfitAssetIds[0]] : (project.data.productAssetIds as string[] ?? []) : [];
    const states = object(task.checkpoint.characters ?? {}); const outputIds: string[] = []; const initialHash = this.contentFingerprint(project.data);
    const existing = (id: unknown): string => typeof id === 'string' && this.store.assets().some(asset => asset.id === id && asset.mime.startsWith('image/')) ? id : '';
    for (const [index, character] of characters.entries()) {
      context.signal.throwIfAborted(); const key = `character/${character.id}`; const signature = this.characterFingerprint(project, character);
      const current = this.store.project(project.id); if (this.contentFingerprint(current.data) !== initialHash) throw new NeedsInputError('Nhân vật đã được chỉnh; chạy task mới để dùng bản chỉnh');
      const production = object(current.data.production ?? {}), images = object(production.characterImages ?? {}), fingerprints = object(production.fingerprints ?? {});
      if (character.assetId && !this.store.asset(character.assetId).mime.startsWith('image/')) throw new Error('Tham chiếu nhân vật không phải image asset');
      let saved = object(states[character.id] ?? {});
      if (typeof saved.signature === 'string' && saved.signature !== signature) {
        if (hasPendingAdmission(saved)) throw new NeedsInputError('Nhân vật đã đổi khi provider còn xử lý; đối soát trước khi gửi lại');
        saved = {}; states[character.id] = saved;
      }
      const completed = existing(saved.assetId), currentPortrait = fingerprints[key] === signature ? existing(images[character.id]) : '';
      if (!completed && currentPortrait && hasPendingAdmission(saved)) throw new NeedsInputError('Provider đã nhận yêu cầu ảnh nhân vật; cần đối soát trước khi dùng kết quả khác');
      // A fresh force task generates; a completed retry follows the latest matching portrait.
      let assetId = character.assetId || (currentPortrait && (task.input.force !== true || !!completed) ? currentPortrait : completed);
      if (!assetId) {
        const prompt = text(`Create a clear full-body character reference on a neutral background. One consistent face, hair and outfit, ${affiliate ? 'no added text or watermarks; preserve real printed product branding from the supplied references' : 'no text or logo'}. Character: ${character.name}. Appearance: ${character.description}. Style: ${[project.data.style, project.data.styleText].filter(value => typeof value === 'string' && value.trim()).join('. ')}.${affiliate ? ` Wear the actual product from the supplied reference photos without redesigning its shape, material, pattern or color. Product data only: ${JSON.stringify(project.data.product)}.` : ''}`, 'Character prompt', 32768);
        const child: Task = { ...task, kind: 'image', prompt, input: { ratio: '3:4', refIds: refs }, checkpoint: saved };
        const result = await this.generate(child, { signal: context.signal, progress: (progress, message) => context.progress((index + progress) / Math.max(1, characters.length), message), checkpoint: value => { states[character.id] = { ...object(states[character.id] ?? {}), ...value, signature }; context.checkpoint({ characters: states }); } });
        assetId = result.outputIds[0]; saved = object(states[character.id] ?? {});
      }
      if (!this.store.asset(assetId).mime.startsWith('image/')) throw new Error('Ảnh nhân vật phải là image asset');
      states[character.id] = { ...(completed === assetId ? saved : {}), assetId, signature }; context.checkpoint({ characters: states }); outputIds.push(assetId);
      const latest = this.store.project(project.id); if (this.contentFingerprint(latest.data) !== initialHash) throw new NeedsInputError('Nhân vật đã được chỉnh trong lúc chạy; giữ output ở task để review');
      const latestProduction = object(latest.data.production ?? {});
      this.store.saveProject({ ...latest, data: { ...latest.data, production: { ...latestProduction, characterImages: { ...object(latestProduction.characterImages ?? {}), [character.id]: assetId }, fingerprints: { ...object(latestProduction.fingerprints ?? {}), [key]: signature } } } });
    }
    return { outputIds: [...new Set(outputIds)], message: characters.length ? 'Đã lưu ảnh tham chiếu nhân vật' : 'Kế hoạch không có nhân vật cần tạo ảnh' };
  }
  private async executeNarration(task: Task, project: Project, context: TaskContext): Promise<TaskResult> {
    const data = project.data; const production = structuredClone(object(data.production ?? {})); const savedNarration = object(production.narration ?? {});
    const fingerprint = createHash('sha256').update(JSON.stringify({ script: data.script, sourceAudioAssetId: data.sourceAudioAssetId || data.sourceAssetId, voiceId: data.voiceId, language: data.language, shotSeconds: data.shotSeconds ?? 3.2 })).digest('hex');
    if (task.input.force !== true && savedNarration.fingerprint === fingerprint && typeof savedNarration.assetId === 'string' && this.store.assets().some(asset => asset.id === savedNarration.assetId)) return { outputIds: [savedNarration.assetId], message: 'Dùng lại lời đọc đã hoàn tất' };
    const initialHash = this.contentFingerprint(data); const folder = join(this.store.root, 'work', task.id); await mkdir(folder, { recursive: true });
    let cues: ReturnType<typeof parseSrt>; let assetId: string; const sourceId = data.sourceAudioAssetId || data.sourceAssetId;
    if (sourceId) {
      const source = this.store.asset(text(sourceId, 'Source audio asset ID', 100)); if (!/^(audio|video)\//.test(source.mime)) throw new Error('Lời kể nguồn phải là audio/video');
      context.progress(0.05, 'Đang tìm câu nói và chép lời từ audio nguồn');
      const path = this.store.assetPath(source.id); const info = await this.media().probe(path, context.signal);
      if (!info.hasAudio) throw new NeedsInputError('Audio nguồn chưa có luồng âm thanh');
      const hasScript = typeof data.script === 'string' && !!data.script.trim();
      let transcript: { text: string; segments: Array<{ start: number; end: number; text: string }> };
      if (this.store.settings().providers.asr.baseUrl) transcript = await this.client('asr').transcribeTimed(path, context.signal);
      else if (this.offline.ready() || !hasScript) transcript = await this.localTranscript(path, context.signal);
      else {
        const analysis = await this.withMedia(context.signal, () => analyzeSpeech(path, this.media().executablePath, context.signal));
        transcript = { text: '', segments: analysis.parts.map(part => ({ ...part, text: '' })) };
      }
      if (!transcript.segments.length) throw new NeedsInputError('ASR chưa trả mốc câu nói; cần SRT có thời gian để dùng đúng audio nguồn');
      if (transcript.segments.some(segment => segment.end > info.duration + 0.05)) throw new NeedsInputError('Mốc thời gian ASR vượt thời lượng audio nguồn; cần review timestamp trước khi căn lời');
      cues = transcript.segments.map((segment, index) => ({ index: index + 1, ...segment }));
      if (typeof data.script === 'string' && data.script.trim()) {
        cues = alignScript(splitStory(data.script), transcript.segments, transcript.text ? transcript.segments.map(segment => segment.text) : undefined);
      }
      assetId = source.id;
    } else {
      const lines = splitStory(text(data.script, 'Story script', 1024 * 1024)); const voiceId = text(data.voiceId, 'Chọn voice ID cho lời kể', 256);
      const states = object(task.checkpoint.narrationLines ?? {}); const audio: Array<{ path: string; duration: number }> = [];
      for (const [index, line] of lines.entries()) {
        context.signal.throwIfAborted(); const state = object(states[String(index)] ?? {});
        let id = typeof state.assetId === 'string' && this.store.assets().some(asset => asset.id === state.assetId) ? state.assetId : '';
        if (!id) {
          const child: Task = { ...task, kind: 'speech', prompt: line, input: { voiceId }, checkpoint: state };
          const result = await this.execute(child, { signal: context.signal, progress: () => {}, checkpoint: value => { states[String(index)] = { ...object(states[String(index)] ?? {}), ...value }; context.checkpoint({ narrationLines: states }); } });
          id = result.outputIds[0]; states[String(index)] = { ...object(states[String(index)] ?? {}), assetId: id }; context.checkpoint({ narrationLines: states });
        }
        const path = this.store.assetPath(id); const info = await this.media().probe(path, context.signal); if (!info.hasAudio) throw new Error('TTS không trả audio hợp lệ');
        audio.push({ path, duration: info.duration }); context.progress(0.05 + (index + 1) / lines.length * 0.7, `Đã tạo và đo lời đọc ${index + 1}/${lines.length}`);
      }
      const timing = cuesFromDurations(lines, audio.map(part => part.duration)); cues = timing.cues;
      let mix = audio.map((part, index) => ({ ...part, start: timing.offsets[index] }));
      if (mix.length > 100) {
        const chunks: typeof mix = [];
        for (let index = 0; index < mix.length; index += 100) {
          const group = mix.slice(index, index + 100); const start = group[0].start; const duration = group.at(-1)!.start + group.at(-1)!.duration - start;
          const path = join(folder, `narration-${index}.wav`);
          await this.withMedia(context.signal, () => this.media().mixAudio(group.map(part => ({ ...part, start: part.start - start })), path, { duration }, context)); chunks.push({ path, start, duration });
        }
        mix = chunks;
      }
      const path = join(folder, 'narration.wav'); const info = await this.withMedia(context.signal, () => this.media().mixAudio(mix, path, { duration: timing.total }, context));
      const asset = await this.store.importAsset(path, { taskId: task.id, projectId: project.id, duration: info.duration }, context.signal); assetId = asset.id;
    }
    const groups = groupNarration(cues, Number(data.shotSeconds ?? 3.2)); const latest = this.store.project(project.id);
    if (this.contentFingerprint(latest.data) !== initialHash) throw new NeedsInputError('Lời kể đã được chỉnh trong lúc tạo; output giữ ở task để review');
    production.narration = { fingerprint, assetId }; production.speech = { ...object(production.speech ?? {}), [`${project.id}/narration`]: assetId };
    const next = { ...latest.data, subtitle: formatSrt(cues), visualGroups: groups, visualGrouped: true, narrationMode: 'source', production, planningNeedsUpdate: true, productionStale: true };
    this.store.transaction(() => { this.store.saveProject({ ...latest, data: next }); context.checkpoint({ workingHash: this.contentFingerprint(next) }); });
    return { outputIds: [assetId], message: 'Đã tạo mốc lời kể từ thời lượng audio thật; sẵn sàng phân tích hình ảnh' };
  }
  private async localTranscript(path: string, signal: AbortSignal): Promise<{ text: string; segments: Array<{ start: number; end: number; text: string }> }> {
    if (!this.offline.ready()) throw new NeedsInputError('Tải mô hình giọng local trong Cài đặt hoặc cấu hình ASR provider');
    const analysis = await this.withMedia(signal, () => analyzeSpeech(path, this.media().executablePath, signal));
    if (!analysis.parts.length) throw new NeedsInputError('Chưa phát hiện câu nói rõ trong audio nguồn');
    return this.offline.transcribeParts(path, analysis.parts, signal);
  }
  private async reviewAndRepair(task: Task, project: Project, context: TaskContext): Promise<void> {
    const limit = qualityRetries(project.data.qualityRetries), state = object(task.checkpoint.qualityControl ?? {});
    const rounds = object(state.rounds ?? {}), repairs = object(state.repairs ?? {});
    const selected = Array.isArray(task.input.shotIds) ? new Set(task.input.shotIds as string[]) : undefined;
    const steps = pipelineSteps(project, { speech: false });
    const videos = steps.filter(step => step.kind === 'video').filter(step => !selected || selected.has(step.id.replace(/\/video$/, '')) || selected.has(decodeURIComponent(step.id.split('/').at(-2)!)));
    if (!videos.length) throw new NeedsInputError('Chưa có shot để review');
    let round = typeof state.round === 'number' ? state.round : 0;
    if (!Number.isInteger(round) || round < 0 || round > 2) throw new Error('Invalid quality repair checkpoint');
    const save = () => context.checkpoint({ qualityControl: { ...state, round, rounds, repairs } });
    while (true) {
      context.signal.throwIfAborted();
      const repair = object(repairs[round] ?? {});
      if (round > 0 && repair.done !== true) {
        const feedback = object(repair.feedback) as Record<string, string>;
        for (const stage of ['images', 'videos'] as const) {
          const ids = repair[`${stage}Ids`]; if (!Array.isArray(ids) || !ids.length) continue;
          let checkpoint = object(repair[stage] ?? {});
          await this.executePipeline({ ...task, input: { ...task.input, projectSnapshot: this.store.project(project.id), stage, shotIds: ids, force: true }, checkpoint }, { ...context,
            checkpoint: value => { checkpoint = { ...checkpoint, ...value }; repair[stage] = checkpoint; repairs[round] = repair; save(); },
          }, feedback);
        }
        repair.done = true; repairs[round] = repair; save();
      }
      let checkpoint = object(rounds[round] ?? (round === 0 ? task.checkpoint.quality ?? {} : { reviews: structuredClone(object(object(rounds[round - 1] ?? {}).reviews ?? {})) }));
      await this.executeReview({ ...task, input: { ...task.input, stage: 'check' }, checkpoint }, this.store.project(project.id), { ...context,
        checkpoint: value => { checkpoint = { ...checkpoint, ...value }; rounds[round] = checkpoint; save(); },
      }, true);
      const latest = this.store.project(project.id), production = { ...object(latest.data.production ?? {}) }, reviews = object(latest.data.qualityReviews ?? {});
      const history = { ...object(production.qualityTakes ?? {}) }, imageIds: string[] = [], videoIds: string[] = [], feedback: Record<string, string> = {};
      let unknown = false, failures = 0;
      for (const step of videos) {
        const base = step.id.replace(/\/video$/, ''), review = object(reviews[base] ?? {});
        const required = [...(steps.some(value => value.id === `${base}/image`) || step.refIds.length ? ['image'] : []),
          ...(project.data.videoReview === true && project.data.renderMode !== 'slideshow' ? ['video'] : []), ...((project.data.nativeAudio === true || affiliateDubbing(project)) && project.data.renderMode !== 'slideshow' ? ['speech'] : [])];
        const statuses = required.map(key => object(review[key] ?? {}).status);
        unknown ||= !statuses.length || statuses.some(status => !['pass', 'fail'].includes(String(status)));
        const failed = required.filter(key => object(review[key] ?? {}).status === 'fail'); failures += failed.length;
        const takes = Array.isArray(history[base]) ? history[base] as Array<Record<string, unknown>> : [];
        const imageId = object(production.images ?? {})[base], videoId = object(production.videos ?? {})[base];
        const currentTake = takes.find(take => take.taskId === task.id && take.imageId === imageId && take.videoId === videoId && take.imageFingerprint === object(production.fingerprints ?? {})[`${base}/image`] && take.videoFingerprint === object(production.fingerprints ?? {})[step.id]);
        if (currentTake) { currentTake.review = review; currentTake.score = reviewScore(review); }
        for (const take of takes) {
          const assessed = { ...object(take.review ?? {}) };
          for (const kind of ['image', 'video', 'speech']) {
            const previous = object(assessed[kind] ?? {}), current = object(review[kind] ?? {});
            if (current.assetId && current.assetId === previous.assetId && current.fingerprint === previous.fingerprint && Number(current.at) >= Number(previous.at)) assessed[kind] = current;
          }
          take.review = assessed; take.score = reviewScore(assessed);
        }
        if (!currentTake) takes.push({ taskId: task.id, round, imageId, videoId, score: reviewScore(review), review,
          imageFingerprint: object(production.fingerprints ?? {})[`${base}/image`], videoFingerprint: object(production.fingerprints ?? {})[step.id], at: Date.now() });
        history[base] = takes.slice(-12);
        if (failed.length) {
          const imageFailed = failed.includes('image');
          if (imageFailed && steps.some(value => value.id === `${base}/image`)) imageIds.push(base);
          if (project.data.renderMode !== 'slideshow' && !step.videoAssetId && (!imageFailed || imageIds.includes(base)) && (!affiliateDubbing(project) || failed.some(key => key !== 'speech'))) videoIds.push(base);
          feedback[base] = failed.flatMap(kind => {
            const result = object(review[kind]); return Object.values(object(result.checks ?? {})).map(value => object(value).reason).filter(value => typeof value === 'string');
          }).join('; ').slice(0, 2000) || 'Correct the failed assessment without changing the requested action or dialogue.';
        }
      }
      production.qualityTakes = history; this.store.saveProject({ ...latest, data: { ...latest.data, production } });
      if (!failures && !unknown) { save(); return; }
      if (unknown) throw new NeedsInputError('Review còn unknown hoặc thiếu bằng chứng; cần anh xem trước khi tạo lại hoặc dựng');
      if (round >= limit || !imageIds.length && !videoIds.length) {
        const chosenReviews = { ...reviews }, fingerprints = { ...object(production.fingerprints ?? {}) };
        for (const step of videos) {
          const base = step.id.replace(/\/video$/, ''), policy = object(reviews[base] ?? {}).policyFingerprint;
          const takes = (history[base] as Array<Record<string, unknown>>).filter(take => take.taskId === task.id && typeof policy === 'string' && object(take.review ?? {}).policyFingerprint === policy);
          if (!takes.length) throw new NeedsInputError('Chưa có take được đánh giá theo quy tắc hiện tại; đánh giá lại trước khi chọn bản dựng');
          const best = takes.reduce((best, take) => Number(take.score) > Number(best.score) ? take : best);
          if (best.imageId && steps.some(value => value.id === `${base}/image`)) { production.images = { ...object(production.images ?? {}), [base]: best.imageId }; fingerprints[`${base}/image`] = best.imageFingerprint; }
          if (best.videoId && !step.videoAssetId) { production.videos = { ...object(production.videos ?? {}), [base]: best.videoId }; fingerprints[step.id] = best.videoFingerprint; }
          chosenReviews[base] = best.review;
          const saved = { ...object(object(object(rounds[Number(best.round)] ?? {}).reviews ?? {})[base] ?? {}) };
          for (const kind of ['image', 'video', 'speech']) {
            const assessment = object(object(best.review ?? {})[kind] ?? {});
            if (typeof assessment.fingerprint !== 'string' || typeof assessment.taskId !== 'string' || typeof assessment.at !== 'number') continue;
            const response = kind === 'speech' ? assessment.semantic === 'assessed' && typeof assessment.heard === 'string' ? assessment.heard : undefined : assessment.modelAssessed === true ? JSON.stringify(assessment.checks) : undefined;
            if (response !== undefined) saved[kind] = { fingerprint: assessment.fingerprint, response, responseAt: assessment.at, sourceTaskId: assessment.taskId,
              ...(kind === 'speech' ? { resolved: true } : kind === 'video' ? { frameIds: assessment.frameIds, sampleTimes: assessment.sampleTimes } : {}) };
          }
          checkpoint.reviews = { ...object(checkpoint.reviews ?? {}), [base]: saved };
        }
        production.fingerprints = fingerprints; rounds[round] = checkpoint; save();
        this.store.saveProject({ ...latest, data: { ...latest.data, production, qualityReviews: chosenReviews } });
        throw new NeedsInputError('Kiểm tra chất lượng còn fail; đã giữ bản có đánh giá tốt nhất trong giới hạn tạo lại. Xem review trước khi dựng thủ công');
      }
      round++; repairs[round] = { imagesIds: imageIds, videosIds: videoIds, feedback, done: false }; save();
      context.progress(0.8, `Sửa ${new Set([...imageIds, ...videoIds]).size} cảnh chưa đạt, vòng ${round}/${limit}`);
    }
  }

  private async executeReview(task: Task, project: Project, context: TaskContext, reuseCurrent = false): Promise<TaskResult> {
    const dubbing = affiliateDubbing(project);
    if (dubbing) project = await this.prepareAffiliateDubs(task, project, context);
    const initialHash = this.contentFingerprint(project.data);
    const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const currentTargets = () => {
      const current = this.store.project(project.id);
      if (this.contentFingerprint(current.data) !== initialHash) throw new NeedsInputError('Input dự án đã thay đổi trong lúc kiểm tra; giữ kết quả ở task để đối soát');
      const data = current.data, production = object(data.production ?? {}), fingerprints = object(production.fingerprints ?? {});
      const characters = validateCharacters(data.characters).map(character => {
        const assetId = object(production.characterImages ?? {})[character.id];
        return !character.assetId && fingerprints[`character/${character.id}`] === this.characterFingerprint(current, character) && typeof assetId === 'string' ? { ...character, assetId } : character;
      });
      const steps = pipelineSteps({ ...current, data: { ...data, characters } }, { speech: false });
      const images = new Map(steps.filter(step => step.kind === 'image').map(step => [step.id, step]));
      const explicitFrames = new Map<string, string>();
      const visualPlans = new Map<string, string>();
      const castReferences = new Map<string, string[]>();
      const collect = (source: Record<string, unknown>, scope: string): void => {
        if (source.shots !== undefined || source.scenes === undefined) {
          for (const shot of buildShots(source)) {
            const base = `${scope}/${encodeURIComponent(shot.id)}`; visualPlans.set(base, shot.prompt); if (shot.assetId) explicitFrames.set(base, shot.assetId);
            const scene = Array.isArray(source.scenes) ? source.scenes.map(object).find(value => value.id === shot.sceneId) : undefined;
            const ids = [...(shot.characterIds ?? (scene?.characterIds as string[] | undefined) ?? (source.characterIds as string[] | undefined) ?? []), ...(shot.listenerIds ?? []), ...(shot.speaker ? [shot.speaker] : [])];
            castReferences.set(base, characters.filter(character => ids.includes(character.id) && character.assetId).map(character => character.assetId!));
          }
        } else for (const [index, raw] of (source.scenes as unknown[]).entries()) { const scene = object(raw); collect(scene, `${scope}/${encodeURIComponent(String(scene.id ?? `scene-${index + 1}`))}`); }
      };
      collect(data, encodeURIComponent(current.id));
      return steps.filter(step => step.kind === 'video').map(step => {
        const base = step.id.replace(/\/video$/, ''), imageStep = images.get(`${base}/image`);
        const cachedFrame = object(production.images ?? {})[base], cachedVideo = object(production.videos ?? {})[base];
        const frameValid = !!imageStep && fingerprints[imageStep.id] === hash({ ...imageStep, refIds: [...new Set(imageStep.refIds)], ratio: data.ratio ?? '16:9' });
        const frame = explicitFrames.get(base) ?? (frameValid && typeof cachedFrame === 'string' ? cachedFrame : undefined);
        const videoRefs = frame ? [frame] : step.refIds;
        const videoValid = fingerprints[step.id] === hash({ ...step, refIds: videoRefs, ratio: data.ratio ?? '16:9' });
        const video = step.videoAssetId ?? (videoValid && typeof cachedVideo === 'string' ? cachedVideo : undefined);
        const stale = (!explicitFrames.has(base) && !!imageStep && typeof cachedFrame === 'string' && !frameValid) || (!step.videoAssetId && typeof cachedVideo === 'string' && !videoValid);
        if (frame && !this.store.asset(frame).mime.startsWith('image/')) throw new Error('Frame review requires an image');
        if (video && !this.store.asset(video).mime.startsWith('video/')) throw new Error('Speech review requires a video');
        const affiliate = current.kind === 'affiliate' && data.affiliate !== undefined ? readAffiliateSettings(data.affiliate) : undefined;
        const productRefs = affiliate ? (Array.isArray(data.productAssetIds) ? data.productAssetIds as string[] : []) : [];
        const refs = frame ? [...new Set([frame, ...(imageStep?.refIds ?? castReferences.get(base) ?? []), ...(!imageStep ? productRefs : [])].filter(id => this.store.asset(id).mime.startsWith('image/')))] : [];
        const visualPlan = imageStep?.prompt || visualPlans.get(base) || step.prompt;
        const productCheck = affiliate ? ` Product identity is REQUIRED: compare the generated product against supplied product images for shape, material, pattern, selected color, packaging and supported use. No invented logo, garment, feature or SKU. Return unknown if product evidence is insufficient. Image roles after the generated scene: ${JSON.stringify(refs.slice(1).map((id, index) => ({ image: index + 2, role: id === affiliate.backgroundAssetId ? 'background' : productRefs.includes(id) || affiliate.outfitAssetIds.includes(id) ? 'product' : 'character' })))}. Add "product":{"status":"pass|fail|unknown","reason":"visible evidence or missing source"} to the JSON. Expected host mode: ${affiliate.hostMode}; content style: ${affiliate.contentStyle}. Reject an unexpected talking/visible host or face for hands-only/voiceover shots.` : '';
        const prompt = frame ? text(`Review these actual images against the supplied visual plan. Image 1 is the generated scene; subsequent images are ${affiliate ? 'labelled product, character or background references' : 'character references'}. Compare scene composition, character face identity and outfit. Do not invent successful checks. If references are insufficient return unknown; if no people are involved mark face/outfit not_applicable. For planned product/hand/foot inserts with no recognizable face, including an intentionally cropped chin or mouth, mark face not_applicable and explain the planned framing. Still assess any recognizable face that is visible; unplanned cropping of a required face is not exempt. Never waive scene, outfit or product checks for a close-up. Return ONLY JSON: {"scene":{"status":"pass|fail|unknown","reason":"..."},"face":{"status":"pass|fail|unknown|not_applicable","reason":"..."},"outfit":{"status":"pass|fail|unknown|not_applicable","reason":"..."}}.${productCheck} Visual plan: ${visualPlan}. Cast: ${JSON.stringify(characters.filter(character => character.assetId && refs.includes(character.assetId)).map(({ name, description }) => ({ name, description })))}`, 'Review prompt', 32768) : '';
        const dub = object(object(production.affiliateDubs ?? {})[base] ?? {}), speechVideo = dubbing ? dub.assetId : video;
        return { base, step, frame, video, speechVideo: typeof speechVideo === 'string' ? speechVideo : undefined, stale: stale || !!dubbing && (dub.videoId !== video || dub.speechId !== (step.dialogue ? object(production.speech ?? {})[base] : undefined)), refs, prompt, visualPlan, imageHash: hash({ frame, prompt, refs, provider: this.store.settings().providers.text }),
          policyHash: hash({ prompt, references: refs.slice(1), visualPlan, motion: step.prompt, duration: step.duration, nativeAudio: data.nativeAudio, pace: data.pace, fps: data.fps, textProvider: this.store.settings().providers.text, asrProvider: this.store.settings().providers.asr, dialogue: step.dialogue, speaker: step.speaker, characters, language: data.language }),
          affiliate: !!affiliate, audioRequired: affiliate?.contentStyle === 'asmr', videoHash: hash({ version: affiliate ? 2 : 1, video, frame, visualPlan, prompt: step.prompt, duration: step.duration, nativeAudio: data.nativeAudio, pace: data.pace, fps: data.fps, provider: this.store.settings().providers.text }),
          speechHash: hash({ video: speechVideo, dialogue: step.dialogue, speaker: step.speaker, characters, language: data.language, provider: this.store.settings().providers.asr }) };
      });
    };
    const targets = currentTargets(), targetHash = hash(targets);
    const assertCurrent = (): Project => { context.signal.throwIfAborted(); if (hash(currentTargets()) !== targetHash) throw new NeedsInputError('Asset/input đã thay đổi trong lúc kiểm tra; không áp kết quả cũ'); return this.store.project(project.id); };
    const selected = Array.isArray(task.input.shotIds) ? new Set(task.input.shotIds as string[]) : undefined;
    const chosen = targets.filter(target => !selected || selected.has(target.base) || selected.has(decodeURIComponent(target.base.split('/').at(-1)!)));
    for (const target of chosen) {
      if (target.stale) throw new NeedsInputError(`Output cũ không khớp kế hoạch shot ${target.base}; tạo lại trước khi kiểm tra`);
      if (!target.frame && !target.video) throw new NeedsInputError(`Chưa có output của shot ${target.base} để kiểm tra`);
      if (target.refs.length > 16 || target.refs.reduce((sum, id) => sum + this.store.asset(id).size, 0) > 25 * 1024 * 1024) throw new NeedsInputError('Review giới hạn 16 ảnh và 25 MiB tổng tham chiếu');
    }
    const states = object(task.checkpoint.reviews ?? {});
    const stateFor = (base: string, kind: string, fingerprint: string): Record<string, unknown> => {
      const state = object(object(states[base] ?? {})[kind] ?? {});
      if (state.fingerprint !== fingerprint && state.remoteSubmitted === true && typeof state.response !== 'string' && state.resolved !== true) throw new NeedsInputError('Input review đã đổi nhưng remote cũ chưa rõ kết quả; cần đối soát trước khi gửi lại');
      // An explicit fresh review supersedes a completed checkpoint, never an unresolved remote request.
      if (reuseCurrent && !hasPendingAdmission(state)) {
        const review = object(object(object(this.store.project(project.id).data.qualityReviews ?? {})[base] ?? {})[kind] ?? {});
        const target = targets.find(value => value.base === base)!;
        const assetId = kind === 'image' ? target.frame : kind === 'video' ? target.video : target.speechVideo;
        if (review.fingerprint === fingerprint && review.assetId === assetId && typeof review.taskId === 'string' && review.taskId !== task.id && typeof review.at === 'number' && review.at > Number(state.responseAt ?? task.createdAt)) {
          if (kind === 'speech' && review.semantic === 'assessed' && typeof review.heard === 'string') return { fingerprint, response: review.heard, resolved: true, responseAt: review.at, sourceTaskId: review.taskId };
          if (kind !== 'speech' && review.modelAssessed === true && (kind !== 'video' || Array.isArray(review.frameIds) && review.frameIds.length === VIDEO_REVIEW_FRAMES && Array.isArray(review.sampleTimes) && review.sampleTimes.length === VIDEO_REVIEW_FRAMES)) return { fingerprint, response: JSON.stringify(review.checks), frameIds: review.frameIds, sampleTimes: review.sampleTimes, responseAt: review.at, sourceTaskId: review.taskId };
        }
      }
      return state.fingerprint === fingerprint ? state : {};
    };
    const checkpoint = (base: string, kind: string, fingerprint: string, value: Record<string, unknown>): void => {
      const saved = object(states[base] ?? {}); saved[kind] = { ...stateFor(base, kind, fingerprint), ...value, fingerprint, ...(typeof value.response === 'string' ? { responseAt: Date.now(), sourceTaskId: task.id } : {}) }; states[base] = saved; context.checkpoint({ reviews: states });
    };
    const analyses = new Map<string, Awaited<ReturnType<typeof analyzeSpeech>>>();
    const audioPresent = new Map<string, boolean>();
    const points: Parameters<typeof compareSpeakers>[0] = [];
    if (project.data.nativeAudio === true || dubbing) for (const [index, target] of targets.entries()) {
      if (!target.speechVideo || target.stale) continue;
      const path = this.store.assetPath(target.speechVideo), media = this.media();
      const info = await media.probe(path, context.signal);
      audioPresent.set(target.base, info.hasAudio);
      const acoustic = info.hasAudio ? await this.withMedia(context.signal, () => analyzeSpeech(path, media.executablePath, context.signal)) : { duration: info.duration, voiced: 0, parts: [], f0: null };
      assertCurrent(); analyses.set(target.base, acoustic);
      const span = acoustic.parts.filter(part => part.end - part.start >= 0.8).sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
      if (target.step.speaker && target.step.dialogue && acoustic.voiced >= 0.8 && span && this.offline.ready()) {
        const folder = join(this.store.root, 'work', task.id); await mkdir(folder, { recursive: true }); const crop = join(folder, `speaker-${randomUUID()}.wav`);
        try {
          const wav = await this.withMedia(context.signal, () => new Promise<Buffer>((resolve, reject) => {
            execFile(media.executablePath, ['-hide_banner', '-nostdin', '-v', 'error', '-threads', '1', '-protocol_whitelist', 'file,pipe', '-i', path, '-ss', String(span.start), '-t', String(Math.min(20, span.end - span.start)), '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], { encoding: 'buffer', shell: false, windowsHide: true, timeout: 30000, signal: context.signal, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(context.signal.aborted ? context.signal.reason : new Error('Cannot extract bounded speaker speech crop')) : resolve(stdout));
          }));
          context.signal.throwIfAborted(); await writeFile(crop, wav, { mode: 0o600, flag: 'wx' });
          const embedding = await this.offline.embed(crop, context.signal); assertCurrent();
          // Hashing the scoped shot key keeps the comparator's ID within its 256-byte bound.
          points.push({ id: hash(target.base), speaker: target.step.speaker, embedding });
        } finally { await rm(crop, { force: true }); }
      }
      context.progress((index + 1) / Math.max(1, targets.length) * 0.4, 'Đang đo giọng từ các clip hiện tại');
    }
    const cohort = compareSpeakers(points), patches = new Map<string, Record<string, unknown>>();
    const identityFor = (base: string) => cohort.shots[hash(base)] ?? { status: 'unknown', similarity: null, margin: null, ownCount: 0 };
    const applyIdentity = (speech: Record<string, unknown>, target: typeof targets[number]): Record<string, unknown> => {
      const identity = identityFor(target.base), voiced = analyses.get(target.base)?.voiced ?? 0;
      const transcript = speech.transcript ? object(speech.transcript) : undefined;
      let status = target.step.dialogue ? voiced < 0.6 || transcript?.ok === false ? 'fail' : speech.semantic === 'assessed' ? 'pass' : 'unknown' : typeof speech.heard === 'string' && speech.heard.trim() ? 'fail' : voiced > 0 && speech.semantic !== 'assessed' ? 'unknown' : 'pass';
      if (identity.status === 'consistency_fail') status = 'fail';
      else if (target.step.speaker && identity.status === 'unknown' && status !== 'fail') status = 'unknown';
      if (target.audioRequired && !audioPresent.get(target.base)) return { ...speech, identity, status: 'fail', reason: 'Clip ASMR không có luồng âm thanh thao tác' };
      const measured = analyses.get(target.base);
      if (!dubbing && target.affiliate && target.step.dialogue && measured?.parts.length && clipWindow(project.data, measured.duration, target.step.duration, measured, true).speechOverflow) return { ...speech, identity, status: 'fail', reason: 'Lời nói vượt thời lượng shot; nói đúng câu ngắn gọn hơn trong khoảng dựng, không bỏ hoặc đổi từ' };
      return { ...speech, identity, status };
    };
    // Recompute consistency for the whole current cohort, without buying ASR/vision for unselected shots.
    for (const target of targets) if (!target.stale && target.video && target.step.speaker && target.step.dialogue && analyses.has(target.base)) {
      const current = this.store.project(project.id), prior = object(object(object(current.data.qualityReviews ?? {})[target.base] ?? {}).speech ?? {});
      const speech = prior.fingerprint === target.speechHash ? prior : { status: 'unknown', semantic: 'unknown', heard: '', expected: target.step.dialogue };
      patches.set(target.base, { speech: applyIdentity({ ...speech, assetId: target.speechVideo, acoustic: analyses.get(target.base), fingerprint: target.speechHash, at: Date.now() }, target) });
    }
    const save = (): void => {
      const latest = assertCurrent(), reviews = { ...object(latest.data.qualityReviews ?? {}) };
      for (const [base, patch] of patches) reviews[base] = { ...object(reviews[base] ?? {}), ...patch };
      const production = { ...object(latest.data.production ?? {}) };
      if (project.data.nativeAudio === true || dubbing) production.speakerCohort = { fingerprint: targetHash, closePairs: cohort.closePairs, at: Date.now() };
      this.store.saveProject({ ...latest, data: { ...latest.data, production, qualityReviews: reviews } });
    };
    const outputIds: string[] = []; let failed = 0;
    for (const [index, target] of chosen.entries()) {
      assertCurrent(); const { base, step, frame, video } = target, patch = patches.get(base) ?? {};
      patch.policyFingerprint = target.policyHash;
      // A source clip can replace a generated shot; old categories are not current-plan verdicts.
      if (!frame) patch.image = undefined;
      if (!video || project.data.videoReview !== true || project.data.renderMode === 'slideshow') patch.video = undefined;
      if (!video || project.data.nativeAudio !== true && !dubbing) patch.speech = undefined;
      if (frame) {
        const state = stateFor(base, 'image', target.imageHash); let response = typeof state.response === 'string' ? state.response : '';
        if (!response) {
          if (this.store.settings().providers.text.baseUrl) {
            if (state.remoteSubmitted === true) throw new NeedsInputError('Yêu cầu kiểm tra ảnh đã gửi; đối soát trước khi gửi lại');
            checkpoint(base, 'image', target.imageHash, { remoteSubmitted: true });
            try { response = await this.client('text').reviewImages(target.prompt, target.refs.map(id => this.store.assetPath(id)), context.signal); }
            catch (error) { if (error instanceof Error && /Provider HTTP 429$/.test(error.message)) { checkpoint(base, 'image', target.imageHash, { remoteSubmitted: false }); throw new RetryableError('Vision provider đang giới hạn tốc độ'); } throw error; }
          } else {
            if (!task.accountId) throw new NeedsInputError('Chọn tài khoản Muse hoặc text provider có khả năng nhìn ảnh để kiểm tra');
            response = await this.browsers.completeText({ ...task, prompt: target.prompt, input: { refIds: target.refs }, checkpoint: state }, { ...context, checkpoint: value => checkpoint(base, 'image', target.imageHash, value) });
          }
          checkpoint(base, 'image', target.imageHash, { response });
        }
        assertCurrent(); let parsed: Record<string, unknown>;
        try { parsed = object(JSON.parse(response.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1'))); } catch { throw new Error('Image review must return valid JSON'); }
        const checks: Record<string, { status: string; reason: string }> = {};
        for (const kind of ['scene', 'face', 'outfit', ...(target.affiliate ? ['product'] : [])]) { const value = object(parsed[kind]); if (!(kind === 'product' ? ['pass', 'fail', 'unknown'] : ['pass', 'fail', 'unknown', 'not_applicable']).includes(String(value.status))) throw new Error('Invalid image review status'); checks[kind] = { status: String(value.status), reason: text(value.reason, 'Review reason', 4000) }; }
        const status = Object.values(checks).some(value => value.status === 'fail') ? 'fail' : Object.values(checks).some(value => value.status === 'unknown') || checks.scene.status === 'not_applicable' ? 'unknown' : 'pass';
        patch.image = { status, checks, modelAssessed: true, assetId: frame, fingerprint: target.imageHash, taskId: state.sourceTaskId ?? task.id, at: state.responseAt ?? Date.now() }; if (status === 'fail') failed++; outputIds.push(frame);
      }
      if (video && project.data.videoReview === true && project.data.renderMode !== 'slideshow') {
        const state = stateFor(base, 'video', target.videoHash); let response = typeof state.response === 'string' ? state.response : '';
        let frameIds = Array.isArray(state.frameIds) ? state.frameIds as string[] : [];
        let sampleTimes = Array.isArray(state.sampleTimes) ? state.sampleTimes as number[] : [];
        if (!response) {
          if (this.store.settings().providers.text.baseUrl && state.remoteSubmitted === true) throw new NeedsInputError('Review video đã gửi; đối soát trước khi gửi lại');
          if (frameIds.length !== VIDEO_REVIEW_FRAMES || frameIds.some(id => !this.store.assets().some(asset => asset.id === id))) {
            const path = this.store.assetPath(video), media = this.media(), info = await media.probe(path, context.signal);
            const window = clipWindow(project.data, info.duration, step.duration, !dubbing && project.data.nativeAudio === true && step.dialogue ? analyses.get(base) : undefined, target.affiliate);
            sampleTimes = Array.from({ length: VIDEO_REVIEW_FRAMES }, (_, index) => window.start + window.duration * (0.03 + index * 0.94 / (VIDEO_REVIEW_FRAMES - 1)));
            const folder = join(this.store.root, 'work', task.id); await mkdir(folder, { recursive: true });
            const paths = await this.withMedia(context.signal, () => media.sampleFrames(path, folder, sampleTimes, context.signal));
            try {
              frameIds = [];
              for (const path of paths) { const asset = await this.store.importAsset(path, { projectId: project.id, taskId: task.id }, context.signal); frameIds.push(asset.id); }
            } finally { if (paths.length) await rm(dirname(paths[0]), { recursive: true, force: true }); }
            checkpoint(base, 'video', target.videoHash, { frameIds, sampleTimes });
          }
          assertCurrent(); const refs = [...(frame ? [frame] : []), ...frameIds];
          const prompt = videoReviewPrompt(target.visualPlan, step.prompt, sampleTimes, !!frame, target.affiliate);
          if (this.store.settings().providers.text.baseUrl) {
            checkpoint(base, 'video', target.videoHash, { remoteSubmitted: true });
            try { response = await this.client('text').reviewImages(prompt, refs.map(id => this.store.assetPath(id)), context.signal); }
            catch (error) { if (error instanceof Error && /Provider HTTP 429$/.test(error.message)) { checkpoint(base, 'video', target.videoHash, { remoteSubmitted: false }); throw new RetryableError('Vision provider đang giới hạn tốc độ'); } throw error; }
          } else {
            if (!task.accountId) { checkpoint(base, 'video', target.videoHash, { remoteSubmitted: false }); throw new NeedsInputError('Chọn tài khoản Muse hoặc vision provider để review chuyển động video'); }
            response = await this.browsers.completeText({ ...task, prompt, input: { refIds: refs }, checkpoint: stateFor(base, 'video', target.videoHash) }, { ...context, checkpoint: value => checkpoint(base, 'video', target.videoHash, value) });
          }
          checkpoint(base, 'video', target.videoHash, { response });
        }
        assertCurrent(); const assessment = parseVideoReview(response);
        if (target.affiliate && assessment.checks.identity.status === 'not_applicable') { assessment.checks.identity.status = 'unknown'; assessment.checks.identity.reason = 'Affiliate cần đối chiếu sản phẩm với ảnh cảnh; chưa có đánh giá danh tính sản phẩm'; assessment.status = 'unknown'; }
        patch.video = { ...assessment, assetId: video, frameIds, sampleTimes, fingerprint: target.videoHash, modelAssessed: true, coverage: 'four_sampled_frames', taskId: state.sourceTaskId ?? task.id, at: state.responseAt ?? Date.now() };
        if (assessment.status === 'fail') failed++; outputIds.push(video);
      }
      if (video && (project.data.nativeAudio === true || dubbing)) {
        const acoustic = analyses.get(base)!; let heard = '', semantic = 'unknown', reviewedAt = Date.now(), reviewTaskId = task.id;
        if (step.dialogue || acoustic.voiced > 0) {
          if (this.store.settings().providers.asr.baseUrl) {
            const state = stateFor(base, 'speech', target.speechHash);
            if (state.resolved === true && typeof state.response === 'string') { heard = state.response; reviewedAt = Number(state.responseAt) || reviewedAt; reviewTaskId = typeof state.sourceTaskId === 'string' ? state.sourceTaskId : task.id; }
            else {
              if (state.remoteSubmitted === true) throw new NeedsInputError('Yêu cầu ASR đã gửi; đối soát trước khi gửi lại');
              checkpoint(base, 'speech', target.speechHash, { remoteSubmitted: true });
              heard = (await this.client('asr').transcribeTimed(this.store.assetPath(target.speechVideo!), context.signal)).text;
              checkpoint(base, 'speech', target.speechHash, { response: heard, resolved: true });
            }
            semantic = 'assessed';
          } else if (this.offline.ready() && (project.data.language === undefined || project.data.language === 'vi')) {
            try { heard = await this.offline.transcribe(this.store.assetPath(target.speechVideo!), context.signal); semantic = 'assessed'; }
            catch (error) { if (error instanceof Error && /recognized no speech.*empty/i.test(error.message)) semantic = 'assessed'; else throw error; }
          }
        }
        assertCurrent(); const transcript = step.dialogue && semantic === 'assessed' ? compareTranscripts(step.dialogue, heard) : undefined;
        const speech = applyIdentity({ assetId: target.speechVideo, heard, expected: step.dialogue || '', transcript, semantic, acoustic, fingerprint: target.speechHash, taskId: reviewTaskId, at: reviewedAt }, target);
        patch.speech = speech; if (speech.status === 'fail') failed++; outputIds.push(video);
      }
      patches.set(base, patch); save(); context.progress(0.4 + (index + 1) / Math.max(1, chosen.length) * 0.6, `Đã kiểm tra ${index + 1}/${chosen.length} shot; ${failed} kết quả chưa đạt`);
    }
    return { outputIds: [...new Set(outputIds)], message: failed ? `Có ${failed} kết quả chưa đạt; xem chi tiết trước khi dựng hoặc tạo lại` : 'Đã lưu kết quả kiểm tra; phần unknown vẫn cần review' };
  }
  private async executeDub(task: Task, project: Project, context: TaskContext): Promise<TaskResult> {
    const stage = String(task.input.stage ?? 'all');
    if (!['speech', 'check', 'render', 'all'].includes(stage)) throw new NeedsInputError('Dubbing chỉ hỗ trợ speech/check/render/all');
    const sourceAsset = this.store.asset(text(project.data.sourceAssetId, 'Source asset ID', 100));
    if (!sourceAsset.mime.startsWith('video/')) throw new Error('Dubbing cần video nguồn');
    const source = this.store.assetPath(sourceAsset.id); const sourceInfo = await this.media().probe(source, context.signal);
    if (!sourceInfo.width || !sourceInfo.height) throw new NeedsInputError('Dubbing cần video có luồng hình hợp lệ trước khi tạo giọng');
    const data = this.applyDubTranscript(project.data), initialHash = this.contentFingerprint(project.data);
    const cues = parseSrt(text(data.subtitle, 'Subtitle', 10 * 1024 * 1024));
    if (cues.length > 100 || cues.some(cue => cue.end > sourceInfo.duration + 0.001)) throw new NeedsInputError('Dubbing cần tối đa 100 cue nằm trong thời lượng video nguồn; chia dự án hoặc chỉnh SRT trước khi tạo giọng');
    const production = structuredClone(object(this.store.project(project.id).data.production ?? {}));
    const remember = (): void => {
      const latest = this.store.project(project.id); if (this.contentFingerprint(latest.data) !== initialHash) throw new NeedsInputError('Transcript/video đã đổi; giữ output trong task để review');
      this.store.saveProject({ ...latest, data: { ...latest.data, production } });
    };
    if (stage === 'check') {
      const rendered = object(production.render ?? {});
      if (rendered.inputHash !== initialHash || typeof rendered.assetId !== 'string') throw new NeedsInputError('Dựng video lồng tiếng hiện tại trước khi kiểm tra local');
      const info = await this.media().probe(this.store.assetPath(rendered.assetId), context.signal);
      const timeline = Math.abs(info.duration - sourceInfo.duration) <= 0.1 ? 'pass' : 'fail';
      const latest = this.store.project(project.id); if (this.contentFingerprint(latest.data) !== initialHash) throw new NeedsInputError('Dự án đã đổi trong lúc kiểm tra');
      this.store.saveProject({ ...latest, data: { ...latest.data, qualityReviews: { ...object(latest.data.qualityReviews ?? {}), [`${project.id}/dub`]: { speech: { status: info.hasAudio && timeline === 'pass' ? 'unknown' : 'fail', assetId: rendered.assetId, expected: cues.map(cue => cue.text).join(' '), semantic: 'unknown', reason: 'Kiểm tra local chỉ xác minh stream/thời lượng; chưa kiểm lời bằng ASR', timeline, at: Date.now() } } } } });
      return { outputIds: [rendered.assetId], message: 'Đã kiểm tra stream và timeline local; nội dung lời đọc chưa được ASR xác minh (unknown)' };
    }
    const done = object(task.checkpoint.lines ?? {}), speech = object(production.dubSpeech ?? {}); production.dubSpeech = speech;
    const audio: Array<{ path: string; start: number; duration: number }> = []; const outputIds: string[] = [];
    const voiceId = text(data.voiceId || 'alloy', 'Voice ID', 256); const provider = this.store.settings().providers.voice;
    const selected = Array.isArray(task.input.shotIds) ? new Set(task.input.shotIds as string[]) : undefined;
    const shots = buildShots(data);
    for (const [index, cue] of cues.entries()) {
      context.signal.throwIfAborted();
      if (selected && !selected.has(`${encodeURIComponent(project.id)}/${encodeURIComponent(shots[index].id)}`) && !selected.has(shots[index].id)) continue;
      const key = String(cue.index), fingerprint = createHash('sha256').update(JSON.stringify({ text: cue.text, voiceId, baseUrl: provider.baseUrl, model: provider.model })).digest('hex');
      const saved = done[key]; let line = typeof saved === 'string' ? { assetId: saved } as Record<string, unknown> : object(saved ?? {});
      if (typeof line.fingerprint === 'string' && line.fingerprint !== fingerprint) { if (hasPendingAdmission(line)) throw new NeedsInputError('Cue đã đổi khi TTS cũ chưa rõ kết quả; cần đối soát'); line = {}; }
      let assetId = typeof line.assetId === 'string' && this.store.assets().some(asset => asset.id === line.assetId) ? line.assetId : '';
      const cached = object(speech[key] ?? {});
      if ((task.input.force !== true || assetId) && cached.fingerprint === fingerprint && typeof cached.assetId === 'string' && this.store.assets().some(asset => asset.id === cached.assetId)) assetId = cached.assetId;
      if (!assetId) {
        if (stage === 'render') throw new NeedsInputError(`Chưa có lời đọc hiện tại cho cue ${cue.index}; chạy bước lời đọc trước khi dựng`);
        if (line.remoteSubmitted === true && !line.downloadUrl) throw new NeedsInputError(`Dòng ${cue.index}: TTS đã nhận yêu cầu; đối soát trước khi thử lại.`);
        text(cue.text, 'Dubbing text', 32768); line.fingerprint = fingerprint;
        let result: MediaResult;
        if (typeof line.downloadUrl === 'string') result = { url: line.downloadUrl, mime: 'audio/wav' };
        else {
          line.remoteSubmitted = true; done[key] = line; context.checkpoint({ lines: done });
          result = await this.client('voice').speak(cue.text, voiceId, context.signal);
          if (result.url) { line.downloadUrl = result.url; context.checkpoint({ lines: done }); }
        }
        assetId = (await this.saveMedia(result, task, context.signal)).id; line.assetId = assetId; done[key] = line; context.checkpoint({ lines: done });
      }
      if (!this.store.asset(assetId).mime.startsWith('audio/')) throw new Error('Dubbing cue cần audio asset');
      speech[key] = { assetId, fingerprint }; remember(); outputIds.push(assetId);
      audio.push({ path: this.store.assetPath(assetId), start: cue.start, duration: cue.end - cue.start }); context.progress((index + 1) / (cues.length + 1) * 0.8, `Đã lưu lời đọc cue ${cue.index}`);
    }
    if (stage === 'speech') return { outputIds, message: 'Đã lưu lời đọc; sẵn sàng dựng từ output' };
    const folder = join(this.store.root, 'work', task.id); await mkdir(folder, { recursive: true }); const output = join(folder, 'dub.mp4');
    try { await this.withMedia(context.signal, () => this.media().dub(source, audio, output, { width: sourceInfo.width, height: sourceInfo.height, keepAudio: data.keepAudio === true, volume: 1, fitVoice: true, ...(data.voiceVolume !== undefined ? { voiceVolume: data.voiceVolume as number } : {}) }, context)); }
    catch (error) { if (error instanceof Error && /^Voice fit/.test(error.message)) throw new NeedsInputError(`Lời đọc chưa vừa mốc SRT; tăng thời gian cue hoặc chỉnh lời. Audio đã tạo được giữ để dùng lại. ${error.message}`); throw error; }
    const info = await this.media().probe(output, context.signal); const asset = await this.store.importAsset(output, { projectId: task.projectId, taskId: task.id, duration: info.duration }, context.signal);
    production.render = { assetId: asset.id, inputHash: initialHash }; remember();
    const latest = this.store.project(project.id); this.store.saveProject({ ...latest, data: { ...latest.data, productionStale: false } });
    context.checkpoint({ outputIds: [asset.id] }); await this.exportOutput(asset, task, context.signal); return { outputIds: [asset.id] };
  }
  private applyDubTranscript(data: Record<string, unknown>): Record<string, unknown> {
    if (typeof data.script !== 'string' || !data.script.trim() || typeof data.subtitle !== 'string' || !data.subtitle.trim()) return data;
    const cues = parseSrt(data.subtitle); const script = text(data.script, 'Transcript', 1024 * 1024);
    let blocks = cues.length === 1 ? [script.replace(/\n\s*\n/g, '\n')] : script.split(/\n\s*\n/).map(block => block.trim());
    if (blocks.length !== cues.length) blocks = script.split(/\r?\n/).map(line => line.trim());
    if (blocks.length !== cues.length || blocks.some(block => !block)) throw new Error('Số block/dòng transcript phải khớp số cue SRT để giữ timestamp');
    return { ...data, subtitle: formatSrt(cues.map((cue, index) => ({ ...cue, text: blocks[index] }))) };
  }
  private contentFingerprint(data: Record<string, unknown>): string {
    const content = { ...data }; for (const key of ['production', 'qualityReviews', 'planning', 'outputIds', 'productionStale']) delete content[key];
    return createHash('sha256').update(JSON.stringify(content)).digest('hex');
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
    if (this.closed) return; this.closed = true; this.closing.abort(); await this.queue.close(); await this.codex.close(); await this.browsers.shutdown(); this.store.close(); this.removeAllListeners();
  }
}
