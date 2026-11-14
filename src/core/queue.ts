import type { Task, TaskContext, TaskResult } from '../shared/studio';
import { Store, redact } from './store';

export class NeedsInputError extends Error { constructor(message: string) { super(message); this.name = 'NeedsInputError'; } }
export class RetryableError extends Error { constructor(message: string, readonly delayMs = 500) { super(message); this.name = 'RetryableError'; } }
export class JobQueue {
  private readonly running = new Map<string, { controller: AbortController; promise: Promise<void>; accountId: string; media: boolean }>();
  private closed = false;
  private paused = false;
  private scheduled = false;
  private wakeTimer?: ReturnType<typeof setTimeout>;
  private limits: { generationConcurrency: number; mediaConcurrency: number };
  constructor(private readonly store: Store, private readonly runner: (task: Task, context: TaskContext) => Promise<TaskResult>, limits?: { generationConcurrency: number; mediaConcurrency: number }, private readonly changed: () => void = () => {}) {
    this.limits = limits ?? { generationConcurrency: 2, mediaConcurrency: 1 };
    this.paused = store.queuePaused();
    for (const task of store.tasks()) if (task.status === 'running') store.updateTask(task.id, { status: 'interrupted', error: 'Ứng dụng đã dừng trong lúc chạy. Kiểm tra checkpoint trước khi tiếp tục.', message: 'Cần kiểm tra và tiếp tục thủ công' });
    this.pump();
  }
  isPaused(): boolean { return this.paused; }
  setLimits(limits: { generationConcurrency: number; mediaConcurrency: number }): void { this.limits = limits; this.pump(); }
  pause(): void { this.paused = true; this.store.setQueuePaused(true); this.changed(); }
  resume(): void { this.paused = false; this.store.setQueuePaused(false); this.pump(); this.changed(); }
  enqueue(ids: string[]): void {
    if (this.closed) throw new Error('Hàng đợi đang đóng');
    const tasks = ids.map(id => this.store.task(id));
    if (tasks.some(task => this.running.has(task.id))) throw new Error('Task đang chạy');
    for (const task of tasks) {
      if (task.status === 'succeeded') continue;
      if (task.checkpoint.remoteSubmitted === true && !task.checkpoint.threadUrl && !task.checkpoint.remoteId && !task.checkpoint.downloadUrl) {
        this.store.updateTask(task.id, { status: 'waiting_input', message: 'Chưa xác định remote đã nhận việc. Cần đối soát trước khi gửi lại.' }); continue;
      }
      this.store.updateTask(task.id, { status: 'queued', error: '', message: 'Đang chờ', checkpoint: { ...task.checkpoint, retryAt: 0, retryBase: task.attempts } });
    }
    this.changed(); this.pump();
  }
  async cancel(ids: string[], status: 'cancelled' | 'paused' = 'cancelled'): Promise<void> {
    for (const id of ids) this.store.task(id);
    const pending: Promise<void>[] = [];
    for (const id of ids) {
      if (['succeeded', 'failed', 'cancelled'].includes(this.store.task(id).status)) continue;
      const active = this.running.get(id);
      this.store.updateTask(id, { status, message: status === 'paused' ? 'Đã tạm dừng' : 'Đã hủy' });
      if (active) { active.controller.abort(); pending.push(active.promise); }
    }
    this.changed(); await Promise.allSettled(pending); this.pump();
  }
  private media(task: Task): boolean { return ['merge', 'slideshow', 'dub'].includes(task.kind); }
  private pump(): void {
    if (this.scheduled || this.closed || this.paused) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false; if (this.closed || this.paused) return;
      clearTimeout(this.wakeTimer);
      let nextWake = Infinity;
      for (const task of this.store.tasks().filter(value => value.status === 'queued')) {
        const retryAt = Number(task.checkpoint.retryAt) || 0;
        if (retryAt > Date.now()) { nextWake = Math.min(nextWake, retryAt); continue; }
        const media = this.media(task); const active = [...this.running.values()];
        if (active.filter(value => value.media === media).length >= (media ? this.limits.mediaConcurrency : this.limits.generationConcurrency)) continue;
        if (task.accountId && active.some(value => value.accountId === task.accountId)) continue;
        const controller = new AbortController();
        this.store.updateTask(task.id, { status: 'running', progress: 0, attempts: task.attempts + 1, message: 'Đang chạy' });
        const promise = this.execute(this.store.task(task.id), controller);
        this.running.set(task.id, { controller, promise, accountId: task.accountId, media });
      }
      if (Number.isFinite(nextWake)) this.wakeTimer = setTimeout(() => this.pump(), Math.max(1, nextWake - Date.now()));
      this.changed();
    });
  }
  private async execute(task: Task, controller: AbortController): Promise<void> {
    // Defer one microtask so the lease is registered before a synchronous runner settles.
    await Promise.resolve();
    const context: TaskContext = {
      signal: controller.signal,
      progress: (progress, message) => { if (!controller.signal.aborted) { this.store.updateTask(task.id, { progress, message: redact(message) }); this.changed(); } },
      checkpoint: value => { controller.signal.throwIfAborted(); this.store.updateTask(task.id, { checkpoint: { ...this.store.task(task.id).checkpoint, ...value } }); },
    };
    try {
      const result = await this.runner(task, context); controller.signal.throwIfAborted();
      this.store.updateTask(task.id, { status: 'succeeded', progress: 1, outputIds: result.outputIds, message: result.message ?? 'Hoàn tất', error: '' });
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : 'Công việc thất bại');
      if (!controller.signal.aborted) {
        const current = this.store.task(task.id); const retries = Number(task.input.retryLimit ?? 2);
        const base = Number(current.checkpoint.retryBase) || 0;
        if (error instanceof RetryableError && current.attempts - base <= retries) {
          const delayMs = Math.max(1, Math.min(error.delayMs * 2 ** Math.max(0, current.attempts - base - 1), 30000));
          this.store.updateTask(task.id, { status: 'queued', error: '', message: `Thử lại sau ${delayMs} ms: ${message}`, checkpoint: { ...current.checkpoint, retryAt: Date.now() + delayMs } });
        } else this.store.updateTask(task.id, { status: error instanceof NeedsInputError ? 'waiting_input' : 'failed', error: message, message });
        this.store.log(message, 'error', task.id);
      }
    } finally { this.running.delete(task.id); this.changed(); this.pump(); }
  }
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true; clearTimeout(this.wakeTimer);
    for (const [id, active] of this.running) { this.store.updateTask(id, { status: 'interrupted', message: 'Đã checkpoint khi đóng ứng dụng' }); active.controller.abort(); }
    await Promise.allSettled([...this.running.values()].map(value => value.promise));
  }
}
