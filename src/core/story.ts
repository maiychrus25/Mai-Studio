import type { Cue } from './media';
import { text } from './store';

const SPACE = '\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028-\\u2029\\u202f\\u205f\\u3000';
const trim = (value: string): string => value.replace(new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, 'gu'), '');
const HEADER = new RegExp(`^[${SPACE}]*(?:#+|cảnh[${SPACE}]*\\p{Nd}+|canh[${SPACE}]*\\p{Nd}+|scene[${SPACE}]*\\p{Nd}+|[iIİı]nt\\.|ext\\.|phần[${SPACE}]*\\p{Nd}+[${SPACE}]*[:.\\-–]?[${SPACE}]*$|chương[${SPACE}]*\\p{Nd}+[${SPACE}]*[:.\\-–]?[${SPACE}]*$)`, 'iu');
const STAGE = /\[[^\]\n]{0,120}\]|\((?:[^()\n]{0,80})\)/gu;
const SENTENCE = new RegExp(`(?<=[.!?…])["”’)\\]]*[${SPACE}]+`, 'gu');
const CLAUSE = new RegExp(`(?<=[,;:–—])[${SPACE}]+`, 'gu');
const END = new RegExp(`[.!?…:;。！？"”’)\\]][${SPACE}]*$`, 'u');

// Exact binary-double rounding to milliseconds matches Python round(x, 3), including ties-to-even.
function millis(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid finite narration time');
  if (!value) return 0;
  const bytes = new DataView(new ArrayBuffer(8)); bytes.setFloat64(0, value); const bits = bytes.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 2047n); const mantissa = (bits & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n);
  const shift = (exponent || 1) - 1023 - 52; let numerator = mantissa * 1000n; let denominator = 1n;
  if (shift >= 0) numerator <<= BigInt(shift); else denominator <<= BigInt(-shift);
  let whole = numerator / denominator; const remainder = numerator % denominator;
  if (remainder * 2n > denominator || (remainder * 2n === denominator && whole % 2n)) whole++;
  return Number(whole) / 1000;
}

export function splitStory(value: string): string[] {
  text(value, 'Story script', 1024 * 1024); const out: string[] = [];
  for (const raw of value.replace(/\r/g, '\n').split('\n')) {
    let line = trim(raw); if (!line || HEADER.test(line)) continue;
    line = trim(trim(line.replace(STAGE, ' ').replace(new RegExp(`[${SPACE}]+`, 'gu'), ' ')).replace(/^["“”]+|["“”]+$/gu, ''));
    if ([...line].length < 2) continue;
    for (const item of line.split(SENTENCE)) {
      const sentence = trim(item); const length = [...sentence].length; if (length < 2) continue;
      if (length <= 220) { out.push(sentence); continue; }
      let current = '';
      for (const part of sentence.split(CLAUSE)) {
        if (current && [...current].length + 1 + [...part].length > 220) { out.push(current); current = part; }
        else current = trim(`${current} ${part}`);
        while ([...current].length > 330) {
          const points = [...current]; let cut = points.slice(0, 220).lastIndexOf(' '); if (cut <= 110) cut = 220;
          out.push(trim(points.slice(0, cut).join(''))); current = trim(points.slice(cut).join(''));
        }
      }
      if (current) out.push(current);
    }
  }
  if (!out.length || out.length > 1000) throw new Error('Story requires 1–1000 spoken pieces');
  return out;
}

export function cuesFromDurations(lines: string[], durations: number[]): { cues: Cue[]; offsets: number[]; total: number } {
  if (!lines.length || lines.length !== durations.length || lines.length > 1000) throw new Error('Narration duration count must match 1–1000 lines');
  const cues: Cue[] = []; const offsets: number[] = []; let clock = 0.25;
  for (const [index, line] of lines.entries()) {
    text(line, 'Narration line', 32768); const value = durations[index]; if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 3600) throw new Error('Invalid narration duration');
    const duration = Math.max(0.3, value); offsets.push(millis(clock));
    cues.push({ index: index + 1, start: millis(clock), end: millis(clock + duration), text: [...line].slice(0, 300).join('') });
    clock += duration + (END.test(line) ? 0.35 : 0.15);
    if (clock > 6 * 3600) throw new Error('Narration exceeds six-hour timeline limit');
  }
  return { cues, offsets, total: millis(clock + 0.4) };
}

export function groupNarration(cues: Cue[], target = 5): Array<{ id: number; cueFrom: number; cueTo: number; start: number; end: number; text: string }> {
  if (!Array.isArray(cues) || cues.length > 1000 || !Number.isFinite(target)) throw new Error('Invalid narration cues or target');
  if (!cues.length) return [];
  target = Math.max(2, Math.min(20, target || 5)); const groups: Cue[][] = []; let current: Cue[] = []; let previousEnd = 0;
  for (const [index, cue] of cues.entries()) {
    if (!Number.isInteger(cue.index) || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < previousEnd || cue.end <= cue.start || typeof cue.text !== 'string') throw new Error('Invalid narration cue timeline');
    previousEnd = cue.end; current.push(cue); const duration = cue.end - current[0].start; const next = cues[index + 1];
    const gap = next ? next.start - cue.end : 0; const nextDuration = next ? next.end - current[0].start : 0;
    if (!next || duration >= target * 1.6 || gap >= 1.2 || (duration >= target * 0.75 && END.test(cue.text)) || (duration >= target * 0.6 && Math.abs(duration - target) <= Math.abs(nextDuration - target))) { groups.push(current); current = []; }
  }
  const last = groups.at(-1)!;
  if (groups.length > 1 && last.at(-1)!.end - last[0].start < target * 0.4) { groups[groups.length - 2].push(...last); groups.pop(); }
  const shots = groups.map((group, index) => ({ id: index + 1, cueFrom: group[0].index, cueTo: group.at(-1)!.index, start: millis(index === 0 ? 0 : group[0].start), end: 0, text: group.map(cue => cue.text).join(' / ') }));
  for (const [index, shot] of shots.entries()) shot.end = shots[index + 1]?.start ?? millis(cues.at(-1)!.end + 0.5);
  return shots;
}

export function alignScript(sentences: string[], segs: Array<{ start: number; end: number }>, asrTexts?: string[]): Cue[] {
  if (!Array.isArray(sentences) || sentences.length > 1000 || !Array.isArray(segs) || segs.length > 1000 || (asrTexts !== undefined && (!Array.isArray(asrTexts) || asrTexts.length > 1000))) throw new Error('Invalid source alignment input: limit 1000');
  for (const lines of [sentences, asrTexts ?? []]) {
    let bytes = 0;
    for (const line of lines) {
      if (typeof line !== 'string' || line.includes('\0') || Buffer.byteLength(line) > 32768) throw new Error('Invalid source script text');
      bytes += Buffer.byteLength(line);
    }
    if (bytes > 1024 * 1024) throw new Error('Source script text exceeds byte limit');
  }
  let previous = 0;
  for (const span of segs) {
    if (!span || !Number.isFinite(span.start) || !Number.isFinite(span.end) || span.start < previous || span.end <= span.start || span.end > 6 * 3600) throw new Error('Invalid speech timeline');
    previous = span.end;
  }
  sentences = sentences.filter(sentence => trim(sentence));
  if (!sentences.length || !segs.length) return [];
  // storyvoice normalizes whitespace-delimited tokens; speechcheck's spoken-number normalization differs.
  const tokens = (value: string): string[] => value.split(new RegExp(`[${SPACE}]+`, 'u')).map(word => word.toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  const scriptTokens = sentences.map(tokens); const heardTokens = (asrTexts ?? []).map(tokens);
  if ([scriptTokens, heardTokens].some(lines => lines.reduce((sum, line) => sum + line.length, 0) > 4096)) throw new Error('Source alignment token limit is 4096');
  const weights = scriptTokens.map((line, index) => Math.max(1, line.length || Math.floor([...sentences[index]].length / 4)));
  const total = segs.reduce((sum, span) => sum + (span.end - span.start), 0); const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const clock = (position: number): number => {
    position = Math.max(0, Math.min(total, position));
    for (const span of segs) {
      if (position <= span.end - span.start) return span.start + position;
      position -= span.end - span.start;
    }
    return segs.at(-1)!.end;
  };
  let weightBefore = 0;
  const starts: number[] = []; const ends: number[] = [];
  for (const weight of weights) {
    starts.push(clock(total * weightBefore / weightSum)); ends.push(clock(total * (weightBefore + weight) / weightSum)); weightBefore += weight;
  }
  const script = scriptTokens.flatMap((line, sentence) => line.map(token => ({ token, sentence })));
  const heard = segs.flatMap((span, index) => (heardTokens[index] ?? []).map((token, word, line) => ({ token, at: span.start + (span.end - span.start) * (word + 0.5) / line.length })));
  if (heard.length && script.length) {
    // SequenceMatcher without junk/popular-token suppression, retaining earliest-a/earliest-b ties.
    const positions = new Map<string, number[]>();
    for (const [index, word] of heard.entries()) { const list = positions.get(word.token) ?? []; list.push(index); positions.set(word.token, list); }
    const pending = [[0, script.length, 0, heard.length]]; const blocks: Array<{ a: number; b: number; size: number }> = [];
    while (pending.length) {
      const [alo, ahi, blo, bhi] = pending.pop()!; let bestA = alo; let bestB = blo; let size = 0; let lengths = new Map<number, number>();
      for (let i = alo; i < ahi; i++) {
        const next = new Map<number, number>();
        for (const j of positions.get(script[i].token) ?? []) {
          if (j < blo) continue; if (j >= bhi) break;
          const length = (lengths.get(j - 1) ?? 0) + 1; next.set(j, length);
          if (length > size) { bestA = i - length + 1; bestB = j - length + 1; size = length; }
        }
        lengths = next;
      }
      if (!size) continue;
      blocks.push({ a: bestA, b: bestB, size });
      if (alo < bestA && blo < bestB) pending.push([alo, bestA, blo, bestB]);
      if (bestA + size < ahi && bestB + size < bhi) pending.push([bestA + size, ahi, bestB + size, bhi]);
    }
    const first = new Map<number, number>(); const last = new Map<number, number>();
    for (const block of blocks.sort((a, b) => a.a - b.a || a.b - b.b)) {
      for (let k = 0; k < block.size; k++) {
        const sentence = script[block.a + k].sentence; const at = heard[block.b + k].at;
        if (!first.has(sentence)) first.set(sentence, at);
        last.set(sentence, at);
      }
    }
    const matched = [...first.keys()].sort((a, b) => a - b);
    if (matched.length >= Math.max(1, Math.floor(sentences.length / 4))) {
      for (let n = 0; n < sentences.length; n++) {
        if (first.has(n)) { starts[n] = first.get(n)!; ends[n] = last.get(n)!; continue; }
        const lo = matched.findLast(index => index < n); const hi = matched.find(index => index > n);
        const a = lo === undefined ? segs[0].start : last.get(lo)!; const b = hi === undefined ? segs.at(-1)!.end : first.get(hi)!;
        const left = lo === undefined ? 0 : lo + 1; const right = hi ?? sentences.length;
        const before = weights.slice(left, n).reduce((sum, weight) => sum + weight, 0);
        const span = Math.max(1, weights.slice(left, right).reduce((sum, weight) => sum + weight, 0));
        starts[n] = a + (b - a) * (before / span); ends[n] = a + (b - a) * ((before + weights[n]) / span);
      }
    }
  }
  const edgesA = segs.map(span => span.start); const edgesB = segs.map(span => span.end);
  const snap = (time: number, edges: number[]): number => {
    let best = edges[0];
    for (const edge of edges) if (Math.abs(edge - time) < Math.abs(best - time)) best = edge;
    return Math.abs(best - time) <= 0.5 ? best : time;
  };
  let previousEnd = 0;
  return sentences.map((sentence, index) => {
    const start = Math.max(previousEnd, snap(starts[index], edgesA)); let end = Math.max(start + 0.6, snap(ends[index], edgesB));
    if (index + 1 < sentences.length) end = Math.min(end, Math.max(start + 0.6, snap(starts[index + 1], edgesA)));
    previousEnd = end;
    return { index: index + 1, start: millis(start), end: millis(end), text: [...sentence].slice(0, 300).join('') };
  });
}
