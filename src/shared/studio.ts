export type ProjectKind = 'studio' | 'srt' | 'film' | 'series' | 'affiliate' | 'dub';
export type TaskStatus = 'draft' | 'queued' | 'running' | 'waiting_input' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export type TaskKind = 'image' | 'video' | 'image-to-video' | 'merge' | 'slideshow' | 'dub' | 'speech' | 'pipeline';
export interface Shot { id: string; prompt: string; duration: number; dialogue?: string; speaker?: string; assetId?: string; voiceId?: string }
export interface Character { id: string; name: string; description: string; assetId?: string; voiceId?: string }
export interface Project { id: string; name: string; kind: ProjectKind; createdAt: number; updatedAt: number; data: Record<string, unknown> }
export interface Task {
  id: string; projectId: string; name: string; kind: TaskKind; prompt: string; status: TaskStatus;
  accountId: string; position: number; progress: number; message: string; error: string;
  attempts: number; createdAt: number; updatedAt: number; input: Record<string, unknown>; checkpoint: Record<string, unknown>; outputIds: string[];
}
export interface Account { id: string; name: string; url: string; proxyId: string; status: string; createdAt: number }
export interface Proxy { id: string; name: string; server: string; username: string; hasPassword: boolean }
export interface Asset { id: string; projectId: string; taskId: string; name: string; mime: string; size: number; createdAt: number; duration?: number }
export interface LogEntry { id: number; at: number; level: string; message: string; taskId: string }
export interface ProviderSettings { baseUrl: string; model: string; hasKey: boolean }
export interface Settings {
  theme: 'light' | 'dark' | 'system'; language: 'vi' | 'en'; generationConcurrency: number; mediaConcurrency: number;
  outputDir: string; browserPath: string; ffmpegPath: string; ffprobePath: string; browserVisible: boolean;
  providers: Record<string, ProviderSettings>; museSelectors: Record<string, string>;
}
export interface Capability { id: string; ready: boolean; message: string }
export interface CodexJob { id: string; mode: 'plan' | 'edit'; prompt: string; status: string; log: string; result: string; createdAt: number; approved: boolean }
export interface LicenseView { valid: boolean; mode: string; expiresAt?: number; message: string }
export interface StudioState {
  version: string; projects: Project[]; tasks: Task[]; accounts: Account[]; proxies: Proxy[]; assets: Asset[];
  settings: Settings; logs: LogEntry[]; capabilities: Capability[]; queuePaused: boolean; codexJobs: CodexJob[]; license: LicenseView;
}
export type StudioCommand =
  | 'state' | 'project.save' | 'project.delete' | 'task.create' | 'task.update' | 'task.action' | 'task.reorder'
  | 'account.save' | 'account.delete' | 'account.open' | 'account.close' | 'account.check'
  | 'proxy.save' | 'proxy.delete' | 'proxy.test' | 'settings.save' | 'secret.save'
  | 'queue.pause' | 'queue.resume' | 'asset.delete' | 'asset.export' | 'asset.open' | 'media.import'
  | 'studio.plan' | 'studio.run' | 'srt.parse' | 'srt.export' | 'media.merge'
  | 'voice.list' | 'voice.sample' | 'voice.favorite' | 'voice.transcribe' | 'voice.translate'
  | 'market.catalog' | 'market.login' | 'market.logout' | 'market.buy' | 'market.library' | 'market.download'
  | 'shopee.product' | 'codex.status' | 'codex.run' | 'codex.cancel' | 'codex.approve'
  | 'license.activate' | 'license.deactivate' | 'license.trial' | 'update.check' | 'update.install' | 'diagnostics';
export interface StudioBridge {
  invoke<T = unknown>(command: StudioCommand, input?: Record<string, unknown>): Promise<T>;
  onChanged(listener: () => void): () => void;
  pickFiles(): Promise<Asset[]>;
  pickFolder(): Promise<string | null>;
  mediaUrl(id: string): string;
}
export interface TaskContext {
  signal: AbortSignal;
  progress(value: number, message: string): void;
  checkpoint(value: Record<string, unknown>): void;
}
export interface TaskResult { outputIds: string[]; message?: string }
export interface MediaInput { path: string; duration?: number; caption?: string }
export interface MediaOptions {
  width?: number; height?: number; fps?: number; musicPath?: string; volume?: number; keepAudio?: boolean;
  subtitlePath?: string; title?: string;
}
