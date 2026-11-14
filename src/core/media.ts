import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdtemp, readFile, rename, rm, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import type { MediaInput, MediaOptions, TaskContext } from '../shared/studio';

export interface Cue { index: number; start: number; end: number; text: string }
const MAX_TIME = 359999.999;
const MAX_INPUTS = 100;
const MAX_DURATION = 21600;
const MAX_BYTES = 20 * 1024 ** 3;

function number(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label}: expected ${min}–${max}`);
  return value;
}

function checkCues(cues: Cue[]): void {
  if (!Array.isArray(cues) || !cues.length || cues.length > 1000) throw new Error('Invalid SRT cue count: expected 1–1000');
  let lastIndex = 0;
  let lastEnd = 0;
  for (const cue of cues) {
    if (!cue || !Number.isSafeInteger(cue.index) || cue.index <= lastIndex) throw new Error('Invalid cue index order');
    number(cue.start, 0, MAX_TIME, 'cue start time'); number(cue.end, 0, MAX_TIME, 'cue end time');
    if (Math.round(cue.end * 1000) <= Math.round(cue.start * 1000) || cue.start < lastEnd) throw new Error('Invalid cue time: reversed, overlapping or shorter than a millisecond');
    if (typeof cue.text !== 'string' || !cue.text.trim() || Buffer.byteLength(cue.text) > 32768 || cue.text.includes('\0') || /\n\s*\n/.test(cue.text)) throw new Error('Invalid cue text');
    lastIndex = cue.index; lastEnd = cue.end;
  }
}

export function parseSrt(text: string): Cue[] {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 10 * 1024 ** 2) throw new Error('Invalid SRT text size');
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) throw new Error('Empty SRT');
  function time(value: string): number {
    const match = /^(\d{2}):([0-5]\d):([0-5]\d),(\d{3})$/.exec(value);
    if (!match) throw new Error(`Invalid SRT timecode: ${value}`);
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
  }
  const cues = normalized.split(/\n\s*\n/).map(block => {
    const [index, timing, ...lines] = block.split('\n');
    const match = timing && /^(\S+)\s+-->\s+(\S+)$/.exec(timing);
    if (!/^\d+$/.test(index) || !match) throw new Error('Invalid SRT cue header');
    return { index: Number(index), start: time(match[1]), end: time(match[2]), text: lines.join('\n') };
  });
  checkCues(cues);
  return cues;
}

export function formatSrt(cues: Cue[]): string {
  checkCues(cues);
  function time(value: number): string {
    const ms = Math.round(value * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  }
  return cues.map(cue => `${cue.index}\n${time(cue.start)} --> ${time(cue.end)}\n${cue.text.replace(/\r\n?/g, '\n')}`).join('\n\n') + '\n';
}

async function file(path: string): Promise<string> {
  if (typeof path !== 'string' || !path.trim() || path.includes('\0')) throw new Error('Invalid file path');
  const absolute = resolve(path);
  const info = await lstat(absolute);
  if (!info.isFile()) throw new Error(`Expected a regular file: ${absolute}`);
  if (!info.size || info.size > MAX_BYTES) throw new Error(`File size limit: 1 byte–${MAX_BYTES}`);
  return absolute;
}

// Limit processes even when callers use several MediaTools instances.
let active = 0;
const pending: Array<() => void> = [];
async function acquire(signal: AbortSignal): Promise<() => void> {
  signal.throwIfAborted();
  await new Promise<void>((resolvePermit, reject) => {
    const enter = () => { signal.removeEventListener('abort', abort); active++; resolvePermit(); };
    const abort = () => {
      const index = pending.indexOf(enter);
      if (index >= 0) pending.splice(index, 1);
      reject(signal.reason);
    };
    if (active < 2) enter();
    else { pending.push(enter); signal.addEventListener('abort', abort, { once: true }); }
  });
  return () => { active--; pending.shift()?.(); };
}

async function run(binary: string, args: string[], signal?: AbortSignal, timeout = 30000, cwd?: string, allowNonzero = false): Promise<{ stdout: string; stderr: string }> {
  const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeout)]);
  const release = await acquire(bounded);
  try {
    bounded.throwIfAborted();
    return await new Promise((resolveProcess, reject) => {
      const child = spawn(binary, args, { shell: false, windowsHide: true, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = ''; let size = 0; let failure: Error | undefined;
      let force: ReturnType<typeof setTimeout> | undefined;
      const stop = (error: Error) => {
        failure ??= error;
        child.kill('SIGTERM');
        force ??= setTimeout(() => child.kill('SIGKILL'), 750);
      };
      const abort = () => stop(bounded.reason instanceof Error ? bounded.reason : new Error('Media operation cancelled'));
      bounded.addEventListener('abort', abort, { once: true });
      if (bounded.aborted) abort();
      const capture = (data: Buffer, errorStream: boolean) => {
        size += data.length;
        if (size > 1024 * 1024) { stop(new Error('Media process output limit exceeded')); return; }
        if (errorStream) stderr += data.toString(); else stdout += data.toString();
      };
      child.stdout.on('data', (data: Buffer) => capture(data, false));
      child.stderr.on('data', (data: Buffer) => capture(data, true));
      child.on('error', error => { failure ??= new Error(`Cannot run ${binary}: ${error.message}. Configure an installed FFmpeg/ffprobe binary.`, { cause: error }); });
      child.on('close', code => {
        bounded.removeEventListener('abort', abort);
        if (force) clearTimeout(force);
        if (failure) reject(failure);
        else if (code !== 0 && !allowNonzero) reject(new Error(`Media process exited ${code}: ${stderr.slice(-8192)}`));
        else resolveProcess({ stdout, stderr });
      });
    });
  } finally { release(); }
}

type Probe = { duration: number; width?: number; height?: number; hasAudio: boolean };
type RenderOptions = MediaOptions & { width: number; height: number; fps: number; volume: number; keepAudio: boolean };

function renderOptions(options: MediaOptions): RenderOptions {
  const width = number(options.width ?? 1280, 16, 4096, 'width');
  const height = number(options.height ?? 720, 16, 4096, 'height');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width % 2 || height % 2 || width * height > 4096 * 2160) throw new Error('Invalid width/height: even integers, at most 8847360 pixels');
  const fps = number(options.fps ?? 30, 1, 60, 'fps');
  const volume = number(options.volume ?? 1, 0, 4, 'volume');
  if (options.keepAudio !== undefined && typeof options.keepAudio !== 'boolean') throw new Error('Invalid keepAudio');
  if (options.title !== undefined && (typeof options.title !== 'string' || options.title.length > 4096 || options.title.includes('\0'))) throw new Error('Invalid title');
  return { ...options, width, height, fps, volume, keepAudio: options.keepAudio ?? true };
}

export class MediaTools {
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;

  constructor(options: { ffmpegPath?: string; ffprobePath?: string } = {}) {
    this.ffmpegPath = options.ffmpegPath ||
      (require('ffmpeg-static') as string | null)?.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2') || 'ffmpeg';
    this.ffprobePath = options.ffprobePath || 'ffprobe';
  }

  async probe(path: string, signal?: AbortSignal): Promise<Probe> {
    signal?.throwIfAborted();
    const input = await file(path);
    let result: Awaited<ReturnType<typeof run>>;
    try {
      result = await run(this.ffprobePath, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=duration:stream=codec_type,width,height,duration', '-of', 'json', input], signal);
    } catch (error) {
      if (!(error instanceof Error) || !((error.cause as NodeJS.ErrnoException | undefined)?.code === 'ENOENT')) throw error;
      const metadata = await run(this.ffmpegPath, ['-hide_banner', '-nostdin', '-protocol_whitelist', 'file,pipe', '-i', input], signal, 30000, undefined, true);
      const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(metadata.stderr);
      if (!duration) throw new Error('Invalid media metadata: cannot read duration. Install/configure ffprobePath for this media format.');
      const dimensions = /Stream[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(metadata.stderr);
      const seconds = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
      number(seconds, 0.001, MAX_TIME, 'media duration');
      return { duration: seconds, ...(dimensions ? { width: Number(dimensions[1]), height: Number(dimensions[2]) } : {}), hasAudio: /Stream[^\n]*Audio:/.test(metadata.stderr) };
    }
    const json = JSON.parse(result.stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }> };
    if (!Array.isArray(json.streams) || !json.streams.length) throw new Error('Invalid ffprobe metadata: no media streams');
    const duration = Number(json.format?.duration ?? json.streams.find(stream => stream.duration && stream.duration !== 'N/A')?.duration);
    number(duration, 0.001, MAX_TIME, 'media duration');
    const video = json.streams.find(stream => stream.codec_type === 'video');
    return { duration, ...(video ? { width: number(video.width, 1, 65536, 'media width'), height: number(video.height, 1, 65536, 'media height') } : {}), hasAudio: json.streams.some(stream => stream.codec_type === 'audio') };
  }

  async merge(inputs: MediaInput[], output: string, options: MediaOptions, context: TaskContext): Promise<void> {
    await this.sequence(inputs, output, options, context, false);
  }

  async slideshow(inputs: MediaInput[], output: string, options: MediaOptions, context: TaskContext): Promise<void> {
    await this.sequence(inputs, output, options, context, true);
  }

  private async sequence(inputs: MediaInput[], output: string, options: MediaOptions, context: TaskContext, images: boolean): Promise<void> {
    context.signal.throwIfAborted();
    const settings = renderOptions(options);
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > MAX_INPUTS) throw new Error('Invalid input count: expected 1–100');
    const args: string[] = [];
    const filters: string[] = [];
    const clips: Array<{ path: string; duration: number; start: number; hasAudio: boolean }> = [];
    let duration = 0;
    for (const input of inputs) {
      if (!input || typeof input !== 'object') throw new Error('Invalid media input');
      const path = await file(input.path);
      if (images) await run(this.ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', '-threads', '1', '-protocol_whitelist', 'file,pipe', '-i', path, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-'], context.signal);
      const info = images ? undefined : await this.probe(path, context.signal);
      if (info && (!info.width || !info.height)) throw new Error('Merge requires video inputs');
      const length = number(input.duration ?? (images ? 5 : info?.duration), 0.001, 3600, 'input duration');
      const start = number(input.start === undefined ? duration : input.start, 0, MAX_DURATION, 'input start');
      if (start < duration - 1e-9) throw new Error('Invalid media timeline: overlapping or reversed starts');
      const position = Math.max(start, duration);
      clips.push({ path, duration: length, start: position, hasAudio: info?.hasAudio ?? false });
      duration = number(position + length, 0.001, MAX_DURATION, 'total timeline duration');
    }
    const hasAudio = settings.keepAudio && clips.some(clip => clip.hasAudio);
    const absolute = inputs.some(input => input.start !== undefined);
    const segments: string[] = [];
    let end = 0;
    for (const [index, clip] of clips.entries()) {
      // Quantize absolute boundaries once so fractional gaps cannot accumulate extra frames.
      const firstFrame = Math.round(clip.start * settings.fps);
      const lastFrame = Math.round((clip.start + clip.duration) * settings.fps);
      const length = absolute ? (lastFrame - firstFrame) / settings.fps : clip.duration;
      if (absolute && lastFrame <= firstFrame) throw new Error('Cue duration is shorter than an output frame; increase fps');
      const gapFrames = firstFrame - Math.round(end * settings.fps);
      const gap = absolute ? gapFrames / settings.fps : clip.start - end;
      if (gap > 1e-9) {
        filters.push(`color=c=black:s=${settings.width}x${settings.height}:r=${settings.fps}:d=${gap},trim=end_frame=${gapFrames},setsar=1,format=yuv420p[gapV${index}]`);
        if (hasAudio) filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${gap}[gapA${index}]`);
        segments.push(`[gapV${index}]${hasAudio ? `[gapA${index}]` : ''}`);
      }
      args.push('-threads', '1', ...(images ? ['-loop', '1', '-framerate', String(settings.fps)] : []), '-protocol_whitelist', 'file,pipe', '-i', clip.path);
      filters.push(`[${index}:v:0]trim=duration=${length},setpts=PTS-STARTPTS,${this.scale(settings)},tpad=stop_mode=clone:stop_duration=${length},trim=${absolute ? `end_frame=${lastFrame - firstFrame}` : `duration=${length}`}[v${index}]`);
      if (hasAudio) filters.push(clip.hasAudio ? `[${index}:a:0]atrim=duration=${length},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${length}[a${index}]` : `anullsrc=r=48000:cl=stereo,atrim=duration=${length}[a${index}]`);
      segments.push(`[v${index}]${hasAudio ? `[a${index}]` : ''}`);
      end = absolute ? lastFrame / settings.fps : clip.start + clip.duration;
    }
    filters.push(segments.join('') + `concat=n=${segments.length}:v=1:a=${hasAudio ? 1 : 0}[${absolute ? 'concatenated' : 'video'}]${hasAudio ? '[sourceAudio]' : ''}`);
    // Concat cannot infer the duration of a single-frame silent segment.
    if (absolute) filters.push(`[concatenated]setpts=N/(${settings.fps}*TB)[video]`);
    await this.render(args, filters, 'video', hasAudio ? 'sourceAudio' : undefined, clips.map(clip => clip.path), clips.length, duration, output, settings, context);
  }

  async dub(videoPath: string, audioInputs: Array<{ path: string; start: number; duration?: number }>, output: string, options: MediaOptions, context: TaskContext): Promise<void> {
    context.signal.throwIfAborted();
    const settings = renderOptions(options);
    if (!Array.isArray(audioInputs) || !audioInputs.length || audioInputs.length > MAX_INPUTS) throw new Error('Invalid audio input count: expected 1–100');
    const video = await file(videoPath);
    const info = await this.probe(video, context.signal);
    if (!info.width || !info.height) throw new Error('Dub requires video input');
    const duration = number(info.duration, 0.001, MAX_DURATION, 'video duration');
    const args = ['-threads', '1', '-protocol_whitelist', 'file,pipe', '-i', video];
    const filters = [`[0:v:0]setpts=PTS-STARTPTS,${this.scale(settings)}[video]`];
    const paths = [video];
    const labels: string[] = [];
    if (settings.keepAudio && info.hasAudio) {
      filters.push(`[0:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${duration}[original]`);
      labels.push('[original]');
    }
    for (const [index, input] of audioInputs.entries()) {
      if (!input || typeof input !== 'object') throw new Error('Invalid audio input');
      const path = await file(input.path);
      const audio = await this.probe(path, context.signal);
      if (!audio.hasAudio) throw new Error('Dub input has no audio stream');
      const start = number(input.start, 0, duration, 'audio start');
      const length = number(input.duration ?? audio.duration, 0.001, 3600, 'audio duration');
      if (start + length > duration + 0.001) throw new Error('Audio duration/start exceeds video timeline');
      paths.push(path); args.push('-threads', '1', '-protocol_whitelist', 'file,pipe', '-i', path);
      filters.push(`[${index + 1}:a:0]atrim=duration=${length},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(start * 1000)}:all=1,apad,atrim=duration=${duration}[dub${index}]`);
      labels.push(`[dub${index}]`);
    }
    filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,alimiter=limit=0.95:latency=1[sourceAudio]`);
    await this.render(args, filters, 'video', 'sourceAudio', paths, audioInputs.length + 1, duration, output, settings, context);
  }

  private scale(options: RenderOptions): string {
    return `scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease,pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${options.fps},format=yuv420p`;
  }

  private async render(args: string[], filters: string[], video: string, audio: string | undefined, paths: string[], inputCount: number, duration: number, output: string, options: RenderOptions, context: TaskContext): Promise<void> {
    if (typeof output !== 'string' || !output.trim() || output.includes('\0')) throw new Error('Invalid output path');
    const target = resolve(output);
    if (paths.includes(target)) throw new Error('Output cannot overwrite a source input');
    const extension = extname(target).toLowerCase();
    const format = extension === '.mp4' ? 'mp4' : extension === '.mov' ? 'mov' : extension === '.mkv' ? 'matroska' : undefined;
    if (!format) throw new Error('Output format must be .mp4, .mov or .mkv (H.264/AAC)');
    try { if (!(await lstat(target)).isFile()) throw new Error('Output must be a regular file'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (options.musicPath !== undefined) {
      const music = await file(options.musicPath);
      if (music === target) throw new Error('Output cannot overwrite music input');
      const info = await this.probe(music, context.signal);
      if (!info.hasAudio) throw new Error('Music input has no audio stream');
      number(info.duration, 0.001, 3600, 'music duration');
      args.push('-threads', '1', '-protocol_whitelist', 'file,pipe', '-i', music);
      const loop = info.duration < duration ? `aloop=loop=-1:size=${Math.ceil(info.duration * 48000)},` : '';
      filters.push(`[${inputCount}:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,${loop}volume=${options.volume},atrim=duration=${duration}[music]`);
      if (audio) { filters.push(`[${audio}][music]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95:latency=1[mixed]`); audio = 'mixed'; }
      else audio = 'music';
      inputCount++;
    }
    if (options.overlayPath !== undefined) {
      const overlay = await file(options.overlayPath);
      if (overlay === target) throw new Error('Output cannot overwrite overlay input');
      args.push('-threads', '1', '-f', 'image2', '-pattern_type', 'none', '-c:v', 'png', '-protocol_whitelist', 'file,pipe', '-i', overlay);
      filters.push(`[${video}][${inputCount}:v:0]overlay=x=0:y=0:eof_action=repeat:repeatlast=1[overlaid]`);
      video = 'overlaid';
    }
    // Conservative free-space floor; FFmpeg still reports actual ENOSPC without publishing.
    for (const directory of new Set([tmpdir(), dirname(target)])) {
      const disk = await statfs(directory);
      if (disk.bavail * disk.bsize < 64 * 1024 ** 2) throw new Error('Insufficient free disk space for media render');
    }
    const work = await mkdtemp(join(tmpdir(), 'mai-media-'));
    let staging: string | undefined;
    try {
      if (options.subtitlePath !== undefined) {
        const subtitle = await file(options.subtitlePath);
        if (subtitle === target) throw new Error('Output cannot overwrite subtitle input');
        const info = await lstat(subtitle);
        if (info.size > 10 * 1024 ** 2) throw new Error('Subtitle file limit: 10 MiB');
        parseSrt(await readFile(subtitle, 'utf8'));
        // A controlled basename avoids both levels of FFmpeg filter escaping on every OS.
        await copyFile(subtitle, join(work, 'subtitles.srt'));
        filters.push(`[${video}]subtitles=filename=subtitles.srt[subtitled]`); video = 'subtitled';
      }
      context.signal.throwIfAborted(); context.progress(0, 'Rendering CPU media');
      const rendered = join(work, 'render.part');
      const command = ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-filter_complex_threads', '1', ...args, '-filter_complex', filters.join(';'), '-map', `[${video}]`];
      if (audio) command.push('-map', `[${audio}]`, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000');
      else command.push('-an');
      command.push('-t', String(duration), '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p');
      if (options.title !== undefined) command.push('-metadata', `title=${options.title}`);
      if (format !== 'matroska') command.push('-movflags', '+faststart');
      command.push('-f', format, rendered);
      await run(this.ffmpegPath, command, context.signal, 15 * 60 * 1000, work);
      const verified = await this.probe(rendered, context.signal);
      if (!verified.width || !verified.height) throw new Error('Rendered output contains no video');
      context.signal.throwIfAborted();
      // Same-filesystem staging makes publication atomic even when OS temp is on another disk.
      staging = await mkdtemp(join(dirname(target), '.mai-publish-'));
      const ready = join(staging, 'output.part');
      await copyFile(rendered, ready, constants.COPYFILE_EXCL);
      context.progress(1, 'Publishing rendered media');
      context.signal.throwIfAborted();
      await rename(ready, target);
    } finally {
      await rm(work, { recursive: true, force: true });
      if (staging) await rm(staging, { recursive: true, force: true });
    }
  }
}
