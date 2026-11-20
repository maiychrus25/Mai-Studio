import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setImmediate as yieldTurn } from 'node:timers/promises';

const RATE = 16000;
const FRAME = 512;
const HOP = 160;
const MAX_PCM = 3600 * RATE * 4;
const MATCH_OK = 0.6;
const EXTRA_MAX = 0.8;
type Part = { start: number; end: number };
export type SpeechAnalysis = { duration: number; voiced: number; parts: Part[]; f0: number | null };

// Authority: speechcheck.pyc f8a4bf85ab5736c8f114e92398d462955fce909ca29f2898808775a4e6b80b77,
// voiced_frames:164, speech_spans:186, median_f0:279; dubaudio.pyc fa32fd6fad373e66a97dbb74178806d5a4ca30135aad69b7d353e2dd5184c27f find_lines:64.
// This is acoustic periodicity, not ASR, speech semantics, speaker identity or an ASR-assisted line_span trim.
export async function analyzeSpeech(filePath: string, ffmpegPath: string, signal?: AbortSignal): Promise<SpeechAnalysis> {
  signal?.throwIfAborted();
  if (typeof filePath !== 'string' || !filePath.trim() || filePath.includes('\0') || typeof ffmpegPath !== 'string' || !ffmpegPath.trim() || ffmpegPath.includes('\0')) throw new Error('Invalid audio file or FFmpeg binary');
  const path = resolve(filePath); const info = await lstat(path); signal?.throwIfAborted();
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('Audio must be a regular file, not a symlink');
  if (!info.size || info.size > 2 * 1024 ** 3) throw new Error('Audio file size limit: 1 byte–2 GiB');
  const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120000)]);
  const raw = await new Promise<Buffer>((done, reject) => {
    execFile(ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', '-threads', '1', '-protocol_whitelist', 'file,pipe', '-i', path,
      '-map', '0:a:0', '-vn', '-t', '3600.001', '-ac', '1', '-ar', String(RATE), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'],
    { encoding: 'buffer', shell: false, windowsHide: true, signal: bounded, killSignal: 'SIGKILL', maxBuffer: MAX_PCM + 1024 }, (error, stdout) => {
      if (bounded.aborted) reject(bounded.reason);
      else if (error) reject(new Error('FFmpeg audio decode failed: invalid media, missing binary or decoded buffer limit', { cause: error }));
      else done(stdout);
    });
  });
  bounded.throwIfAborted();
  if (!raw.length || raw.length % 4 || raw.length > MAX_PCM) throw new Error('Invalid decoded audio size; limit is one hour of mono Float32 PCM');
  const samples = new Float32Array(raw.length / 4);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = raw.readFloatLE(index * 4);
    if (!Number.isFinite(samples[index])) throw new Error('Invalid nonfinite decoded audio sample');
    if (index % 262144 === 0) await yieldTurn(undefined, { signal: bounded });
  }
  const duration = rounded(samples.length / RATE, 3);
  const count = samples.length < FRAME ? 0 : 1 + Math.floor((samples.length - FRAME) / HOP);
  if (!count) return { duration, voiced: 0, parts: [], f0: null };
  const db = new Float64Array(count); const pitches = new Float64Array(count);
  const centered = new Float32Array(FRAME); const window = Float32Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FRAME - 1)));
  function frame(index: number): number {
    const start = index * HOP; let mean = 0; let power = 0;
    for (let i = 0; i < FRAME; i++) mean += samples[start + i];
    mean = Math.fround(mean / FRAME);
    for (let i = 0; i < FRAME; i++) { centered[i] = samples[start + i] - mean; power += centered[i] ** 2; }
    return 10 * Math.log10(power / FRAME + 1e-10);
  }
  for (let index = 0; index < count; index++) {
    db[index] = frame(index);
    if (index % 256 === 0) await yieldTurn(undefined, { signal: bounded });
  }
  const floor = percentile([...db], 0.2); const real = new Float64Array(1024); const imaginary = new Float64Array(1024);
  for (let index = 0; index < count; index++) {
    if (index % 64 === 0) await yieldTurn(undefined, { signal: bounded });
    if (db[index] <= Math.max(floor + 9, -50)) continue;
    frame(index); real.fill(0); imaginary.fill(0);
    for (let i = 0; i < FRAME; i++) real[i] = Math.fround(centered[i] * window[i]);
    fft(real, imaginary, false);
    for (let i = 0; i < 1024; i++) { real[i] = real[i] ** 2 + imaginary[i] ** 2; imaginary[i] = 0; }
    fft(real, imaginary, true);
    let lag = Math.floor(RATE / 450);
    for (let candidate = lag + 1; candidate < Math.floor(RATE / 70); candidate++) if (real[candidate] > real[lag]) lag = candidate;
    if (real[lag] / (real[0] + 1e-12) > 0.42) pitches[index] = RATE / lag;
  }
  const voicedDb = [...db].filter((_, index) => pitches[index] > 0);
  if (!voicedDb.length) return { duration, voiced: 0, parts: [], f0: null };
  const top = percentile(voicedDb, 0.95);
  function spans(gap: number): Part[] {
    const output: Part[] = [];
    for (let index = 0; index < count; index++) {
      if (!pitches[index] || db[index] <= top - 24) continue;
      const time = (index * HOP + FRAME / 2) / RATE; const last = output.at(-1);
      if (last && time - last.end <= gap) last.end = time;
      else output.push({ start: time, end: time });
    }
    // Clamp the source's ±30 ms padding at file boundaries so callers never receive negative time.
    return output.filter(part => part.end - part.start >= 0.12).map(part => ({ start: Math.max(0, rounded(part.start - 0.03, 3)), end: Math.min(duration, rounded(part.end + 0.03, 3)) }));
  }
  const speech = spans(0.35); const fine = spans(0.25); const groups: Part[][] = [];
  for (const part of fine) {
    const previous = groups.at(-1);
    if (previous && part.start - previous.at(-1)!.end <= 0.6) previous.push(part);
    else groups.push([part]);
  }
  const parts: Part[] = []; const pending = groups.reverse();
  while (pending.length) {
    const group = pending.pop()!; const start = group[0].start; const end = group.at(-1)!.end;
    if (end - start <= 9 || group.length < 2) { if (end - start >= 0.35) parts.push({ start, end }); continue; }
    let cut = 1;
    for (let i = 2; i < group.length; i++) if (group[i].start - group[i - 1].end > group[cut].start - group[cut - 1].end) cut = i;
    pending.push(group.slice(cut), group.slice(0, cut));
  }
  const keptPitches = [...pitches].filter((pitch, index) => pitch > 0 && speech.length > 0 && (index * HOP + FRAME / 2) / RATE >= speech[0].start && (index * HOP + FRAME / 2) / RATE <= speech.at(-1)!.end);
  bounded.throwIfAborted();
  return { duration, voiced: rounded(speech.reduce((sum, part) => sum + part.end - part.start, 0), 2), parts, f0: keptPitches.length >= 15 ? rounded(percentile(keptPitches, 0.5), 0) : null };
}

// The source's zero-padded FFT autocorrelation is the inverse power spectrum; no DSP dependency is needed.
function fft(real: Float64Array, imaginary: Float64Array, inverse: boolean): void {
  for (let i = 1, j = 0; i < real.length; i++) {
    let bit = real.length >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]]; }
  }
  for (let length = 2; length <= real.length; length *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / length; const stepR = Math.cos(angle); const stepI = Math.sin(angle);
    for (let start = 0; start < real.length; start += length) {
      let r = 1; let im = 0;
      for (let j = 0; j < length / 2; j++) {
        const a = start + j; const b = a + length / 2;
        const br = real[b] * r - imaginary[b] * im; const bi = real[b] * im + imaginary[b] * r;
        real[b] = real[a] - br; imaginary[b] = imaginary[a] - bi; real[a] += br; imaginary[a] += bi;
        const next = r * stepR - im * stepI; im = r * stepI + im * stepR; r = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < real.length; i++) { real[i] /= real.length; imaginary[i] /= real.length; }
}

function percentile(values: number[], fraction: number): number {
  values.sort((a, b) => a - b); const index = (values.length - 1) * fraction; const low = Math.floor(index);
  return values[low] + (values[Math.ceil(index)] - values[low]) * (index - low);
}

// Same binary-double ties-to-even rule as story.ts, also used for source round(..., 2) and integer F0.
function rounded(value: number, digits: number): number {
  if (!value) return 0;
  const bytes = new DataView(new ArrayBuffer(8)); bytes.setFloat64(0, Math.abs(value)); const bits = bytes.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 2047n); const mantissa = (bits & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n);
  const shift = (exponent || 1) - 1023 - 52; const scale = 10 ** digits; let numerator = mantissa * BigInt(scale); let denominator = 1n;
  if (shift >= 0) numerator <<= BigInt(shift); else denominator <<= BigInt(-shift);
  let whole = numerator / denominator; const remainder = numerator % denominator;
  if (remainder * 2n > denominator || (remainder * 2n === denominator && whole % 2n)) whole++;
  return Math.sign(value) * Number(whole) / scale;
}

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const UNITS: Record<string, string> = { cm: 'xăng-ti-mét', mm: 'mi-li-mét', m: 'mét', km: 'ki-lô-mét', kg: 'ki-lô-gam', g: 'gam', gr: 'gam', mg: 'mi-li-gam', ml: 'mi-li-lít', l: 'lít', 'lít': 'lít', inch: 'inch', w: 'oát', kw: 'ki-lô-oát', v: 'vôn', mah: 'mi-li-am-pe giờ', h: 'giờ', p: 'phút', gb: 'gi-ga-bai', tb: 'tê-ra-bai', mb: 'mê-ga-bai', 'đ': 'đồng', '₫': 'đồng', vnd: 'đồng', 'vnđ': 'đồng', k: 'nghìn', '%': 'phần trăm', x: 'lần' };
const SPACE = '\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028-\\u2029\\u202f\\u205f\\u3000';

function numberWords(raw: string): string {
  const normalized = raw.replace(/^0+/, '') || '0';
  if (normalized.length > 12) return [...normalized].map(d => DIGITS[Number(d)]).join(' ');
  let value = Number(normalized); if (!value) return DIGITS[0];
  const groups: number[] = []; const words: string[] = []; const scales = ['', 'nghìn', 'triệu', 'tỷ'];
  while (value) { groups.push(value % 1000); value = Math.floor(value / 1000); }
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i]; if (!group) continue;
    const hundreds = Math.floor(group / 100); const tens = Math.floor(group / 10) % 10; const units = group % 10;
    const part: string[] = [];
    if (hundreds || i !== groups.length - 1) part.push(DIGITS[hundreds], 'trăm');
    if (!tens) { if (units) { if (part.length) part.push('lẻ'); part.push(DIGITS[units]); } }
    else {
      part.push(...(tens === 1 ? ['mười'] : [DIGITS[tens], 'mươi']));
      if (units) part.push(units === 1 && tens > 1 ? 'mốt' : units === 4 && tens > 1 ? 'tư' : units === 5 ? 'lăm' : DIGITS[units]);
    }
    words.push(...part); if (scales[i]) words.push(scales[i]);
  }
  return words.join(' ');
}

function numberText(raw: string): string {
  raw = raw.replace(/\p{Nd}/gu, char => {
    const point = char.codePointAt(0)!; let first = point;
    while (first && /\p{Nd}/u.test(String.fromCodePoint(first - 1))) first--;
    return String((point - first) % 10);
  });
  if (/^\d{1,3}(?:\.\d{3})+$/.test(raw) || /^\d{1,3}(?:,\d{3})+$/.test(raw)) return numberWords(raw.replace(/[.,]/g, ''));
  const decimal = /^(\d+)[.,](\d+)$/.exec(raw);
  if (decimal) {
    const fraction = decimal[2].replace(/0+$/, '');
    return numberWords(decimal[1]) + (fraction ? ' phẩy ' + (fraction.length <= 2 && !fraction.startsWith('0') ? numberWords(fraction) : [...fraction].map(d => DIGITS[Number(d)]).join(' ')) : '');
  }
  if (!/^\d+$/.test(raw)) throw new Error('Invalid numeric transcript text');
  return raw.length > 1 && raw.startsWith('0') ? [...raw].map(d => DIGITS[Number(d)]).join(' ') : numberWords(raw);
}

// speechcheck._spoken:387 delegates expected numerals to vinum.spell_vi:102 (prices, units, dimensions).
// vinum.pyc SHA-256: ed0b3f89ea4ad940acf60f342c980c2dfe8f5c674c28c51e4dbcd32c583fed3f.
export function spokenVietnamese(value: string): string { return spoken(value); }
function spoken(value: string): string {
  value = value.replace(new RegExp(`(?<=\\p{Nd})[${SPACE}]*[x×][${SPACE}]*(?=\\p{Nd})`, 'gu'), ' nhân ').replace(new RegExp(`(?<=\\p{Nd})[${SPACE}]*[-–][${SPACE}]*(?=\\p{Nd})`, 'gu'), ' đến ');
  return value.replace(new RegExp(`(?<![\\p{L}\\p{N}_.,])(\\p{Nd}{1,3}(?:[.,]\\p{Nd}{3})+|\\p{Nd}+(?:[.,]\\p{Nd}+)?)(?!\\p{Nd})([${SPACE}]?)(%|₫|[a-zA-ZđĐ]{1,4}(?![\\p{L}\\p{N}_]))?`, 'gu'), (_match, raw: string, space: string, unit = '') => {
    const words = numberText(raw); const key = unit.toLowerCase();
    return Object.hasOwn(UNITS, key) && key !== 'x' ? `${words} ${UNITS[key]}` : words + space + unit;
  });
}

function words(value: string): string[] {
  return (value.toLowerCase().normalize('NFC').match(/[\p{L}\p{N}_]+/gu) || [])
    .filter(word => ![...word].every(char => /^\p{Nd}$/u.test(char) || /^[0-9]$/.test(char.normalize('NFKC'))))
    .map(word => word.replace(/đ/g, 'd').normalize('NFD').replace(/\p{Mn}/gu, ''));
}

// speechcheck.line_match:396 uses matching-block token coverage, not edit distance or bag-of-words.
export function compareTranscripts(expected: string, heard: string): { match: number; extra: number; ok: boolean } {
  for (const text of [expected, heard]) if (typeof text !== 'string' || text.includes('\0') || Buffer.byteLength(text) > 32768) throw new Error('Transcript text must be a string within the 32768-byte limit');
  const a = words(spoken(expected)); const b = words(heard);
  if (a.length > 4096 || b.length > 4096) throw new Error('Transcript word limit is 4096');
  if (!a.length) return { match: b.length ? 0 : 1, extra: 0, ok: !b.length };
  const positions = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) { const list = positions.get(b[j]) ?? []; list.push(j); positions.set(b[j], list); }
  const pending = [[0, a.length, 0, b.length]]; let hit = 0;
  while (pending.length) {
    const [alo, ahi, blo, bhi] = pending.pop()!; let bestA = alo; let bestB = blo; let size = 0; let previous = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>();
      for (const j of positions.get(a[i]) ?? []) {
        if (j < blo) continue; if (j >= bhi) break;
        const length = (previous.get(j - 1) ?? 0) + 1; next.set(j, length);
        if (length > size) { bestA = i - length + 1; bestB = j - length + 1; size = length; }
      }
      previous = next;
    }
    if (!size) continue; hit += size;
    if (alo < bestA && blo < bestB) pending.push([alo, bestA, blo, bestB]);
    if (bestA + size < ahi && bestB + size < bhi) pending.push([bestA + size, ahi, bestB + size, bhi]);
  }
  const match = hit / a.length; const extra = Math.max(0, b.length - hit) / a.length;
  return { match, extra, ok: match >= MATCH_OK && extra <= EXTRA_MAX };
}

type SpeakerPoint = { id: string; speaker: string; embedding: number[] };
type SpeakerShot = { status: 'unknown' | 'consistency_pass' | 'consistency_fail'; similarity: number | null; margin: number | null; ownCount: number };

// voicematch.pyc d006f19a7b388829e101f2e607c6c43e9c98ea82cc39fb5a2ba383592467fc4c:
// _centroid:135, voice_report:144. ownCount counts OTHER same-speaker clips; pass means no source drift, not verified identity.
export function compareSpeakers(points: SpeakerPoint[]): { shots: Record<string, SpeakerShot>; closePairs: Array<{ speakers: [string, string]; similarity: number }> } {
  if (!Array.isArray(points) || points.length > 1000) throw new Error('Speaker point limit is 1000');
  const groups = new Map<string, SpeakerPoint[]>(); const ids = new Set<string>();
  for (const point of points) {
    if (!point || typeof point !== 'object') throw new Error('Invalid speaker point');
    for (const id of [point.id, point.speaker]) if (typeof id !== 'string' || !id.trim() || id.includes('\0') || Buffer.byteLength(id) > 256) throw new Error('Speaker and shot ID limit is 256 bytes of nonempty text');
    if (ids.has(point.id)) throw new Error('Duplicate speaker shot ID'); ids.add(point.id);
    if (!Array.isArray(point.embedding) || point.embedding.length !== 256) throw new Error('Speaker embedding dimension must be 256');
    let power = 0;
    for (const value of point.embedding) {
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1) throw new Error('Speaker embedding requires finite components within [-1, 1]');
      power += value * value;
    }
    if (Math.abs(Math.sqrt(power) - 1) > 0.001) throw new Error('Speaker embedding must be normalized');
    const group = groups.get(point.speaker) ?? []; group.push(point); groups.set(point.speaker, group);
  }
  function centroid(rows: SpeakerPoint[]): number[] | null {
    if (!rows.length) return null;
    const center = Array<number>(256).fill(0);
    for (const row of rows) for (let i = 0; i < center.length; i++) center[i] += row.embedding[i];
    for (let i = 0; i < center.length; i++) center[i] /= rows.length;
    const norm = Math.sqrt(center.reduce((sum, value) => sum + value * value, 0));
    return norm > 0 ? center.map(value => value / norm) : null;
  }
  const dot = (a: number[], b: number[]): number => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const centers = new Map([...groups].map(([speaker, rows]) => [speaker, centroid(rows)]));
  const shots = new Map<string, SpeakerShot>();
  for (const point of points) {
    const peers = groups.get(point.speaker)!.filter(other => other !== point); const reference = centroid(peers);
    const similarity = reference ? dot(point.embedding, reference) : null; let nearest: number | null = null;
    for (const [speaker, center] of centers) if (speaker !== point.speaker && center && groups.get(speaker)!.length >= 2) {
      const score = dot(point.embedding, center); if (nearest === null || score > nearest) nearest = score;
    }
    const margin = similarity !== null && nearest !== null ? similarity - nearest : null;
    const drift = (similarity !== null && peers.length >= 2 && similarity < 0.5) || (margin !== null && peers.length >= 1 && margin < -0.02);
    shots.set(point.id, { status: similarity === null ? 'unknown' : drift ? 'consistency_fail' : 'consistency_pass', similarity: similarity === null ? null : rounded(similarity, 3), margin: margin === null ? null : rounded(margin, 3), ownCount: peers.length });
  }
  const names = [...centers.keys()].filter(speaker => centers.get(speaker) && groups.get(speaker)!.length >= 2).sort((a, b) => {
    const x = [...a]; const y = [...b];
    for (let i = 0; i < Math.min(x.length, y.length); i++) { const order = x[i].codePointAt(0)! - y[i].codePointAt(0)!; if (order) return order; }
    return x.length - y.length;
  });
  const closePairs: Array<{ speakers: [string, string]; similarity: number }> = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const similarity = rounded(dot(centers.get(names[i])!, centers.get(names[j])!), 3);
    if (similarity >= 0.82) closePairs.push({ speakers: [names[i], names[j]], similarity });
  }
  return { shots: Object.fromEntries(shots), closePairs };
}
