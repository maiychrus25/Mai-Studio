# Contributing to MaiStudio

MaiStudio is a development application. Read [AGENTS.md](AGENTS.md), [SYSTEM_DOCUMENTATION.md](SYSTEM_DOCUMENTATION.md), and the current [acceptance report](docs/reports/acceptance.md) before changing behavior. UI work also follows [DESIGN.md](DESIGN.md).

## Development setup

Use Node.js 24.15 or newer, npm, and Chrome/Chromium. Install FFmpeg/ffprobe when required by platform verification. Dependencies are pinned in `package-lock.json`; use `npm ci`.

```sh
npm ci
make build
npm start
```

Set `MAISTUDIO_DATA_DIR` to a disposable directory for experiments. Account profiles, cookies, provider credentials, databases, model weights, media, and debug artifacts belong outside the repository. The application stores credentials through its OS-keystore boundary; do not add credentials to source or example configuration.

## Change workflow

1. Start a focused branch from `main`, such as `feat/affiliate-voice` or `fix/media-preview`.
2. Keep changes within the requested scope. Reuse existing components and services. Use English identifiers and preserve Vietnamese/English user-facing copy.
3. Add meaningful regression coverage when changing behavior. Update `SYSTEM_DOCUMENTATION.md` and its `docs-check` markers in the same commit as contract, limit, IPC, or release-flow changes.
4. Update `CHANGELOG.md` under Unreleased. Commit reviewable milestones; keep related source, tests, and documentation together. Do not leave completed features only in the working tree.
5. Review the actual diff and run the checks below. Open a pull request describing the concrete behavior, verification, and remaining limits.

```sh
make build
make test
make lint
node scripts/check-docs.js
node scripts/stress.mjs 1
node scripts/stress.mjs 2
```

The two stress rounds use local provider fixtures and temporary user data. Each round checks desktop/mobile, light/dark, queue cancellation, persistence, and reopening without resubmission. On macOS the stress runner uses Chromium's mock keychain; this does not certify real Keychain access. On a Linux host without a display, run the Electron stress commands through `xvfb-run -a`. Never disable the Chromium sandbox to make verification pass.

Record the platform, architecture, evidence, and exact scope of each result. A fixture or available quota does not prove a live provider, video entitlement, or artistic quality. Testing external providers or paid jobs requires authorization.

## Architecture boundaries

| Directory | Responsibility |
| --- | --- |
| `electron/` | Desktop lifecycle, preload bridge, IPC boundary, media protocol |
| `src/core/` | Production workflows, queue, persistence, browser/provider and media integration |
| `src/shared/` | Shared types and validation contracts |
| `src/ui/` | React screens, forms and previews |
| `services/` | Independent service entry points, including the license hub |
| `tests/` | Unit and integration tests with controlled fixtures |
| `scripts/` | Documentation validation and Electron stress checks |
| `tools/` | Platform verification and packaging containers |
| `docs/` | Specifications, implementation plans, acceptance and parity evidence |

Keep renderer actions behind the typed preload bridge. Preserve validation, cancellation, remote-admission checkpoints, and existing output files on failure. Do not introduce another architecture or dependency without a concrete need.

## CI and release

GitHub Actions validates pull requests and pushes to `main`. The Build workflow's `package_artifacts` manual option creates test installers on native macOS ARM64/x64, Linux ARM64/x64, and Windows x64 runners in parallel with verification. Artifacts may appear before verification finishes; the overall build is accepted only when verification and all package jobs pass. macOS uses ad-hoc signing; Windows has no signing certificate. Artifacts retain installer files and generated update metadata/blockmaps for 14 days, not unpacked application directories; missing files fail the upload step. The optional manual release_tag must match the development package version. After verification and all five packages succeed, a job with contents:write downloads artifacts inside Actions, checks all nine installer names, creates SHA256SUMS.txt and prepares a draft pre-release. Public publication still requires final digest verification. CI does not deploy the license hub. Installation, trusted signing, publishing, and deployment remain separate authorized steps.

Linux CI checks the runner's existing DejaVu Sans and Chrome, uses the bundled FFmpeg and a checksum-pinned FFprobe from its upstream b6.1.1 release, and sets `FONTCONFIG_FILE` to `tools/ci-fonts.conf`. Missing fonts/browser still fail verification; no APT operation or fresh Playwright browser installation is required. The configuration prefers DejaVu Sans for Arial while retaining system fallback fonts. To reproduce those visual checks on Linux, use the same font setup; application font selection outside CI is unchanged.

The package is `UNLICENSED`. Publication of the repository does not grant an open-source license.
