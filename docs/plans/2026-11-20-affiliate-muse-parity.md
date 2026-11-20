# Affiliate Muse Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MaiStudio's Video Aff workflow produce Muse-shaped scripts, Muse-worded image/clip prompts and speech-driven clip timing for nine content styles, without changing saved projects or the `asmr`/`pov` styles.

**Architecture:** A new pure module composes image/clip prompts from Muse's observed templates. The planner asks for Muse-shaped short fields, mapped onto existing shot fields. Everything new is gated by `project.data.affiliatePlanVersion === 2`; without the marker every code path behaves exactly as today.

**Tech Stack:** TypeScript (CommonJS output via `tsc -p tsconfig.core.json`), `node:test` + `node:assert/strict`, FFmpeg through the existing `media.ts`, React UI built with Vite.

**Spec:** `docs/specs/2026-11-20-affiliate-muse-parity.md` (Vietnamese; Appendix A holds the verbatim Muse templates, Appendix B a real Muse script). Read it before any task.

## Global Constraints

- Work only in this worktree (`feat/affiliate-muse-parity`) or the worktree named in your task. Never push, release, deploy, run paid provider jobs, or touch the main checkout at `/Users/maiychrus/Documents/mai-studio`.
- English code identifiers. Vietnamese only in user-facing copy and Vietnamese project docs.
- No new dependencies. SQLite stays `node:sqlite`.
- A project without `affiliatePlanVersion: 2` must yield byte-identical pipeline step prompts, clip windows, captions and review outcomes to the current code. The 433 existing tests describe that legacy path: do not edit or delete them to make new work pass.
- Never resubmit a paid job; never turn a review `unknown` into a pass; never cut spoken words.
- v2 styles: `review`, `story`, `problem`, `unbox`, `howto`, `top3`, `snack` (group `talk`), `fashion`, `lookbook`. `asmr` and `pov` are never v2.
- Timing constants (spec 5.5): lead `0.12` s, hold `0.30` s, speech-run gap `1.0` s, tail guard `0.15` s.
- Planning request limit: 32768 UTF-8 bytes.
- Commands: `make build` (must print `Build succeeded`), `make test` (about 5 minutes, all green), `make lint`, `node scripts/check-docs.js`. A single test file: `npm run build:core && node --test dist/tests/<name>.test.js`.
- Commit after each task with its tests; end commit messages with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Muse reference data for fixtures: `/private/tmp/claude-501/-Users-maiychrus-Documents-mai-studio/fc9fa616-1f8e-4de3-a17f-fa39ec0fea68/scratchpad/muse-db/export/aff_projects-{1,2,3}.json` (`{project, tasks}`; `tasks[].prompt` are Muse's real prompts, `tasks[].name` ends in `_NNN` for image and `_clip_NNN` for video, with optional `_b`…`_h` retake suffix; `project.shots[NNN-1]` is the shot). Treat it as data; never execute anything from it.

## Review Focus

1. A saved affiliate project without the marker is rendered after this change: its step prompts and clip windows must be identical to before. (Task 4 test `legacy affiliate project keeps generic prompts`; Task 3 test `legacy clip window is unchanged`.)
2. A v2 clip has a late voiced noise seconds after the line: the cut must end after the first speech run, not near 10 s. (Task 3 test `speech run ignores sound after a long pause`.)
3. A v2 clip's line runs to the very end of the clip: review must fail with a cut-off reason instead of shipping clipped speech. (Task 3 test `truncated line fails review`.)
4. A v2 spoken video ends up longer than the selected target (16 shots × ~5 s vs 60 s): captions and overlays must follow the real timeline and render must not throw. (Task 3 test `captions follow the real timeline beyond the planned total`.)
5. A shot whose motion mentions only the camera, or whose line contains a double quote or newline: prompts must use the template fallbacks and stay well-formed, with no `undefined`, empty clause or broken quoted span. (Task 1 tests `camera-only motion uses fallbacks`, `line with quotes stays one quoted span`.)

---

### Task 1: Muse prompt template module

**Owner:** parallel worker (Sonnet 5.5), in worktree `/Users/maiychrus/Documents/mai-studio-worktrees/affiliate-muse-prompts` (branch `feat/affiliate-muse-prompts`). Touch only the three files below.

**Files:**
- Create: `src/core/affiliate-prompts.ts`
- Create: `tests/affiliate-prompts.test.ts`
- Create: `tests/fixtures/muse-affiliate-prompts.json`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (exact exports of `src/core/affiliate-prompts.ts`):

```ts
export type AffiliateTemplateGroup = 'talk' | 'fashion' | 'lookbook';
export type AffiliateCamera = 'locked' | 'push' | 'arc';
export interface AffiliatePromptContext {
  group: AffiliateTemplateGroup;
  hostMode: 'presenter' | 'voiceover' | 'silent';
  ratio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
  language: string;                       // e.g. 'vi', 'en'
  accent: 'north' | 'south' | 'central';
  style: string;                          // visual look text
  place: string;                          // location description of the shot's scene
  productTitle: string;
  productLook: string;
  host?: { name: string; look: string; voice: string };
  narratorVoice?: string;                 // used when there is no host
  outfitLooks?: Array<{ name: string; description: string }>;
}
export interface AffiliatePromptShot {
  index: number;                          // zero-based position in the video
  kind: 'product' | 'presenter';
  beat: string;                           // lookbook: intro|hanger|wear|detail|final
  scene: string;
  motion: string;                         // may be ''
  line: string;                           // spoken line or ''
  emotion: string;                        // or ''
  productVisible: boolean;
  camera: AffiliateCamera;
  outfitIndex?: number;
  hasProductPhotos: boolean;              // product/outfit photos are attached to the image step
}
export function cleanMotion(motion: string): string;
export function affiliateCamera(group: AffiliateTemplateGroup, shot: Pick<AffiliatePromptShot, 'index' | 'kind' | 'beat' | 'line'>): AffiliateCamera;
export function affiliateHostRefPrompt(context: AffiliatePromptContext): string;
export function affiliateImagePrompt(context: AffiliatePromptContext, shot: AffiliatePromptShot): string;
export function affiliateClipPrompt(context: AffiliatePromptContext, shot: AffiliatePromptShot): string;
```

Decisions the tests do not determine:
- Template wording is spec Appendix A, verbatim, lines joined with `\n`. Where the appendix and a real Muse prompt in the reference data disagree, the real prompt wins; note the difference in your report.
- `cleanMotion` (inferred from Muse data, matches 60 of 63 observed shots): trim; drop one trailing `.`; replace ` while ` and ` as ` with `, `; split on `, `; drop every clause matching `/\bcamera\b/i`; then drop a leading clause whose first word ends in `ing`; join with `, ` and append `.`; no clauses left → `''`.
- Empty cleaned motion: image prompt omits the `Action to prepare in this FIRST FRAME` line; talk presenter clip uses `preserve the scene's meaningful posture and expression.`; talk product clip uses `preserve the scene's meaningful pose and object detail.`; fashion `DANCE` uses `sway and bounce to the beat.`; lookbook omits ` Planned moment: …`.
- `affiliateCamera`: presenter with a line, any fashion presenter shot, lookbook `wear` → `locked`; lookbook `hanger`/`final`/`intro` → `push`; lookbook `detail` → `arc`; every other product shot → `arc` when `index` is even, `push` when odd.
- Extrapolations (spec 5.4 table): ratio words `Vertical 9:16`, `Horizontal 16:9`, `Square 1:1`, `Vertical 3:4`, `Horizontal 4:3`; spoken language named in English from the code (`vi` → `Vietnamese`, `en` → `English`, unknown code → the code itself); the accent phrase (`standard Northern Vietnamese (Hà Nội) accent`, `standard Southern Vietnamese (Sài Gòn) accent`, `standard Central Vietnamese (Huế) accent`) only when `language === 'vi'`, otherwise the `VOICE LOCK` line starts at the voice description; talk `silent` uses the fashion product "Nobody speaks" sound line; no host + line uses `VOICE LOCK — <accent>. Voice: the same off-screen narrator voice (narrator_v1): {narratorVoice}. The same voice in every clip of this video.`; lookbook with `hasProductPhotos` replaces `Show it realistically, with no invented text or logo.` by `it must look EXACTLY like the garment(s) in the attached product photo(s): same cut, length, fit, neckline, colors, fabric texture, pattern and details.`
- Spoken line inside `"{line}"`: collapse whitespace runs (including newlines) to one space and replace `"` with `”`.
- `LOOK n` uses `outfitIndex + 1` and `outfitLooks[outfitIndex]`.
- The opening hook line is added to the image prompt when `index === 0`.

- [ ] **Step 1: Build the fixture file.** Write a throwaway script outside the repo that reads the three reference JSON files and emits `tests/fixtures/muse-affiliate-prompts.json`: an array of `{ name, kind: 'image' | 'clip' | 'hostRef', context, shot?, expected }`, where `expected` is Muse's prompt verbatim and `context`/`shot` are filled from `project.bible`, `project.settings` and the shot (camera read back from the prompt's `Camera:` line; `motion` is the shot's raw motion). Use only first-attempt prompts: skip any prompt containing `IMPORTANT:`, `Keep the movement calm and gentle` or `Perform only a small, calm`. Skip review shot 10 and fashion shot 8 (Muse dropped their motion line for reasons the rule does not explain). Cover at least: host portrait for talk and for fashion; talk presenter+line with product; talk presenter with `product: false`; talk product+line with each camera seen; the talk opening shot; fashion presenter silent and with line; fashion product; lookbook `hanger` (with and without line), `wear`, `detail`, `final`.

- [ ] **Step 2: Write the failing tests** in `tests/affiliate-prompts.test.ts`, loading the module with the `const api = () => require('../src/core/affiliate-prompts')` pattern used in `tests/affiliate-edit.test.ts`:
  - `reproduces Muse prompts line by line`: for every fixture case, the matching function's output `=== expected`.
  - `cleanMotion follows the observed rule`: `"Raises the shoe slightly toward camera, then turns it to show the rounded toe."` → `"then turns it to show the rounded toe."`; `"Taps the thick sole once with his palm while keeping eye contact."` → `"Taps the thick sole once with his palm, keeping eye contact."`; `"Spins lightly with arms open, smiling as the shirt moves freely."` → `"Spins lightly with arms open, smiling, the shirt moves freely."`; `"Presents the shoe steadily to camera and gives a small inviting nod."` → `""`; `"Takes three small steps toward the camera, pointing lightly to his collar."` → `""`.
  - `camera-only motion uses fallbacks`: each of the four fallbacks above, and no output contains `undefined`, a double space or `: .`.
  - `line with quotes stays one quoted span`: line `He said "wow"\nnow` appears as `"He said ”wow” now"`.
  - `extrapolated wording`: ratio words for all five ratios; `en` yields `in English` and no `Vietnamese` or `accent`; `south` yields the Sài Gòn phrase; talk `silent` clip contains `Nobody speaks.` and no `says this exact line`; voiceover without host contains `narrator_v1` and the narrator voice text; lookbook `wear` with `hasProductPhotos: true` contains `must look EXACTLY like the garment(s)`.
  - `affiliateCamera applies the rotation`: the cases listed in the decision above.

- [ ] **Step 3: Run** `npm run build:core && node --test dist/tests/affiliate-prompts.test.js`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement** `src/core/affiliate-prompts.ts` with the exports above.

- [ ] **Step 5: Run** the same command until every test passes, then `make lint`. Expected: PASS, lint clean.

- [ ] **Step 6: Commit** the three files: `feat(affiliate): add Muse prompt templates`.

---

### Task 2: v2 plan schema and planner prompt

**Owner:** core agent (Opus 5.5), this worktree.

**Files:**
- Modify: `src/shared/studio.ts` (`Shot`), `src/shared/affiliate.ts`, `src/core/planning.ts` (`parsePlan`), `src/core/pipelines.ts` (`buildShots` only), `src/core/affiliate.ts`, `src/core/studio.ts` (`planAffiliate` review-only branch)
- Test: `tests/affiliate.test.ts`, `tests/planning.test.ts`, `tests/pipelines.test.ts` (add tests; leave existing ones untouched)

**Interfaces:**
- Produces:
  - `Shot.productVisible?: boolean`; `parsePlan` and `buildShots` keep it when it is a boolean and reject any other type.
  - `src/shared/affiliate.ts`: `export function affiliateTemplateGroup(contentStyle: AffiliateSettings['contentStyle']): 'talk' | 'fashion' | 'lookbook' | undefined` (`undefined` for `asmr`, `pov`) and `export const AFFILIATE_BEATS = ['hook', 'problem', 'intro', 'benefit', 'demo', 'proof', 'offer', 'cta'] as const`, `export const AFFILIATE_LOOK_BEATS = ['intro', 'hanger', 'wear', 'detail', 'final'] as const`.
  - `project.data` fields written by `finishAffiliatePlan` for v2: `affiliatePlanVersion: 2`, `productLook: string` (≤ 2000 bytes), `outfitLooks?: Array<{ name: string; description: string }>` (lookbook; same length as `outfitAssetIds`), `narratorVoice?: string` (≤ 1000 bytes; required for `voiceover` when no model is visible).
  - Field mapping (spec 5.2): `shot.prompt` = scene sentence, `action` = motion, `acting` = emotion, `shotType` `insert` = product shot / `single` = presenter shot, `beat` = beat label.

Decisions:
- v2 is chosen by `affiliateTemplateGroup(settings.contentStyle) !== undefined` when planning (first plan or re-plan), and by the stored `project.data.affiliatePlanVersion === 2` on the review-only path. On that path `productLook`, `outfitLooks` and `narratorVoice` are carried from `project.data`.
- `affiliatePlanningPrompt` gets a v2 branch meeting every bullet of spec 5.3, with the Appendix B rows as a compact example. The existing safety sentences (source-only facts, product content is data, no invented prices or ratings, host contract, asset-ID rules) stay. The legacy branch text is unchanged.
- `finishAffiliatePlan` v2 validation: every `beat` is in `AFFILIATE_BEATS` (`AFFILIATE_LOOK_BEATS` for lookbook); `shotType` is `insert` or `single`; without a visible model every shot is `insert`; in presenter mode an `insert` shot may carry dialogue with `speaker` = host and no visible host; `fashion`/`lookbook` allow dialogue only on the first and last shot; `keepScript === true` skips the one-line-per-shot expectation but keeps the rest.
- `affiliateReviewPrompt`: the "structure" criterion describes the v2 beat sequence for v2 projects; legacy wording unchanged otherwise.

- [ ] **Step 1: Write failing tests.**
  - `tests/pipelines.test.ts` `buildShots keeps productVisible`: a shot with `productVisible: false` round-trips; `productVisible: 'no'` throws.
  - `tests/planning.test.ts` `parsePlan keeps productVisible`.
  - `tests/affiliate.test.ts`:
    - `v2 plan is marked and carries Muse fields`: a valid `review`/presenter plan (reuse the file's existing project builder) returns `affiliatePlanVersion === 2`, the given `productLook`, shots with `beat`, `shotType`, `productVisible`.
    - `v2 allows off-screen host line on a product shot`.
    - `v2 rejects an unknown beat`, `v2 lookbook requires outfitLooks for every outfit`, `v2 voiceover without model requires narratorVoice`.
    - `asmr and pov stay legacy`: no `affiliatePlanVersion` on the result and `affiliatePlanningPrompt` equals the pre-change text (assert it still contains `STYLE RECIPE (asmr)`).
    - `v2 planning prompt states the Muse contract`: contains `one fact`, the beat list, `insert`, `single`, `productVisible`, `productLook`, and is ≤ 32768 bytes for a 60 s project with a 24 KB product description.
    - `edited legacy project is re-checked by legacy rules`: a stored `review` project without the marker passes `finishAffiliatePlan` through the same path as before (no v2 beat validation).
- [ ] **Step 2: Run** `npm run build:core && node --test dist/tests/affiliate.test.js dist/tests/planning.test.js dist/tests/pipelines.test.js`. Expected: the new tests FAIL, existing ones pass.
- [ ] **Step 3: Implement** the changes listed under Produces and Decisions.
- [ ] **Step 4: Run** the same command. Expected: all PASS. Then `make lint`.
- [ ] **Step 5: Commit**: `feat(affiliate): plan Muse-shaped v2 scripts`.

---

### Task 3: speech-driven timing for v2

**Owner:** core agent (Opus 5.5), this worktree, after Task 2.

**Files:**
- Modify: `src/core/affiliate-edit.ts`, `src/core/studio.ts` (`clipWindow`, the render block of `executePipeline`, the speech part of `executeReview`)
- Test: `tests/affiliate-edit.test.ts`, `tests/studio.test.ts` or `tests/review.test.ts` (wherever the existing overflow behaviour is tested)

**Interfaces:**
- Consumes: `project.data.affiliatePlanVersion` from Task 2.
- Produces in `src/core/affiliate-edit.ts`:

```ts
export const AFFILIATE_SPEECH_LEAD = 0.12;
export const AFFILIATE_SPEECH_HOLD = 0.3;
export const AFFILIATE_SPEECH_GAP = 1;
export const AFFILIATE_SPEECH_TAIL_GUARD = 0.15;
export function affiliateSpeechRun(parts: Array<{ start: number; end: number }>): { start: number; end: number } | undefined;
export function affiliateSpeechWindow(clipDuration: number, parts: Array<{ start: number; end: number }>, minimum?: number): { start: number; duration: number; truncated: boolean } | undefined;
```

Decisions:
- `affiliateSpeechRun`: the first part plus each following part whose `start` is at most `AFFILIATE_SPEECH_GAP` after the previous kept part's `end`; `undefined` for no parts.
- `affiliateSpeechWindow`: `start = max(0, run.start - LEAD)`, `end = min(clipDuration, max(run.end + HOLD, start + (minimum ?? 0)))`, `truncated = run.end > clipDuration - TAIL_GUARD`. `minimum` is the planned shot duration for `fashion`/`lookbook` and omitted for the talk group.
- `clipWindow` uses `affiliateSpeechWindow` only for v2 projects; its legacy branches are untouched. v2 never reports `speechOverflow`.
- Render (v2, native audio, not dubbing): clips are placed sequentially from the running position, ignoring `step.start`; silent shots keep their planned duration; a `truncated` window stops the render with a Vietnamese `NeedsInputError` that says the line is cut at the end of the clip and the clip must be regenerated.
- Review (v2): the overflow failure is replaced by a failure with the same cut-off wording when `truncated`; all other review rules stay.
- Captions, subtitle cues and flash points for v2 are computed from the real cut points; `affiliateCaptionCues` bounds cues by the real total. Legacy callers keep passing planned values and get identical output.
- `affiliateDub === true` keeps today's fixed-slot behaviour for v2 as well.
- If new constants need `docs-check` markers, add them in Task 5.

- [ ] **Step 1: Write failing tests.**
  - `speech run ignores sound after a long pause`: parts `[0.6–2.1], [2.3–4.4], [7.9–8.3]` → run `0.6–4.4`; window for a 10 s clip → `start 0.48`, `duration 4.22` (±1e-9), `truncated false`.
  - `speech window never cuts words`: parts ending at `9.95` in a 10 s clip → `truncated true`.
  - `planned minimum extends a short line`: run `0.5–1.4`, `minimum 3` → `duration 3`.
  - `no speech parts` → `undefined`.
  - `legacy clip window is unchanged`: a project without the marker gets the same window and `speechOverflow` as before for an overflowing line.
  - `truncated line fails review` and `v2 overflow no longer fails`: on the seam the existing overflow test uses.
  - `captions follow the real timeline beyond the planned total`: 16 spoken shots of 5 s for a 60 s target produce cues ending at 80 s without throwing.
- [ ] **Step 2: Run** `npm run build:core && node --test dist/tests/affiliate-edit.test.js dist/tests/studio.test.js dist/tests/review.test.js`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `make lint`.
- [ ] **Step 5: Commit**: `feat(affiliate): cut v2 clips by measured speech`.

---

### Task 4: wire templates into the pipeline

**Owner:** core agent (Opus 5.5), this worktree, after Tasks 1–3 (Task 1's commit is merged into this branch first).

**Files:**
- Modify: `src/core/pipelines.ts` (`pipelineSteps`), `src/core/studio.ts` (`executeCharacters`), `src/ui/AffiliateWorkflow.tsx` (one hint under the target-duration field)
- Test: `tests/pipelines.test.ts`, `tests/studio.test.ts` (character reference prompt, if that seam is tested there)

**Interfaces:**
- Consumes: everything Task 1 produces; Task 2's project fields and `affiliateTemplateGroup`.

Decisions:
- `pipelineSteps`, for `affiliatePlanVersion === 2`: build one `AffiliatePromptContext` per project and one `AffiliatePromptShot` per shot (`kind` from `shotType`, `camera` from `affiliateCamera`, `place` from the shot's scene `location`, `host` from `characters[0]`, `productVisible` default `true`), and use `affiliateImagePrompt` / `affiliateClipPrompt` instead of the generic strings. Step ids, `duration`, `dialogue`, `speaker`, `shotType` and the speech-step logic are unchanged.
- Image reference order for v2 (spec 5.4 table): presenter shot with product → first 2 product photos, then the presenter asset; presenter shot with `productVisible: false` → presenter asset only; product shot → first 3 product photos; lookbook → the shot's outfit photo, then the presenter asset; the uploaded background asset last. `hasProductPhotos` is true when at least one product/outfit photo is attached.
- When a background asset is attached, append the existing MaiStudio background sentence (with its reference number) as a final line; when `pose !== 'auto'` and a model is visible, append the existing pose sentence. Nothing else is appended.
- `executeCharacters`, v2 only: the host reference uses `affiliateHostRefPrompt` and attaches no reference images.
- UI hint, both languages, under "Thời lượng mục tiêu": `Video có lời được cắt theo lời nói thật nên có thể dài hoặc ngắn hơn mục tiêu.` / `Spoken videos are cut to the measured speech, so the result can run longer or shorter than the target.` Use the existing hint/field styling; no layout change.

- [ ] **Step 1: Write failing tests** in `tests/pipelines.test.ts`:
  - `v2 project uses Muse templates`: image prompt starts with `Vertical 9:16 frame from a short social-media product video.`; clip prompt starts with `Create ONE continuous 10-second`; no prompt contains `The edit uses`.
  - `v2 reference order follows Muse`: the four rows of the table above, plus background last.
  - `v2 appends background and pose lines only when set`.
  - `legacy affiliate project keeps generic prompts`: for an existing legacy fixture project, `pipelineSteps` output deep-equals a snapshot captured before your change (capture it in the test from the unchanged legacy branch; the assertion is that adding the marker is the only thing that switches paths).
- [ ] **Step 2: Run** `npm run build:core && node --test dist/tests/pipelines.test.js`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, then `make build` and `make lint`. Expected: PASS, `Build succeeded`.
- [ ] **Step 5: Commit**: `feat(affiliate): compose v2 prompts from Muse templates`.

---

### Task 5: documentation and full verification

**Owner:** core agent (Opus 5.5), this worktree.

**Files:**
- Modify: `SYSTEM_DOCUMENTATION.md`, `CHANGELOG.md`, `docs/reports/parity.md`, `docs/specs/2026-11-20-affiliate-muse-parity.md` (status line and, if code differs from the spec, a "Ghi chú sau thực thi" section)

- [ ] **Step 1:** Document v2 behaviour in `SYSTEM_DOCUMENTATION.md` (marker, field mapping, template groups, reference order, timing constants with `docs-check` markers where the file's convention requires them, what stays legacy). Add a `CHANGELOG.md` entry under the unreleased/dev section. In `docs/reports/parity.md` record which wording is verbatim Muse and which is extrapolated (spec 5.4 table), and the unexplained `cleanMotion` cases.
- [ ] **Step 2:** Run `make build`, `make test`, `make lint`, `node scripts/check-docs.js`. Expected: `Build succeeded`; all tests pass with a count ≥ 433 plus the new ones and 0 failures; lint clean; `docs-check: OK`.
- [ ] **Step 3:** Run the two stress rounds the repo requires (`node scripts/stress.mjs`, twice; read the script header for arguments) and record peak concurrency and outcomes. If the script cannot run in this environment, report exactly why instead of claiming it passed.
- [ ] **Step 4:** `git diff main...HEAD --stat` and read the full diff once for stray edits outside the files named in this plan.
- [ ] **Step 5: Commit**: `docs: record affiliate v2 behaviour and verification`.

---

### Task 6: independent review

**Owner:** reviewer (Opus 5.5), read-only.

- [ ] Review `git diff main...feat/affiliate-muse-parity` against the spec, the Global Constraints and each Review Focus line. Report defects with file and line, a concrete failing scenario, and severity. Do not fix anything.
