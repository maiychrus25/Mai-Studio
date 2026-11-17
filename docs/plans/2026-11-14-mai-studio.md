# MaiStudio Implementation Plan

## Muse-like interface and remaining Affiliate verification — 16/11/2026

Status: DEV UI/AUDIO IMPLEMENTED; SPOKEN LIVE AND FULL PARITY OPEN. Operator approved simplifying the UI to resemble Muse and continuing Affiliate parity checks. Existing UI flow is bounded; preserve all commands, fields, outputs, edit merging and safety guards. No new dependencies or provider features guessed from names.

- [x] Read observed Muse screenshots/settings/scene grid and current renderer; capture task baseline outside repo.
- [x] Use a horizontal app navigation, compact page heading, Affiliate project list, visible production stages, grouped settings, collapsed technical/history detail and visual scene cards. Keep mobile drawer, light/dark, keyboard focus and old pages accessible.
- [x] Reuse existing form controls/actions; move rather than duplicate save/run/music/review controls. Keep errors and pending input visible. Update DESIGN.md and system docs with UI behavior.
- [x] Independently audit native Affiliate behavior against implemented code and actual evidence; report definite gaps separately from unknown recipes and untested live combinations.
- [x] Verify actual diff; run build/test/lint/docs; two desktop/mobile bilingual/theme UI stress rounds and existing page navigation regressions. Package dev artifacts only.
- [x] Attempt the bounded spoken/music live case: plan/review, real music and one image completed; video was explicitly refused by region. Retain the admitted checkpoint and assets; no invented spoken-clip success. Native quota/login refresh found five new valid accounts; one capability request each for7/9/10/11 and the prior owned refusal at8 all reported regional video restriction. No new clip, no retry, all owned holds restored.
- [ ] Complete a new spoken/music clip and matching native comparison with video-eligible accounts; optional VoiceTube live and all-style artistic equivalence remain open.

Likely files: App.tsx, AdvancedStudio.tsx, AffiliateWorkflow.tsx, Production.tsx, style.css, DESIGN.md and existing project docs. Source/intake/media engine changes require a concrete reproduced gap first. Rollback only current UI patches against /private/tmp/mai-studio-interface/starting-tree; retain all prior work and media. No push, deployment, production config, unrelated restarts or real-data migrations.

## Affiliate production after Shopee intake — 16/11/2026

Status: DEV IMPLEMENTED / ONE LIVE FASHION-SILENT CASE VERIFIED. Full live style/host parity remains open; see acceptance.md. Operator requested the remaining Affiliate workflow to follow Muse after the verified product import. Scope: eleven content styles, three host modes, 15/30/45/60-second budgets and distinct scene structure; optional presenter/background and 1–4 outfit references; source-grounded script and independent plan review; existing image/video review and bounded scene repair; actual captions/price/CTA/labels, montage timing and export. Reuse the existing all-stage queue, native narration, media renderer and edit guards. Legacy projects without explicit affiliate settings retain their behavior. Film/SRT features are outside this change.

Native contract evidence: shipped Muse web/app.js Affiliate section (1.13.12) and options read from running 1.13.18 on the operator VPS. The remote prompt recipes are not available; Mai writes its own prompts to implement observed behavior. Static source, fixture runs and live generation evidence are reported separately. Do not claim artistic parity from option coverage.

Implementation: domain/settings + matrix tests and UI can proceed in disjoint modules; parent integrates planning/service/pipeline/rendering. Plan source/host/structure review stops on unknown and repairs a failed plan once before media generation. Review actual diff, run build/test/lint/docs and two desktop/mobile light/dark stress rounds; then verify a bounded live Affiliate run with the imported product and logged-in profile. Preserve the prior accepted videos, imported product and all existing media. No release/push/production deployment. Rollback only this task's changes against /private/tmp/mai-studio-affiliate-workflow/starting-tree.

## Current priority — Affiliate intake first (operator direction 16/11/2026)

Status: DEV IMPLEMENTED / ONE FRESH SHOPEE PRODUCT VERIFIED. The operator captured the loaded page and the packaged UI saved matching facts, 8 SKU combinations and 7/7 gallery images. Official API live and broader category/layout coverage remain pending; see acceptance.md. No full Affiliate parity claim.

Order: Shopee product-link intake → all Affiliate content/scenario types → Film → SRT Video last. The SRT quality work above is retained as engine groundwork, not Affiliate acceptance.

Immediate scope: validated long/short Shopee links; official API when provisioned; open the operator browser and a product-only capture bookmarklet when API/page access is unavailable; normalize captured product facts/variants/images with provenance; import actual image bytes into Library through a cancellable/resumable job; save only into the intended project and retain previous outputs. Missing/login/blocked/partial source data must be visible. No cookie/password transfer, access-control bypass or global VPS account/proxy changes.

Implementation: shared intake result and queue contract → link/capture/parser/download core with boundary tests → native-equivalent product form and bookmarklet guide → complete build/test/lint/docs and diff review → two desktop/mobile light/dark stress rounds → scoped real Shopee source/image verification → current dev artifact. Existing CSV/JSON and official API callers must remain compatible. Reuse Node URL/fetch/fs, Store, Queue, existing desktop actions and UI components; no dependency needed. Rollback by task-only diff against /private/tmp/mai-studio-shopee-import/starting-tree; preserve the preceding quality workflow.

Acceptance: a supported link and operator-visible product capture populate the correct name, supplied price/description/attributes/variations and owned product images; source URL/method/time and unavailable fields are shown; mismatch/private URL/malformed payload/image errors never silently replace prior project data or count as complete. Fixture tests establish contracts; current live page/account coverage is reported separately.

## Quality workflow upgrade — 16/11/2026

**Status: DEV IMPLEMENTED / LIVE MAI VERIFIED —** three-shot live quality workflow caught and repaired one failed scene; same-frame prompt A/B completed. Native1.13.18 fresh comparison is blocked by the provider error page. No full parity claim.

Scope: structured visual/action/acting/camera/environment prompts; character/product references belong to scene-image generation, and generated video uses one scene anchor. Standalone multi-reference generation remains available. Add bounded, cancellable sampling of the actual clip window and model review of action, motion, continuity and identity. Preserve unknown and provider-admission guards. New AI plans enable review and allow one repair by default (maximum two); explicit existing opt-outs remain. A manual render remains provider-free.

Implementation sequence: pipeline/planner contracts and regression tests → frame sampling and temporal review → bounded repair/history/best assessed take → UI results and controls → dev build/test/lint/docs → two desktop/mobile light/dark stress rounds → scoped live comparison with retained originals → review actual diff and document remaining limitations.

Rollback: retained starting worktree snapshot outside the repo; reverse only this task's patches, never reset prior user changes. No production deployment, migration, push or unrelated service restart. Keep every generated asset and the earlier accepted video.

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

### VPS runtime follow-up — 15/11/2026

Scope: repair F02 against observed Muse DOM in the existing dev branch. Files: `src/core/store.ts`, `src/core/browser.ts`, their existing tests, system documentation and parity report. No UI changes, dependencies, provider jobs, schema migration or deployment. Rollback is the scoped Git diff; keep existing packaged artifacts intact.

Evidence: owned RDP DOM probes found a textarea under `data-hatch-composer-root`; the action slot has zero buttons when empty and one Send button after an unsent draft. The draft was cleared without submission. Original 39.646-second lookbook was copied with source SHA-256 matching; it is a reference, not a MaiStudio result.

- [x] Reproduce default textarea readiness/generation, custom lazy submit and persisted legacy defaults with failing real-browser/store tests: seven selected cases RED, then GREEN.
- [x] Extend the default composer to textarea/contenteditable; resolve only the exact legacy default at settings read, preserving custom selectors and disk schema. Require the composer before filling, then wait for Send. Preserve admission/cancellation guards.
- [x] Run the complete suite (302/302), build/lint/docs, two existing desktop/mobile/light/dark stress rounds and a fresh diff review. Reviewer identified one unsupported documentation marker; removed it and reran docs-check. No remaining code finding in the reviewed scope. Evidence: `/private/tmp/mai-studio-vps-audit/`; live generation and full quality parity remain open.

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

Post-implementation note, 16/11/2026: scoped paid/live three-scene comparison is now authorized. Mai completed new AI assets/render; original Muse clips were started once, then RDP disconnected and reconnect timed out. Full acceptance remains open. Real13s media exposed broken seeking; shared preview byte-range serving was corrected and packaged desktop/mobile light/dark seeking verified. This updates current evidence without reclassifying historical fixture-only checks or claiming full parity. Default SRT import grouping still differs from original.

**Status: LOCAL VERIFICATION COMPLETE / PLATFORM AND LIVE ACCEPTANCE OPEN —** 0.2.0-dev.1 host build/test/lint/docs, two actual Electron rounds of 1,000 tasks and packaged macOS ARM64 ASR/render/playback passed. Earlier 0.1.0 evidence remains historical. Linux artifacts/native verification and live Windows comparison are recorded separately; no paid/live/prod action was performed.

Files: src/ui/AdvancedStudio.tsx, Workspace.tsx, Connections.tsx, Settings.tsx, shared contract and docs. Follow DESIGN.md and retain VI/EN, accessibility, light/dark/mobile.
- [x] Expose queued AI analysis, explicit manual splitting, selected-step/shot operations, narration/source audio, generation and review states. Connect each control to the shared commands; no extra JSON-only placeholder for an exposed workflow.
- [x] Review actual diff; run host make build/test/lint/docs-check, two actual Electron stress rounds on desktop/mobile/light/dark and packaged macOS CPU runtime checks. Linux ARM64 full suite passes; ARM64/x64 AppImage/DEB match compiled source and packaged native speech works. x64 selected suite has deadline failures under emulation, retained in the report.
- [ ] Complete physical x64/other platform and live Windows-vs-port acceptance. Runtime comparison, native unknowns and unconfigured services remain acceptance work; do not report “tốt bằng” without it.

### Documentation checkpoint — functional parity dev

SYSTEM_DOCUMENTATION.md and docs/reports/acceptance.md now distinguish implementation, controlled source replay, native CPU smoke and missing runtime parity. P1/P3/P4 remain partial; P5 is open. Full-suite numbers from in-progress merges are not promoted to final pass. Preserve the concurrently authored director section and historical acceptance records. Account/VPS availability is confirmed, connection/runtime comparison and paid-call authorization are separate. New ASR native/model limits and per-process media/product limits have docs-check markers bound to current constants; constants and version were not changed by this documentation task.

### Repository publication — 17/11/2026

**Status: IMPLEMENTED AND LOCALLY VERIFIED —** source checkpoint `bdbdf3f` was pushed to the operator-supplied origin `https://github.com/maiychrus25/Mai-Studio.git` on `main`, and the remote commit matched locally. The repository guidance/CI contract is implemented with verification below; per-commit GitHub CI results remain the authority for hosted validation. This authorizes source publication and repository hygiene, not production deployment or a release.

Bounded plan: preserve the existing 43-file product snapshot as a reviewed development checkpoint; keep the current source-directory boundaries; complete README/contribution/changelog/PR/formatting guidance; validate pushes and PRs with the existing CI, keeping desktop packaging a manual opt-in. Reuse the current build/test/docs/stress tools; do not add a runtime dependency or move working modules.

- [x] Review and commit the existing product snapshot with its matching tests and system documentation.
- [x] Add repository guidance, CI triggers/manual packaging, and macOS stress keychain isolation.
- [x] Verify build/test/lint/docs and two desktop/mobile, light/dark stress rounds; review the final diff.
- [x] Add the supplied origin, rename the branch to main, push without force, and compare the local and remote commit IDs. Record the actual CI result separately from local verification.

Post-implementation evidence: macOS ARM64 full suite 407/407, build/lint/docs and actionlint passed. Shipped Electron stress round 1: 980 succeeded/20 cancelled; round 2: 883 succeeded/66 intentional fixture-429 failures/51 cancelled; peak concurrency 2, zero renderer errors, four desktop/mobile/light-dark screenshots each and no reopen resubmission. Logs/screenshots remain outside the repo under `/private/tmp/mai-studio-interface/`. A review P2 about stale speech-assessment UI when Affiliate dub is enabled is recorded in acceptance.md; publication does not certify that branch or full Muse parity.

Hosted CI follow-up: the first Linux x64 run reported406/407 due to a font-dependent small-caption pixel assertion. The unchanged test was reproduced RED with Liberation Sans and GREEN with DejaVu Sans in isolated Linux; CI now selects the prior QA font baseline through tools/ci-fonts.conf and checks fc-match before tests. No source/test assertion or packaging font selection changed. Follow-up hosted validation is tracked per commit in GitHub Actions.

- [ ] Obtain the post-fix full Linux x64 CI result after hosted runner availability is restored. Run44031873818 for f6553bc never started a runner and had zero steps; its account/runner annotation is external to source validation. Do not report hosted CI green from local evidence.

### Native CI installer build — 17/11/2026

**Status: IMPLEMENTED LOCALLY / NATIVE JOBS PENDING —** the operator requested CI build like automation-marketing. The existing MaiHub workflow was read as the reference: verification gate, native OS runners, macOS ad-hoc signing, installer-only artifacts, and 14-day retention. MaiStudio reuses its current five-platform matrix and its own build commands; no MaiHub-only runtime or release task is added.

Files: .github/workflows/build.yml, README.md, CONTRIBUTING.md, SYSTEM_DOCUMENTATION.md, CHANGELOG.md and this plan. There is no application-source, version, schema, IPC, or dependency change.

- [x] Review the scoped workflow diff; pass build/lint/docs/actionlint and both Electron desktop/mobile, light/dark stress rounds.
- [ ] Commit/push the workflow, then dispatch build.yml on the exact main commit with package_artifacts=true; the new run must complete its full verification gate.
- [ ] Inspect all five native package jobs and their installer artifacts. Fix observed packaging errors in dev, rerun the affected jobs, and distinguish package success from runtime acceptance.
- [ ] Verify final main/remote state and provide the run/artifact download links. Do not create a tag, GitHub Release or production deployment during this installer-only task.

Rollback is the scoped workflow/documentation commit; existing product commits and user data are preserved. Risks to report: ad-hoc/untrusted signing and runtime/provider coverage not established merely by building installers. Retain failure logs and actual platform results rather than promoting configured matrix entries to successful builds.

Pre-dispatch evidence: Build succeeded, lint/docs/actionlint exit0; round1 980 succeeded/20 cancelled; round2 881 succeeded/68 intentional fixture-429 failures/51 cancelled; each1000 tasks, peak2, zero renderer errors and desktop/mobile/light-dark assertions plus reopen/no-resubmit. Report path `/private/tmp/mai-studio-ci-packaging-20261117/stress/`. Fresh full `make test` is the mandatory hosted verify gate before any native package job.

Rollback: each new change has its own Git commit; the historical three commits remain intact. Preserve the working tree and existing user data. A rejected push requires checking remote history, never automatic force-pushing.
