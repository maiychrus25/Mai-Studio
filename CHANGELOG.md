# Changelog

This file records development changes. No production release is declared by a development checkpoint.

## Unreleased — 0.2.0-dev.1

### Added

- Shopee product intake through an authorized browser capture or configured API, preserving product facts, timestamps, variants, and source images.
- Affiliate workflow with eleven content styles, three host modes, scene references, source review, product-aware quality checks, and bounded scene repair.
- Scene captions, price/CTA/disclosure/end cards, post-copy export, music controls, and optional dubbing through configured providers.
- Offline Vietnamese speech analysis, staged production caches, and explicit review states.

### Changed

- Affiliate navigation, project list, setup tabs, scene cards, and advanced tools.
- Media preview byte-range handling and safe video seeking.
- Browser composer readiness, audio-menu download recovery, and provider-refusal handling without duplicate submission.
- Repository documentation, contribution workflow, formatting defaults, and validation on pushes to `main`; desktop packaging is an explicit manual option.
- macOS stress checks use a mock keychain in isolated test data.
- Linux CI fixes its subtitle font baseline to DejaVu Sans while retaining system fallbacks; visual assertions and application font settings are unchanged.

### Verification and limits

- Local macOS ARM64 and controlled Linux ARM64 evidence is recorded in [acceptance.md](docs/reports/acceptance.md).
- A live Fashion/silent Affiliate case completed; all style/host/language combinations and full Muse parity remain unverified.
- Account login, human verification, regional restrictions, provider credentials, signing, and physical-platform coverage remain separate acceptance requirements.

## Initial development checkpoints — 2026-11-14

- Established the standalone Electron/React/TypeScript application and approved system contracts.
- Added local production workflows, persistence, media tools, staged planning, native speech analysis, and Linux media verification.
