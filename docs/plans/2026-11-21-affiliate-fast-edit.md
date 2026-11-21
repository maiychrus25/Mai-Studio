# Affiliate Fast Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render spoken (talk-group) Video Aff v2 projects with Muse's fast edit: jump-cut silences, alternate close/normal framing, speed 1.1× with pitch kept, and 2–6-word phrase captions.

**Architecture:** A pure module turns each shot's clip window and measured speech parts into an ordered list of trimmed segments plus shot cut points and phrase cues. `media.merge` gains per-input `speed`, `punch` and `pop`. The v2 render path in `executePipeline` feeds those segments to `merge` when fast edit applies; everything else is unchanged.

**Tech Stack:** TypeScript compiled by `tsc -p tsconfig.core.json`, `node:test` + `node:assert/strict`, FFmpeg via `src/core/media.ts`, React UI built by Vite.

**Spec:** `docs/specs/2026-11-21-affiliate-fast-edit.md` (Vietnamese; section 3 has Muse's exact constants and word lists, 5.x the decisions). Read it before your task.

## Global Constraints

- Work only in the worktree named in your task. Never push, release, deploy, call providers or run paid jobs. Never touch `/Users/maiychrus/Documents/mai-studio`.
- English identifiers; Vietnamese only in user-facing strings.
- No new dependencies.
- A project outside spec 5.1 (legacy, `pace: 'plain'`, fashion/lookbook/asmr/pov, dubbing, slideshow) must produce exactly the same `merge` inputs, options and FFmpeg arguments as today. Do not edit or delete existing tests.
- Constants: `JUMP_GAP 0.3`, `JUMP_KEEP 0.08`, `PUNCH_EVERY 1.7`, no further split when remainder ≤ `1.7 × 1.5`, `MIN_PIECE 0.12` (output seconds), `POP_SEC 0.4`, pop zoom `1.15 → 1.0`, `PUNCH_ZOOM 1.1`, vertical anchor `0.4`, speeds `1 | 1.1 | 1.2`, cue overlap end `max(start + 0.2, nextStart − 0.02)`, phrase `2–6` words, `reach 2`.
- Commands from the worktree root: one file `npm run build:core && node --test dist/tests/<name>.test.js`; `make lint`; full suite only in Task 3 as `caffeinate -i -s make test` (the Mac sleeps after 1 idle minute and breaks browser tests otherwise).
- Commit per task; end messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A project outside 5.1 is rendered: inputs and FFmpeg arguments unchanged. (Task 2 `inputs without speed, punch or pop build the same filters`; Task 3 `plain pace and legacy projects render as before`.)
2. One long continuous speech part (~8 s, no gaps): pieces split every 1.7 s with alternating punch, no piece under 0.12 s, last remainder kept whole when ≤ 2.55 s. (Task 1 `long speech is split every 1.7 seconds`.)
3. A line with numbers and "x", e.g. `Kích thước 24 x 10 x 18 cm rất gọn`: no phrase ends on a number, a weak word or before `x`/`×` when another cut exists. (Task 1 `phrase cuts avoid numbers, x and weak words`.)
4. Many shots giving more than 100 segments go through the hierarchical merge path: speed and punch still apply. (Task 2 `speed and punch apply in hierarchical batches`.)
5. Speech parts outside the shot window (late noise) or touching its edges: excluded from segments and cues; no negative or zero-length trim. (Task 1 `parts outside the window are ignored`.)

---

### Task 1: pure fast-edit module

**Owner:** parallel worker (Sonnet 5.5) in worktree `/Users/maiychrus/Documents/mai-studio-worktrees/affiliate-fast-edit-core` (branch `feat/affiliate-fast-edit-core`). Touch only the two files below.

**Files:**
- Create: `src/core/affiliate-fast-edit.ts`
- Create: `tests/affiliate-fast-edit.test.ts`

**Interfaces — Produces (exact):**

```ts
import type { Cue } from './media';
export const FAST_JUMP_GAP = 0.3, FAST_JUMP_KEEP = 0.08, FAST_PUNCH_EVERY = 1.7, FAST_MIN_PIECE = 0.12;
export interface FastEditShot {
  clipDuration: number;                                  // seconds of the source clip
  window: { start: number; duration: number };          // existing clipWindow result, source seconds
  parts: Array<{ start: number; end: number }>;         // analyzeSpeech parts, source seconds
  dialogue?: string;                                     // written line (digits kept); absent or blank = silent shot
}
export interface FastEditSegment { shot: number; trimStart: number; trimEnd: number; duration: number; punch: boolean; pop: boolean }
export interface FastEditResult { segments: FastEditSegment[]; cuts: number[]; cues: Cue[] }
export function affiliateFastEdit(shots: FastEditShot[], speed: number): FastEditResult;
export function phraseCues(text: string, parts: Array<{ start: number; end: number }>, maxWords?: number): Array<{ start: number; end: number; text: string }>;
```

- `duration = (trimEnd − trimStart) / speed`. `cuts` has `shots.length + 1` entries: `cuts[0] = 0`, `cuts[i + 1]` = output time where shot `i` ends (same shape as today's `measuredCuts`). `cues` are numbered from 1 on the output timeline. `phraseCues` works on timeline-ready parts and does not renumber.
- Rules: spec 5.3 and 5.4 exactly. Parts are clipped to the shot window; parts entirely outside are ignored. Spoken shot: first piece starts at `window.start`, last ends at `window.start + window.duration`; between consecutive kept parts with gap `> 0.3`, end the piece at `prev.end + 0.08` and start the next at `next.start − 0.08`. Silent shot: one piece = the window. Drop pieces shorter than `0.12` output seconds unless the shot would have none. Punch alternation restarts at `false` for each shot; every cut and every 1.7-second split flips it. `pop` is `true` only on segment 0 of the whole result.
- Cut scoring and word lists: spec section 3, verbatim.
- Validation: throw on `speed` outside `[0.5, 2]`, non-finite numbers, or a window outside `[0, clipDuration]`.

- [ ] **Step 1: Write the failing tests** (load with `const api = () => require('../src/core/affiliate-fast-edit')` as in `tests/affiliate-edit.test.ts`; compare floats to 1e-9):
  - `jump cut keeps 0.08 seconds around a silence over 0.3`: window `{start: 0.38, duration: 4.42}`, parts `[0.5–1.6], [2.4–4.5]`, speed 1 → pieces `0.38–1.68` and `2.32–4.80`, punch `false` then `true`.
  - `gaps up to 0.3 seconds are not cut`: parts `[0.5–1.6], [1.9–3.0]` → one piece.
  - `long speech is split every 1.7 seconds`: window `{0.4, 8.2}`, one part `[0.5–8.3]`, speed 1 → piece boundaries exactly `0.4, 2.1, 3.8, 5.5, 7.2, 8.6` (at 5.5 the remainder 3.1 > 2.55 so it splits once more; at 7.2 the remainder 1.4 ≤ 2.55 so it stops), punch `false, true, false, true, false`; with speed 1.1 the split points are every `1.7 × 1.1` source seconds.
  - `tiny pieces are dropped`: a 0.1-second part between two long silences produces no piece of its own.
  - `silent shot is one piece and speed applies`: dialogue absent, window `{0, 3}`, speed 1.1 → one segment, duration `3 / 1.1`.
  - `pop only on the first segment and cuts follow the output timeline`: two shots → `cuts.length === 3`, `cuts[2]` equals the summed durations.
  - `parts outside the window are ignored`: a part at `[7.9–8.3]` with window ending at 4.8 adds no piece and no cue.
  - `phrase cues hold 2 to 6 words and follow speech parts`: `Đế nâng 3cm, tôn dáng ngay khi xỏ vào!` over parts `[0–1.0], [1.2–2.4]` → every cue has 2–6 words, cue times inside the parts, all words in order exactly once.
  - `phrase cuts avoid numbers, x and weak words`: `Kích thước 24 x 10 x 18 cm rất gọn` over one part → no cue text ends with a number, `x`, `×` or a weak word; the punctuation preference: `Mềm, thoáng, co giãn bốn chiều thoải mái cả ngày` cuts after a comma.
  - `overlapping cues end before the next starts`: assert the `max(start + 0.2, next − 0.02)` rule.
  - `invalid input throws`: speed 3, NaN part, window beyond the clip.
- [ ] **Step 2: Run** `npm run build:core && node --test dist/tests/affiliate-fast-edit.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the module.
- [ ] **Step 4: Run** the same command and `make lint`. Expected: all pass, lint clean.
- [ ] **Step 5: Commit** both files: `feat(affiliate): plan fast-edit segments and phrase cues`.

---

### Task 2: media speed, punch and pop

**Owner:** parallel worker (Sonnet 5.5) in worktree `/Users/maiychrus/Documents/mai-studio-worktrees/affiliate-fast-edit-media` (branch `feat/affiliate-fast-edit-media`). Touch only the files below.

**Files:**
- Modify: `src/shared/studio.ts` (`MediaInput`, line 53), `src/core/media.ts` (`sequence`, around lines 291–380)
- Test: `tests/media.test.ts` (add tests only)

**Interfaces — Produces:** `MediaInput` gains `speed?: number; punch?: boolean; pop?: boolean`.

Decisions:
- Valid only for video inputs (`merge`); `slideshow` (still images) throws if any is set. `speed` must be finite in `[0.5, 2]`; `punch`/`pop` must be booleans.
- With `speed`: source span is `[trimStart, trimEnd]` (both required when `speed` is set), output length is `duration`, which must match `(trimEnd − trimStart) / speed` within one output frame, else throw. Video: after the source trim, `setpts=(PTS-STARTPTS)/speed`; audio: after its trim, `atempo=speed`. Then the existing scale, pad and frame-exact trim to the output length.
- `punch`: after scaling to the output frame, `crop=iw/1.1:ih/1.1:(iw-iw/1.1)/2:(ih-ih/1.1)*0.4,scale=W:H` (W×H = output size) so the frame size is unchanged.
- `pop`: zoom from 1.15 to 1.0 linearly over the first 0.4 s of the segment, same anchor (centre horizontally, 0.4 vertically), constant 1.0 afterwards, output size unchanged. Your choice of filter (`zoompan` with `d=1` or `crop` with time expressions plus `scale`).
- Inputs without the three fields must produce byte-identical filter strings to today.

- [ ] **Step 1: Write failing tests** in `tests/media.test.ts`, reusing its synthetic-clip helpers:
  - `inputs without speed, punch or pop build the same filters`: capture the FFmpeg arguments for a 2-input merge before and after (use the file's existing argument-capture seam if there is one; otherwise compare output durations, stream counts and first-frame checksums for the same inputs).
  - `speed 1.1 shortens the segment and keeps audio`: a 2.2-second source with tone, `trimStart 0, trimEnd 2.2, duration 2.0, speed 1.1` → output 2.0 s ± 1 frame, has audio.
  - `punch keeps the frame size and crops the centre`: a source with a distinct border colour → output same width/height, border pixels gone in the punched segment.
  - `pop renders and returns to full frame after 0.4 seconds`.
  - `speed and punch apply in hierarchical batches`: 101 short inputs (0.2 s each) with `speed 1.1` and alternating `punch` → total duration matches the sum within a frame per input.
  - `invalid speed, missing trims or mismatched duration throw`, `slideshow rejects speed, punch and pop`.
- [ ] **Step 2: Run** `npm run build:core && node --test dist/tests/media.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command and `make lint`. Expected: pass.
- [ ] **Step 5: Commit**: `feat(media): per-input speed, punch and pop`.

---

### Task 3: settings, UI and render wiring, docs, verification

**Owner:** Opus 5.5 in this worktree (`feat/affiliate-fast-edit`), after Tasks 1 and 2 are merged into it.

**Files:**
- Modify: `src/shared/affiliate.ts` (`AffiliateSettings`, `readAffiliateSettings`), `src/ui/AffiliateWorkflow.tsx`, `src/core/studio.ts` (v2 render block of `executePipeline`, around lines 699–860)
- Test: `tests/affiliate.test.ts`, `tests/studio.test.ts` (add only)
- Docs: `SYSTEM_DOCUMENTATION.md`, `CHANGELOG.md`, `docs/reports/parity.md`, the spec's status line and a "Ghi chú sau thực thi" section if code differs.

**Interfaces — Consumes:** Task 1's `affiliateFastEdit`, `FastEditShot`; Task 2's `MediaInput.speed/punch/pop`.

Decisions:
- `pace: 'fast' | 'plain'` default `'fast'`, `speechSpeed: 1 | 1.1 | 1.2` default `1.1`, validated like the other enum fields; copy for the two UI selects is spec 5.2 verbatim, shown only when `affiliateTemplateGroup(contentStyle) === 'talk'` and dubbing is off.
- Fast edit applies exactly when spec 5.1 holds. Then: for each video step, keep today's probe, `analyzeSpeech` and `clipWindow` (including the truncation stop); collect a `FastEditShot` per shot instead of pushing the clip; after the loop call `affiliateFastEdit(shots, settings.speechSpeed)` and push one `merge` input per segment `{ path, trimStart, trimEnd, duration, speed, punch, pop }` with absolute `start` = running output time; use `result.cuts` as `measuredCuts` and `result.cues` in place of the per-line native cues. Captions, flashes, end card, music and export keep their code and read the new timeline.
- The render fingerprint/signature of a fast-edit render must include `pace` and `speechSpeed` so changing them re-renders and does not reuse a stale output.

- [ ] **Step 1: Write failing tests:**
  - `affiliate settings default to fast pace at 1.1 and reject invalid values` (`tests/affiliate.test.ts`).
  - `fast edit render cuts silences, punches and speeds up spoken shots` (`tests/studio.test.ts`, real FFmpeg on synthetic speech-like clips the file already builds): more `merge` inputs than shots, inputs carry `speed 1.1` and alternating `punch`, first has `pop`, total output shorter than the `plain` render of the same project, subtitle cues have 2–6 words.
  - `plain pace and legacy projects render as before`: same project with `pace: 'plain'`, a legacy project, a fashion v2 project and a dubbing project produce the same `merge` inputs as on `main` (capture the inputs passed to `media().merge`).
  - `changing pace or speech speed invalidates the rendered output`.
- [ ] **Step 2: Run** the targeted files. Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** targeted files, then `make build`, `caffeinate -i -s make test`, `make lint`, `node scripts/check-docs.js`. Expected: `Build succeeded`; all tests pass (count = today's 481 plus the new ones); lint clean; `docs-check: OK`.
- [ ] **Step 5:** Two stress rounds: `env -u ELECTRON_RUN_AS_NODE caffeinate -i -s node scripts/stress.mjs 1` and `… 2`. Report the table; if it cannot run, say exactly why.
- [ ] **Step 6:** Update docs, then commit: `feat(affiliate): fast-edit render for spoken v2 videos`.

---

### Task 4: independent review

**Owner:** Opus 5.5 reviewer, read-only. Review `git diff main...feat/affiliate-fast-edit` against the spec, Global Constraints and each Review Focus line; report defects with file:line, a concrete failing scenario and severity.
