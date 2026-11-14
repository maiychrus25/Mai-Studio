import { lstat, mkdtemp, rename, rm } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import type { MediaTools } from './media';
import type { MediaInput, MediaOptions, TaskContext } from '../shared/studio';

export interface RecapInput { path: string; speech?: { start: number; end: number } }
// trimStart is in source seconds; start/duration use the rendered recap frame clock.
export interface RecapSegment { inputIndex: number; trimStart: number; duration: number; start: number }

export async function createRecap(media: MediaTools, inputs: RecapInput[], output: string, options: MediaOptions, context: TaskContext): Promise<{ path: string; duration: number; segments: RecapSegment[] }> {
  context.signal.throwIfAborted();
  if (!Array.isArray(inputs) || !inputs.length || inputs.some(input => !input || typeof input.path !== 'string' || !input.path.trim() || input.path.includes('\0'))) throw new Error('Recap requires regular video input paths');
  if (typeof output !== 'string' || !output.trim() || output.includes('\0')) throw new Error('Invalid recap output path');
  const target = resolve(output); const extension = extname(target).toLowerCase();
  if (inputs.some(input => resolve(input.path) === target)) throw new Error('Recap output cannot overwrite a source input');
  try { if (!(await lstat(target)).isFile()) throw new Error('Recap output must be a regular file'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!['.mp4', '.mov', '.mkv'].includes(extension)) throw new Error('Recap output format must be .mp4, .mov or .mkv');

  const clips: MediaInput[] = []; const segments: RecapSegment[] = [];
  let duration = 0; let width = options.width; let height = options.height; const fps = options.fps ?? 30;
  const offset = Math.max(0, inputs.length - 3);
  // SeriesStudio._recap: RECAP_SHOTS=3, RECAP_MAX=4.5; the caller supplies eligible clips in order.
  for (const [index, input] of inputs.slice(-3).entries()) {
    const info = await media.probe(input.path, context.signal);
    if (!info.width || !info.height) throw new Error('Recap requires video inputs');
    width ??= info.width; height ??= info.height;
    const speech = input.speech;
    if (speech !== undefined && (!speech || !Number.isFinite(speech.start) || !Number.isFinite(speech.end) || speech.start < 0 || speech.end <= speech.start || speech.end > info.duration)) throw new Error('Invalid recap QA speech span: expected finite source times within the clip');
    // _recap:569–572 keeps a 0.15s lead, 0.35s tail, at least 1.2s, capped at 4.5s.
    // No QA means a tail fallback, which does not establish that dialogue was retained.
    const sourceStart = speech ? Math.max(0, speech.start - 0.15) : Math.max(0, info.duration - 4.5);
    const length = speech ? Math.min(4.5, Math.max(1.2, speech.end + 0.35 - sourceStart)) : Math.min(info.duration, 4.5);
    const trimStart = Math.round(sourceStart * 1000) / 1000;
    const firstFrame = Math.round(duration * fps); const lastFrame = Math.round((duration + length) * fps);
    segments.push({ inputIndex: offset + index, trimStart, duration: (lastFrame - firstFrame) / fps, start: firstFrame / fps });
    clips.push({ path: input.path, trimStart, trimEnd: info.duration, duration: length, start: duration });
    duration += length;
  }
  const work = await mkdtemp(join(dirname(target), '.mai-recap-'));
  try {
    const rendered = join(work, `recap${extension}`);
    const fadeIn = Math.min(0.3, duration); const fadeOut = Math.min(0.4, duration);
    await media.merge(clips, rendered, { width, height, fps: options.fps, fit: options.fit, keepAudio: true, fadeIn, fadeOut, audioFadeIn: fadeIn, audioFadeOut: fadeOut }, context);
    const verified = await media.probe(rendered, context.signal);
    context.signal.throwIfAborted();
    await rename(rendered, target);
    return { path: target, duration: verified.duration, segments };
  } finally { await rm(work, { recursive: true, force: true }); }
}
