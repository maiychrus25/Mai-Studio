# Affiliate Run-All Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Video Aff "run all" finishes with a rendered video and a list of shots to review, instead of stopping at quality, review-unknown, script-review and legacy speech-overflow points.

**Architecture:** Turn the affiliate stop points listed in spec section 2 into "record attention, continue" inside `src/core/studio.ts`, keep the repair budget and review statuses unchanged, render legacy overflowing projects with the existing v2 speech-driven placement, and report the attention list in the task's success message and `production.attention`.

**Tech Stack:** TypeScript, `node:test`, FFmpeg via `src/core/media.ts`.

**Spec:** `docs/specs/2026-11-21-affiliate-run-all.md` (Vietnamese). Read it first.

## Global Constraints

- Only affiliate projects (`project.kind === 'affiliate' && project.data.affiliate !== undefined`) change. Every other project kind keeps today's stops and messages.
- `unknown` is never recorded as a pass; `qualityReviews` keep their real statuses.
- No extra paid generation beyond `qualityRetries`; never resubmit an admitted job.
- No spoken word is cut by the render.
- Existing tests are not edited or deleted. New tests only.
- English identifiers; Vietnamese user-facing text; shots are named "cảnh N" by their order in the video.
- Work only in `/Users/maiychrus/Documents/mai-studio-worktrees/affiliate-run-all`. The owner is running the app from `/Users/maiychrus/Documents/mai-studio` right now: never build, test or write there. No push.
- Before committing, read `git diff --stat`: a file reformatted Prettier-style by an outside tool must be restored from `git show HEAD:<file>` plus your intended edits.
- Commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A run-all whose reviews stay `fail` through every repair round: video produced, repairs equal `qualityRetries`, statuses still `fail`.
2. Reviews returning `unknown`: no extra generation, video produced, nothing marked passed.
3. A legacy affiliate project whose line overflows its slot, rendered by run-all and by a manual render: every measured speech part inside the rendered segments.
4. A non-affiliate project (film or studio) hitting the same review states: still stops with today's message.
5. A second run-all after a first one recorded attention: `production.attention` reflects only the latest run.

---

### Task 1: implement, test, document, verify

**Files:**
- Modify: `src/core/studio.ts` (`reviewAndRepair` ~1327–1416, `planAffiliate` ~1100–1141, the render block of `executePipeline` ~700–890, the run-all hand-off ~797–801, the `videos` stage return ~773–778)
- Test: `tests/studio.test.ts`, `tests/affiliate-workflow.test.ts`, `tests/quality.test.ts` or `tests/review.test.ts` — add tests next to the existing ones that already fake reviews and renders.
- Docs: `SYSTEM_DOCUMENTATION.md`, `CHANGELOG.md`, the spec's status line and a "Ghi chú sau thực thi" section.

- [ ] **Step 1: Write failing tests**, one per Review Focus line, plus:
  - `affiliate run-all lists shots to review in the success message` (exact Vietnamese format of spec section 3).
  - `affiliate script review failure after one rewrite continues with the latest plan and warns`.
  - `affiliate script with an invalid shape after one repair still waits with a rerun instruction`.
  - `manual render of a legacy affiliate project with a cut-off line still waits and names the shot to regenerate`.
- [ ] **Step 2: Run** the targeted files with `npm run build:core && caffeinate -i -s node --test dist/tests/<file>.test.js`. Expected: new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** targeted files, then `make build`, `caffeinate -i -s make test`, `make lint`, `node scripts/check-docs.js`, and two stress rounds `env -u ELECTRON_RUN_AS_NODE caffeinate -i -s node scripts/stress.mjs 1` and `… 2`. Expected: all green; test count = current total plus your new tests.
- [ ] **Step 5: Update docs and commit** `feat(affiliate): run-all finishes with shots to review instead of stopping`.

### Task 2: independent review (Opus 5.5, read-only)

Review `git diff main...feat/affiliate-run-all` against the spec, Global Constraints and Review Focus; report defects with file:line, a failing scenario and severity.
