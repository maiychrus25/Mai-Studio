# MaiStudio Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for the coordinated implementation and superpowers:dispatching-parallel-agents for the disjoint media, integrations and renderer tasks.

**Goal:** Implement the approved F01–F14 desktop studio with durable jobs and explicit provider readiness.

**Architecture:** A renderer invokes a typed preload bridge; StudioService owns validated commands, Store owns SQLite and Queue owns executions. Browser, media and provider adapters run actual operations and report unconfigured external dependencies honestly.

**Tech Stack:** Electron 41, Node 24.15+, TypeScript, React, SQLite via node:sqlite, Playwright Core, FFmpeg, Vite.

**Spec:** docs/specs/2026-11-14-mai-studio.txt (approved by operator on 2026-11-14).

## Global Constraints

- Separate repository and feature branch; no MaiHub modifications or deployment.
- macOS 14+ x64/arm64; Linux Ubuntu/Debian x64/arm64; Windows 11 x64.
- No fake successful jobs, plaintext secrets, arbitrary renderer filesystem paths or automatic paid resubmission after crash.
- Two desktop/mobile light/dark stress rounds; build/test/lint/docs checks and actual diff review.
- Ruling: use Node standard-library SQLite after proving it in Node 24.22.1 and Electron's Node 24.15.0; avoids better-sqlite3 ABI rebuilds.
- User approved execution M1–M5. Routine implementation choices and parallelization are delegated to the builder; do not request another plan approval.

## Review Focus

- Cancel during network/download/FFmpeg must not leave a succeeded job or partial output.
- Interrupted remote acceptance must not cause a duplicate paid submission.
- A profile must never be driven concurrently by two jobs; closing/reopening UI preserves persisted state.
- File traversal/symlinks/untrusted URLs and renderer commands must not escape their capabilities.
- Missing provider credentials/secret store must be actionable and must never count as completed parity.

## Task 1: Shared contract, durable store and queue (M1/M2)

Files: src/shared/studio.ts; src/core/store.ts; src/core/queue.ts; tests/store.test.ts; tests/queue.test.ts.
Interfaces: StudioState snapshot, StudioCommand invocation, Store project/task/account/record/asset methods; Queue receives runner(task, context), context checkpoint/signal/progress.
- [ ] Write tests for persistence, invalid inputs, account isolation, bounded concurrency, cancel and restart without resubmit; run RED.
- [ ] Implement validated SQLite operations and transitions; run complete tests GREEN.

## Task 2: Browser and generation (M1/M2)

Files: src/core/browser.ts; tests/browser.test.ts.
Interfaces: BrowserManager.open(account), close(accountId), generate(task, context), shutdown(). Uses Store credential callback and app-owned profile roots.
- [ ] Add real local browser fixture for prompt/ref/result download and aborted job; run RED.
- [ ] Implement Muse DOM interaction, persistent profiles, explicit login-required state and result checkpointing; run GREEN.

## Task 3: Media, subtitle and studio pipelines (M2/M3)

Files: src/core/media.ts; src/core/pipelines.ts; tests/media.test.ts; tests/pipelines.test.ts.
Interfaces: parseSrt/formatSrt; MediaTools.probe/merge/slideshow/dub; buildShots(record), pipeline execution through the same queue.
- [ ] Write tests for Unicode/timecodes, incompatible inputs, FFmpeg failure/cancel and real CPU-generated output; run RED.
- [ ] Implement bounded argv-based processes, file validation, atomic outputs and resumable scene pipelines; run GREEN.

## Task 4: External integrations, Codex and license hub (M4)

Files: src/core/integrations.ts; src/core/codex.ts; services/studio-hub.ts; tests/integrations.test.ts; tests/codex.test.ts; tests/hub.test.ts.
Interfaces: IntegrationClient methods accept validated connection settings and per-call AbortSignal; no credential enters snapshot. CodexJobs bounded CLI jobs and approval. Hub issues/verifies own Ed25519 tokens/config.
- [ ] Test real local HTTP fixtures for success/auth/malformed/429/error and cryptographic tampering; CLI controlled process fixture; run RED.
- [ ] Implement concrete request/response contracts, cancellation, limits and explicit unconfigured readiness; run GREEN.

## Task 5: Studio orchestration, IPC and OS capabilities (M1–M4)

Files: src/core/studio.ts; electron/main.ts; electron/preload.ts; tests/studio.test.ts; tests/security.test.ts.
Interfaces: invoke(command,input) returns typed domain result; snapshot event contains only safe views. Electron dialogs mint asset capabilities; custom protocol resolves asset IDs.
- [ ] Test command validation, save/edit/start/cancel/reload flow and unauthorized file/URL/secret handling; run RED.
- [ ] Connect queue, browser, media, studios and integrations without bypassing guards; run GREEN.

## Task 6: Production UI (M1–M4)

Files: src/ui/main.tsx; src/ui/App.tsx; src/ui/style.css; src/ui/global.d.ts.
Interfaces: window.studio.invoke, onChanged, pickFiles/pickFolder, mediaUrl. Commands and types from Task 1; no raw secrets in state.
- [ ] Add browser-driven interaction checks against the actual dev application/controlled bridge: projects, tasks, forms, navigation and error states.
- [ ] Implement Studio/Library/SRT/Films/Series/Aff/Dub/Market/Accounts/Proxies/Codex/Settings with real bridge commands; run desktop/mobile/light/dark checks.

## Task 7: Packaging, diagnostics and documentation (M5)

Files: .github/workflows/build.yml; scripts/check-docs.js; scripts/stress.mjs; README.md; SYSTEM_DOCUMENTATION.md; release readiness matrix.
- [ ] Test docs checker against drift/tampering and packaging inclusion checks.
- [ ] Build on host; prepare per-OS/architecture runner configurations without publishing or falsely claiming unrun OS tests.
- [ ] Run make build, make test, make lint, docs-check; execute two measured stress rounds and review diff independently.
- [ ] Record F01–F14 implementations, external blocks, tested platforms and remaining gaps. No all-feature/all-platform claim while evidence is missing.

## Progress

Dev implementation M1–M4 exists with actual local operations and contract fixtures; M5 is partial. Host and Linux verification, packaged runtime checks, independent diff review and measured stress results are recorded in SYSTEM_DOCUMENTATION.md and docs/reports/acceptance.md. Live provider access, advanced parity gaps, remaining OS/architecture checks and signed update/rollback acceptance remain open; the unchecked acceptance items above are not implied complete by a passing dev suite.

## Functional parity pass — operator reaffirmed “tốt bằng”, 14/11/2026

The acceptance target remains the approved F01–F14 spec. This pass repairs the simplified behavior found after the first dev handoff; it does not redefine success as feature names or fixture-only equivalence. Keep the currently opened packaged build intact until its replacement is verified. Continue on the isolated standalone feature branch; no MaiHub edits, live paid calls, push or deployment.

### Task P1 — recover executable workflow contracts

**Status: PARTIAL —** core story/film/series contracts và docs/reports/parity.md đã có; prompt/schema đầy đủ gốc remote và một số Aff/merge/covers contracts chưa khép. Controlled pure-function replay sau bước tĩnh có allowlist/SHA riêng, không import module/EXE.

- [ ] Read shipped app.js, config/browser/storyvoice/filmstudio/seriesstudio/affstudio bytecode with matching CPython 3.14, without executing the target. Record exact input fields, stage ordering, prompt schemas and recovery rules in docs/reports/parity.md with artifact paths/function names. Native engine/muse unknowns remain explicit; static inference is not runtime proof.
- [x] Turn the recovered story timing/grouping/alignment contracts into bounded source-replay fixtures (21 prior + 74 alignment cases, 2×1,000-cue digests); preserve source identity and keep remote recipe unknowns explicit. Other studio contracts remain in P1 scope.

### Task P2 — browser text/generation behavior

**Status: IMPLEMENTED + LOCAL FIXTURE EVIDENCE —** completeText/ref/stream/cancel/resume và generation/music đã có Chrome fixtures. Live Muse account/DOM behavior vẫn chưa nghiệm thu; đây không phải full parity.

Files: src/core/browser.ts, tests/browser.test.ts; reuse Store selectors and profile lease.
Interface: BrowserManager.completeText(task: Task, context: TaskContext): Promise<string> accepts a queued plan task with prompt/refIds and writes remote admission/thread/result checkpoints. Existing generate remains compatible.
- [x] RED→GREEN local Chrome fixtures: new replies must be distinguished from prior text, streaming must finish, references must upload, cancel and resume must not submit twice. Test generation ref/timing/error behavior against the recovered contract.
- [x] Implement supported recovered selector/mode behavior; unknown DOM conditions enter waiting_input with reason. No fabricated live success.

### Task P3 — actual AI planning, stages and narration

**Status: LOCAL IMPLEMENTATION VERIFIED —** queued AI/director, stages/cache/force, measured narration/source alignment, actual-image QC và speech/cohort integration có regression tests. Host snapshot 0.2.0-dev.1 có 296 tests pass; prompt gốc remote và live provider parity vẫn chưa nghiệm thu.

Files: src/core/planning.ts, src/core/studio.ts, src/core/store.ts, src/shared/studio.ts, tests/planning.test.ts, tests/studio.test.ts.
Interfaces: studio.run gains stage = plan|music|characters|images|videos|speech|check|render|all and optional shotIds. Existing stage omission keeps all. Plan tasks use TaskKind plan. AI completion uses configured text provider or BrowserManager.completeText through the same queue/profile lease. studio.plan remains explicit manual import/splitting for compatibility, and must be labeled manual in UI.
Persist stage assets in project.data.production maps (characterImages/images/videos/speech by stable ID), input fingerprints and stale state. Reuse task checkpoints; do not delete completed outputs when re-planning. Model output must be bounded JSON, validate cast/scenes/shots/timing/refs before project mutation. Never use a fallback five-second split as a claimed AI plan.
- [x] RED→GREEN focused HTTP/Chrome/queue evidence: real HTTP planning response changes the saved storyboard; malformed JSON/dangling cast/path refs preserve the previous plan; selected-stage retries reuse prior outputs; render-only never calls a provider; interrupted plan/TTS never duplicate admission.
- [x] Story narration uses source audio with actual ASR timing or per-sentence TTS durations before visual planning/render. Preserve cue gaps and source audio; record quality reviews as explicit results rather than assuming accuracy. Verify with generated WAV/MP4 and HTTP fixtures, and list unrun live acceptance separately.

### Task P4 — remaining local media/commerce/series behavior

**Status: PARTIAL —** FFmpeg transforms/hierarchy/voice-fit, CSV/JSON và series stale/recap/QA windows/subtitle clock đã nối và kiểm CPU. Nhạc recap liên tục, teaser/credit tự động, continuity và Market live vẫn chưa nghiệm thu.

Files: src/core/media.ts, src/core/pipelines.ts, src/core/products.ts and their tests; orchestration in studio.ts owned by parent.
Extend MediaInput with trim start/end and MediaOptions with fit pad|crop, fadeIn/fadeOut, audio fade controls. Reuse existing FFmpeg graph/atomic writer. No external paths through renderer.
- [x] RED→GREEN focused real FFmpeg evidence for trim/crop/fades, gap timing, subtitle/overlay/music, cancellation, PCM extraction/mix, ducking/Ken Burns and hierarchical sequences. Current code supports 1,002 sequence inputs in batches of 100; final check belongs to P5.
- [x] Connect QA-selected recap to series with raw output cache, stale/failed QA rejection, sidecar clock and retry/deleted-raw regressions. Local CPU evidence exists; continuous music and live equivalence remain open.
- [ ] Close remaining original merge/covers/audio-export acceptance, automatic teaser/credit and continuity comparison with the Windows runtime.
- [x] Implement quoted CSV/JSON product batch import with preserved facts/provenance/strict limits, and mark series child production stale on shared-cast changes without replacing media; focused parser/service evidence exists.
- [ ] Recover Market attachment delivery and validate authorized link/commerce behavior; never bypass vendor entitlements.

### Task P5 — expose actual workflow and verify parity

**Status: LOCAL VERIFICATION COMPLETE / PLATFORM AND LIVE ACCEPTANCE OPEN —** 0.2.0-dev.1 host build/test/lint/docs, two actual Electron rounds of 1,000 tasks and packaged macOS ARM64 ASR/render/playback passed. Earlier 0.1.0 evidence remains historical. Linux artifacts/native verification and live Windows comparison are recorded separately; no paid/live/prod action was performed.

Files: src/ui/AdvancedStudio.tsx, Workspace.tsx, Connections.tsx, Settings.tsx, shared contract and docs. Follow DESIGN.md and retain VI/EN, accessibility, light/dark/mobile.
- [x] Expose queued AI analysis, explicit manual splitting, selected-step/shot operations, narration/source audio, generation and review states. Connect each control to the shared commands; no extra JSON-only placeholder for an exposed workflow.
- [x] Review actual diff; run host make build/test/lint/docs-check, two actual Electron stress rounds on desktop/mobile/light/dark and packaged macOS CPU runtime checks. Linux ARM64 full suite passes; ARM64/x64 AppImage/DEB match compiled source and packaged native speech works. x64 selected suite has deadline failures under emulation, retained in the report.
- [ ] Complete physical x64/other platform and live Windows-vs-port acceptance. Runtime comparison, native unknowns and unconfigured services remain acceptance work; do not report “tốt bằng” without it.

### Documentation checkpoint — functional parity dev

SYSTEM_DOCUMENTATION.md and docs/reports/acceptance.md now distinguish implementation, controlled source replay, native CPU smoke and missing runtime parity. P1/P3/P4 remain partial; P5 is open. Full-suite numbers from in-progress merges are not promoted to final pass. Preserve the concurrently authored director section and historical acceptance records. Account/VPS availability is confirmed, connection/runtime comparison and paid-call authorization are separate. New ASR native/model limits and per-process media/product limits have docs-check markers bound to current constants; constants and version were not changed by this documentation task.
