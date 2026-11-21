# In-App Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pushed `v<version>` tag produces a public GitHub (pre)release with installers and electron-updater metadata; the packaged app shows its real version, detects newer releases, downloads them and installs (Windows NSIS / Linux AppImage) or downloads, verifies and opens the dmg (macOS).

**Architecture:** electron-updater's GitHub provider (embedded `app-update.yml` via `build.publish`) in `electron/main.ts`; a small pure module for macOS dmg selection and sha512 verification; update state carried in `StudioState` so the renderer shows a banner and the Settings panel; the tag-triggered release job in `.github/workflows/build.yml` publishes the existing installers plus `latest*.yml` and blockmaps, with `latest-mac.yml` merged across arm64/x64.

**Tech Stack:** Electron, electron-updater 6.8.11 (installed), electron-builder, GitHub Actions, TypeScript, React, `node:test`.

**Spec:** `docs/specs/2026-11-21-in-app-updates.md` (Vietnamese). Read it first.

## Global Constraints

- No new dependency. `js-yaml` is already in `node_modules` (transitive of electron-builder); only use it from CI/scripts if it is a declared dependency, otherwise parse in Python or with electron-updater's own types.
- Keep `SignedUpdateGate` (`src/core/updates.ts`) and its tests; stop requiring it and the License Hub for the GitHub path. Remove `MAISTUDIO_UPDATE_FEED` wiring only if nothing else uses it.
- Never install a file whose sha512 does not match the release metadata. No install while tasks are running or queued (`assertUpdateIdle`).
- Unpackaged dev runs never check for updates; they report that only installed builds update.
- No secrets, tokens or user identifiers in update requests or logs.
- UI follows `DESIGN.md`; banner and Settings states work in light/dark, desktop and mobile widths, no horizontal overflow; Vietnamese and English copy via the existing `t(vi, en)` helper.
- Do not bump `package.json` version, tag, push or create releases. The lead does the release.
- Existing tests are not edited or deleted unless the change in behaviour is required by the spec (the displayed version, update command errors); list every edited existing test and why in your report.
- Work only in `/Users/maiychrus/Documents/mai-studio-worktrees/in-app-updates`. The owner runs the app from `/Users/maiychrus/Documents/mai-studio`: never build, test or write there. Another agent works in `…/affiliate-run-all` on `src/core/studio.ts`; keep your `studio.ts` edits small and local (version, `update.*` cases, snapshot field) to ease the merge.
- Before committing read `git diff --stat`: a file reformatted Prettier-style by an outside tool must be restored from `git show HEAD:<file>` plus your intended edits.
- Tests: `caffeinate -i -s make test` (the Mac sleeps after one idle minute). Electron: `env -u ELECTRON_RUN_AS_NODE`.
- Commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. `latest*.yml` URLs equal the uploaded asset names exactly (no space/dot renaming mismatch); merged `latest-mac.yml` lists both arm64 and x64 files with correct sha512/size.
2. The release job runs only for `v*` tags matching `package.json`, after verify and all five package jobs; the release is public, pre-release iff the version contains `-`; re-running does not overwrite an existing release.
3. macOS path: picks the dmg for `process.arch`, verifies sha512 before opening, deletes/ignores a mismatching file, never calls Squirrel `quitAndInstall`.
4. Windows/AppImage path: `quitAndInstall` only after `update-downloaded` and `assertUpdateIdle`; `.deb` installs open the release page instead.
5. Offline/GitHub errors stay inside the update state; app start is not blocked; no unhandled rejection.
6. Displayed version equals `app.getVersion()`.

---

### Task 1: implement, test, document, verify

**Files (expected):**
- Modify: `package.json` (`build.publish`, `artifactName` per target), `.github/workflows/build.yml` (tag trigger, package on tag, public release job with metadata), `electron/main.ts` (updater wiring), `src/core/studio.ts` (version, `update.*`, snapshot), `src/shared/studio.ts` (update state type), `src/ui/Settings.tsx` and the app shell for the banner, `src/ui/*.css` as needed.
- Create: a small module for macOS dmg selection + sha512 verification (e.g. `electron/mac-update.ts` or under `src/core/`) with tests.
- Test: new tests next to the existing studio/update tests.
- Docs: `SYSTEM_DOCUMENTATION.md` (release + update section), `CHANGELOG.md`, `docs/reports/acceptance.md` if it records release procedure, spec status line and "Ghi chú sau thực thi".

- [ ] **Step 1: Write failing tests** for: dmg selection per arch, sha512 match/mismatch, `allowPrerelease` from the version, snapshot update state, displayed version, install refused while a task runs, `update.check` in an unpackaged build returns the "installed builds only" state rather than throwing an opaque error.
- [ ] **Step 2: Run** them: `npm run build:core && caffeinate -i -s node --test dist/tests/<file>.test.js`. Expected: fail.
- [ ] **Step 3: Implement** app side, UI and CI.
- [ ] **Step 4: Package locally** `npx electron-builder --mac zip dmg --arm64 --publish never -c.mac.identity=-` (with `CSC_IDENTITY_AUTO_DISCOVERY=false`) and check: `release/latest-mac.yml` URLs equal file names in `release/`, `MaiStudio.app/Contents/Resources/app-update.yml` exists with the GitHub provider. Run the `latest-mac.yml` merge step of the workflow locally against two sample files (copy the arm64 file and fake an x64 entry) to prove it. Validate the workflow YAML parses. Delete `release/` afterwards.
- [ ] **Step 5: Verify** `make build`, `caffeinate -i -s make test`, `make lint`, `node scripts/check-docs.js`, two stress rounds `env -u ELECTRON_RUN_AS_NODE caffeinate -i -s node scripts/stress.mjs 1` and `… 2`, plus screenshots of the banner and Settings states (light/dark, desktop/mobile) by forcing the update state in a dev run.
- [ ] **Step 6: Update docs and commit** `feat(updates): in-app updates from public GitHub releases`.

### Task 2: independent review (Opus 5.5, read-only)

Review `git diff main...feat/in-app-updates` against the spec, Global Constraints and Review Focus; report defects with file:line, a failing scenario and severity.
