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

Plan written; implementation in progress. Completion and verification evidence is maintained in SYSTEM_DOCUMENTATION.md and docs/reports/.
