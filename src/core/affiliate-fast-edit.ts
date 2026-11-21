import type { Cue } from './media';

export const FAST_JUMP_GAP = 0.3, FAST_JUMP_KEEP = 0.08, FAST_PUNCH_EVERY = 1.7, FAST_MIN_PIECE = 0.12;
const NO_SPLIT_FACTOR = 1.5, MIN_WORDS = 2, MAX_WORDS = 6, REACH = 2, MIN_CUE = 0.2, CUE_GAP = 0.02, EPS = 1e-9;
const WEAK_END = new Set('hay được để từ với × - của những là x rất có thì cho mà các một đến và không hoặc – khi'.split(' '));
const VI_HEAD = new Set('gọn di bảo kích chất thiết sản giá thương cao chuyển hằng mỗi trẻ người công đặc nổi tiện thoải sang mềm sạch nhẹ bền chắc tinh tự hiện hoàn phù dễ thông khuyến chính đầy giao thanh dung cảm phong màu kiểu tay đeo xách da'.split(' '));

export interface FastEditShot {
  clipDuration: number;
  window: { start: number; duration: number };
  parts: Array<{ start: number; end: number }>;
  dialogue?: string;
}
export interface FastEditSegment { shot: number; trimStart: number; trimEnd: number; duration: number; punch: boolean; pop: boolean }
export interface FastEditResult { segments: FastEditSegment[]; cuts: number[]; cues: Cue[] }
type Span = { start: number; end: number };

function cutScore(before: string, after: string): number {
  if (/[,.;:!?…]$/.test(before)) return 3;
  const word = before.toLowerCase().replace(/["'“”‘’()]/g, '');
  if (WEAK_END.has(word) || /^[\d.,]+$/.test(word) || /^[x×]/i.test(after)) return 0;
  return VI_HEAD.has(word) || after.length === 1 ? 1 : 2;
}

function bestCut(words: string[], from: number, to: number, ideal: number): { at: number; score: number } {
  let best = { at: -1, score: -1 };
  for (let at = from; at <= to; at++) {
    const score = cutScore(words[at - 1], words[at]);
    if (score > best.score || (score === best.score && Math.abs(at - ideal) < Math.abs(best.at - ideal))) best = { at, score };
  }
  return best;
}

// Halve until every chunk fits; a cut outside the reach window is used only when it scores higher than anything inside it.
function splitWords(words: string[], maxWords: number): string[][] {
  if (words.length <= maxWords) return [words];
  const ideal = Math.round(words.length / 2), lo = MIN_WORDS, hi = words.length - MIN_WORDS;
  const near = bestCut(words, Math.max(lo, ideal - REACH), Math.min(hi, ideal + REACH), ideal);
  const far = bestCut(words, lo, hi, ideal);
  const at = far.score > near.score ? far.at : near.at;
  return [...splitWords(words.slice(0, at), maxWords), ...splitWords(words.slice(at), maxWords)];
}

function allocate(count: number, spans: Span[]): number[] {
  const total = spans.reduce((sum, span) => sum + span.end - span.start, 0), extra = count - spans.length;
  const exact = spans.map(span => extra * (span.end - span.start) / total), sizes = exact.map(value => 1 + Math.floor(value));
  let left = count - sizes.reduce((sum, size) => sum + size, 0);
  for (const index of exact.map((_, i) => i).sort((a, b) => (exact[b] % 1) - (exact[a] % 1))) { if (left-- <= 0) break; sizes[index]++; }
  return sizes;
}

export function phraseCues(text: string, parts: Span[], maxWords = MAX_WORDS): Array<{ start: number; end: number; text: string }> {
  const words = text.split(/\s+/).filter(Boolean);
  let spans = parts.filter(part => Number.isFinite(part.start) && Number.isFinite(part.end) && part.end > part.start).sort((a, b) => a.start - b.start);
  if (!words.length || !spans.length) return [];
  if (spans.length > words.length) spans = [...spans].sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, words.length).sort((a, b) => a.start - b.start);
  const sizes = allocate(words.length, spans), cues: Array<{ start: number; end: number; text: string }> = [];
  let offset = 0;
  spans.forEach((span, index) => {
    const chunks = splitWords(words.slice(offset, offset + sizes[index]), maxWords), length = span.end - span.start;
    let done = 0;
    for (const chunk of chunks) {
      cues.push({ start: span.start + length * done / sizes[index], end: span.start + length * (done + chunk.length) / sizes[index], text: chunk.join(' ') });
      done += chunk.length;
    }
    offset += sizes[index];
  });
  return cues.map((cue, index) => {
    const next = cues[index + 1];
    return next && cue.end > next.start ? { ...cue, end: Math.max(cue.start + MIN_CUE, next.start - CUE_GAP) } : cue;
  });
}

function check(shots: FastEditShot[], speed: number): void {
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error('Speed must be between 0.5 and 2');
  shots.forEach((shot, index) => {
    const { clipDuration, window } = shot, values = [clipDuration, window.start, window.duration, ...shot.parts.flatMap(part => [part.start, part.end])];
    if (values.some(value => !Number.isFinite(value))) throw new Error(`Shot ${index + 1} has a non-finite time`);
    if (window.start < 0 || window.duration < 0 || window.start + window.duration > clipDuration + EPS) throw new Error(`Shot ${index + 1} window is outside its clip`);
  });
}

function shotPieces(shot: FastEditShot, speed: number): { pieces: Span[]; spoken: Span[] } {
  const start = shot.window.start, end = start + shot.window.duration;
  const spoken = shot.parts.map(part => ({ start: Math.max(part.start, start), end: Math.min(part.end, end) }))
    .filter(part => part.end > part.start).sort((a, b) => a.start - b.start);
  const pieces: Span[] = [];
  let from = start;
  spoken.forEach((part, index) => {
    if (index && part.start - spoken[index - 1].end > FAST_JUMP_GAP) {
      pieces.push({ start: from, end: spoken[index - 1].end + FAST_JUMP_KEEP });
      from = part.start - FAST_JUMP_KEEP;
    }
  });
  pieces.push({ start: from, end });
  const kept = pieces.filter(piece => (piece.end - piece.start) / speed >= FAST_MIN_PIECE);
  return { pieces: kept.length ? kept : [pieces.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a))], spoken };
}

export function affiliateFastEdit(shots: FastEditShot[], speed: number): FastEditResult {
  check(shots, speed);
  const segments: FastEditSegment[] = [], cuts = [0], cues: Cue[] = [];
  shots.forEach((shot, index) => {
    const { pieces, spoken } = shotPieces(shot, speed), base = cuts[index];
    let punch = false, clock = base;
    const map: Array<{ piece: Span; at: number }> = [];
    for (const piece of pieces) {
      map.push({ piece, at: clock });
      let cursor = piece.start;
      while ((piece.end - cursor) / speed > FAST_PUNCH_EVERY * NO_SPLIT_FACTOR + EPS) {
        const trimEnd = cursor + FAST_PUNCH_EVERY * speed;
        segments.push({ shot: index, trimStart: cursor, trimEnd, duration: FAST_PUNCH_EVERY, punch, pop: !segments.length });
        punch = !punch; cursor = trimEnd;
      }
      const duration = (piece.end - cursor) / speed;
      segments.push({ shot: index, trimStart: cursor, trimEnd: piece.end, duration, punch, pop: !segments.length });
      punch = !punch; clock += (piece.end - piece.start) / speed;
    }
    cuts.push(clock);
    const toOutput = (time: number): number => {
      const hit = map.find(entry => time <= entry.piece.end);
      return !hit ? clock : hit.at + (Math.max(time, hit.piece.start) - hit.piece.start) / speed;
    };
    if (shot.dialogue?.trim()) {
      for (const cue of phraseCues(shot.dialogue, spoken.map(part => ({ start: toOutput(part.start), end: toOutput(part.end) }))))
        cues.push({ index: cues.length + 1, ...cue });
    }
  });
  return { segments, cuts, cues };
}
