import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readAffiliateSettings } from '../shared/affiliate';
import type { Project, Shot } from '../shared/studio';
import type { Cue } from './media';

const RATE = 8000, FRAME = 160, MAX_PCM = 90 * RATE * 4;
function cancelled(): Error { const error = new Error('Affiliate beat analysis cancelled'); error.name = 'AbortError'; return error; }

export async function detectAffiliateBeats(path: string, ffmpegPath: string, signal: AbortSignal): Promise<number[]> {
  if (signal.aborted) throw cancelled();
  if (typeof path !== 'string' || !path.trim() || path.includes('\0') || typeof ffmpegPath !== 'string' || !ffmpegPath.trim() || ffmpegPath.includes('\0')) throw new Error('Invalid Affiliate audio file or FFmpeg binary');
  const absolute = resolve(path);
  try {
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink() || !info.size || info.size > 2 * 1024 ** 3) throw new Error();
  } catch { if (signal.aborted) throw cancelled(); throw new Error('Affiliate audio must be a regular file of 1 byte–2 GiB'); }
  if (signal.aborted) throw cancelled();
  const raw = await new Promise<Buffer>((done, reject) => {
    execFile(ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', '-threads', '1', '-protocol_whitelist', 'file,pipe', '-i', absolute,
      '-map', '0:a:0', '-vn', '-t', '90', '-ac', '1', '-ar', String(RATE), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'],
    { encoding: 'buffer', shell: false, windowsHide: true, timeout: 30000, signal, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 ** 2 }, (error, stdout) => {
      if (signal.aborted) reject(cancelled());
      else if (error) reject(new Error('Affiliate beat decode failed: invalid media, missing FFmpeg, timeout or output limit'));
      else done(stdout);
    });
  });
  if (signal.aborted) throw cancelled();
  if (!raw.length || raw.length % 4 || raw.length > MAX_PCM) throw new Error('Invalid Affiliate PCM: limit 90 seconds of mono 8 kHz Float32 audio');
  const energy: number[] = [];
  for (let start = 0; start + FRAME * 4 <= raw.length; start += FRAME * 4) {
    let sum = 0;
    for (let offset = start; offset < start + FRAME * 4; offset += 4) {
      const sample = raw.readFloatLE(offset);
      if (!Number.isFinite(sample)) throw new Error('Invalid Affiliate PCM samples');
      sum += sample * sample;
    }
    energy.push(Math.sqrt(sum / FRAME));
  }
  const peak = Math.max(0, ...energy);
  if (peak < 0.001) return [];
  const deltas = energy.map((value, index) => index ? Math.max(0, value - energy[index - 1]) : 0);
  const threshold = Math.max(0.001, peak * 0.12, Math.max(0, ...deltas) * 0.2);
  const hits: number[] = [];
  for (let index = 1; index < energy.length; index++) {
    if (energy[index] < peak * 0.15 || deltas[index] < threshold || deltas[index] < deltas[index - 1] || deltas[index] < (deltas[index + 1] ?? 0)) continue;
    if (hits.length && (index - hits[hits.length - 1]) * FRAME / RATE < 0.22) {
      if (deltas[index] > deltas[hits[hits.length - 1]]) hits[hits.length - 1] = index;
    } else hits.push(index);
  }
  return hits.slice(0, 256).map(index => index * FRAME / RATE);
}

function timeline(shots: Shot[], totalSeconds: number): number[] {
  if (!Array.isArray(shots) || !shots.length || shots.length > 16 || !Number.isFinite(totalSeconds) || totalSeconds <= 0 || totalSeconds > 60) throw new Error('Invalid Affiliate timeline: 1–16 shots, at most 60 seconds');
  let end = 0; const boundaries = [0], ids = new Set<string>();
  for (const shot of shots) {
    if (!shot || typeof shot.id !== 'string' || !shot.id.trim() || shot.id.length > 100 || ids.has(shot.id) || typeof shot.prompt !== 'string'
      || !Number.isFinite(shot.duration) || shot.duration < 0.6 || shot.duration > 60
      || shot.start !== undefined && (!Number.isFinite(shot.start) || shot.start < 0 || Math.abs(shot.start - end) > 0.000001)
      || shot.dialogue !== undefined && typeof shot.dialogue !== 'string') throw new Error('Invalid Affiliate shot: duplicate ID, duration, gap or overlap');
    ids.add(shot.id); end += shot.duration; boundaries.push(end);
  }
  if (Math.abs(end - totalSeconds) > 0.000001) throw new Error('Affiliate shots must match the planned total');
  boundaries[boundaries.length - 1] = totalSeconds;
  return boundaries;
}

export function alignAffiliateShots(shots: Shot[], beats: number[], totalSeconds: number): Shot[] {
  const original = timeline(shots, totalSeconds);
  if (!Array.isArray(beats) || beats.length > 256 || Array.from(beats).some((beat, index) => !Number.isFinite(beat) || beat < 0 || beat > 90 || index > 0 && beat <= beats[index - 1])) throw new Error('Invalid Affiliate beats: sorted source onsets, limit 256 within 90 seconds');
  const cuts = [...original];
  for (let index = 1; index < shots.length; index++) {
    // Moving either edge of a spoken shot can truncate its already budgeted line.
    if (shots[index - 1].dialogue?.trim() || shots[index].dialogue?.trim()) continue;
    const nearby = beats.filter(beat => Math.abs(beat - original[index]) <= 0.35 && beat - cuts[index - 1] >= 0.6 && original[index + 1] - beat >= 0.6);
    nearby.sort((a, b) => Math.abs(a - original[index]) - Math.abs(b - original[index]));
    if (nearby.length) cuts[index] = nearby[0];
  }
  if (cuts.every((cut, index) => cut === original[index])) return shots.map(shot => ({ ...shot }));
  return shots.map((shot, index) => ({ ...shot, start: cuts[index], duration: cuts[index + 1] - cuts[index] }));
}

export const AFFILIATE_SPEECH_LEAD = 0.12;
export const AFFILIATE_SPEECH_HOLD = 0.3;
export const AFFILIATE_SPEECH_GAP = 1;
export const AFFILIATE_SPEECH_TAIL_GUARD = 0.15;
// The detector measures periodicity, not words: a voiced noise after a long pause is not part of the line.
export function affiliateSpeechRun(parts: Array<{ start: number; end: number }>): { start: number; end: number } | undefined {
  if (!parts.length) return undefined;
  const run = { start: parts[0].start, end: parts[0].end };
  for (const part of parts.slice(1)) { if (part.start - run.end > AFFILIATE_SPEECH_GAP) break; run.end = part.end; }
  return run;
}
export function affiliateSpeechWindow(clipDuration: number, parts: Array<{ start: number; end: number }>, minimum?: number): { start: number; duration: number; truncated: boolean } | undefined {
  const run = affiliateSpeechRun(parts); if (!run) return undefined;
  const start = Math.max(0, run.start - AFFILIATE_SPEECH_LEAD), end = Math.min(clipDuration, Math.max(run.end + AFFILIATE_SPEECH_HOLD, start + (minimum ?? 0)));
  return { start, duration: end - start, truncated: run.end > clipDuration - AFFILIATE_SPEECH_TAIL_GUARD };
}

function clean(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > max) throw new Error(`Invalid Affiliate ${label}: limit ${max} UTF-8 bytes`);
  return value.replace(/\{[^}]*\}/g, '').replace(/<[^>]*>/g, '').replace(/[{}<>]/g, '')
    .replace(/\\[Nnh]/g, ' ').replace(/\\/g, '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function affiliateCaptionCues(project: Project, dialogue: Cue[], measured?: number[]): Cue[] {
  if (project.data.affiliate === undefined) return [];
  const cfg = readAffiliateSettings(project.data.affiliate);
  if (!cfg.screenText) return [];
  const shots = project.data.shots as Shot[];
  if (Array.isArray(shots) && !shots.length) return [];
  if (measured && (!Array.isArray(shots) || !Array.isArray(measured) || measured.length !== shots.length + 1 || measured[0] !== 0 || measured.some((cut, index) => !Number.isFinite(cut) || index > 0 && cut <= measured[index - 1]))) throw new Error('Invalid Affiliate measured cuts: one increasing timeline from 0 per shot');
  const total = measured ? measured[measured.length - 1] : Array.isArray(shots) ? shots.reduce((sum, shot) => sum + shot?.duration, 0) : NaN;
  const cuts = measured ?? timeline(shots, total);
  if (!Array.isArray(dialogue) || dialogue.length > 1000) throw new Error('Invalid Affiliate dialogue cues');
  let lastEnd = 0, lastIndex = 0;
  const spoken = Array.from(dialogue, cue => {
    if (!cue || !Number.isSafeInteger(cue.index) || cue.index <= lastIndex || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < lastEnd || cue.end - cue.start < 0.001 || cue.end > total + 0.000001) throw new Error('Invalid Affiliate dialogue cue timing');
    lastEnd = cue.end; lastIndex = cue.index;
    return { ...cue, text: clean(cue.text, 32768, 'dialogue') };
  });
  if (['asmr', 'pov'].includes(cfg.contentStyle)) {
    const caption = clean(cfg.caption || project.data.affiliateCaption, 512, 'caption');
    return caption && !spoken.some(cue => cue.text === caption) ? [{ index: 1, start: 0, end: total, text: caption }] : [];
  }
  const cues: Cue[] = [];
  for (let index = 0; index < shots.length; index++) {
    const caption = clean(cfg.caption || shots[index].caption || '', 512, 'caption');
    if (!caption || spoken.some(cue => cue.text === caption && cue.start < cuts[index + 1] && cue.end > cuts[index])) continue;
    const previous = cues[cues.length - 1];
    if (previous?.text === caption && previous.end === cuts[index]) previous.end = cuts[index + 1];
    else cues.push({ index: cues.length + 1, start: cuts[index], end: cuts[index + 1], text: caption });
  }
  return cues;
}

export function affiliatePostText(project: Project): string {
  if (project.data.affiliate === undefined) return '';
  const cfg = readAffiliateSettings(project.data.affiliate), data = project.data;
  const product = data.product as Record<string, unknown> | undefined, source = data.productSource as Record<string, unknown> | undefined;
  const post = data.affiliatePost as { caption?: unknown; hashtags?: unknown } | undefined;
  const caption = clean(post?.caption || data.summary || product?.name || '', 4000, 'post caption');
  const tags = post?.hashtags ?? [];
  if (!Array.isArray(tags) || tags.length > 20 || tags.some(tag => typeof tag !== 'string' || Buffer.byteLength(tag) > 100 || !/^#[\p{L}\p{M}\p{N}_]+$/u.test(tag))) throw new Error('Invalid Affiliate post hashtags');
  const url = cfg.affiliateUrl || readAffiliateSettings({ affiliateUrl: product?.url ?? source?.url ?? '' }).affiliateUrl;
  const parts = [caption, [...new Set(tags)].join(' '), clean(cfg.cta, 512, 'CTA'), url];
  if (cfg.showPrice && typeof product?.price === 'string' && product.price.trim() && source?.capturedAt !== undefined) {
    if (typeof source.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(source.capturedAt) || !Number.isFinite(Date.parse(source.capturedAt))) throw new Error('Invalid Affiliate source price date');
    parts.push(`${data.language === 'en' ? 'Shop price captured' : 'Giá tham khảo từ shop'} (${source.capturedAt.slice(0, 10)}): ${clean(product.price, 256, 'source price')}`);
  }
  if (cfg.aiLabel) parts.push(data.language === 'en' ? 'This content includes AI-generated visuals.' : 'Nội dung có sử dụng AI.');
  if (cfg.adLabel) parts.push(data.language === 'en' ? 'Advertisement / Affiliate marketing.' : 'Quảng cáo / Tiếp thị liên kết.');
  return parts.filter(Boolean).join('\n\n');
}
