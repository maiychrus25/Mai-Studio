# Changelog

This file records development changes. No production release is declared by a development checkpoint.

## 0.2.0-dev.3 — pre-release candidate

- Fix page capture choosing one JSON-LD image instead of the full scoped product gallery. Explicit gallery containers take priority over generic hero-image classes; valid structured product images remain a fallback.
- Preserve structured price/description and the cache-only capture path; do not append an unrelated SEO image to a known gallery.
- Explain that an existing capture bookmark must have its URL replaced with freshly copied code after upgrading the app.
- Native builds and public release are pending verification; existing releases remain available.

## 0.2.0-dev.2 — pre-release, 2026-11-19

- Fix Shopee cached product prices when unavailable ranges are marked `-1`: use the supplied current single price before item fallback prices, preserving strict validation for other numeric facts.
- Import up to nine gallery images instead of eight, preserving source order, duplicate removal, per-image validation and cancellable checkpoints. Captures with more than nine images retain a visible truncation warning.
- Published nine native installers and SHA256SUMS.txt for macOS ARM64/x64, Linux ARM64/x64 and Windows x64 after successful Build 44501164595 at source d6e179c. Trusted signing and live provider/platform acceptance remain separate requirements.

## 0.2.0-dev.1 — development pre-release distribution

- Distribute the nine existing native installers from successful CI Build 44049704483 at source commit `35f8d82` through GitHub Releases, with SHA256 checksums. No application code, version, automatic updater, registry package, or deployment changes.
- macOS remains ad-hoc signed and unnotarized; Windows remains without a trusted signing certificate. Five successful package jobs do not certify live provider or runtime coverage on every platform.

## Unreleased — 0.2.0-dev.1

### Added

- Shopee product intake through an authorized browser capture or configured API, preserving product facts, timestamps, variants, and source images.
- Affiliate workflow with eleven content styles, three host modes, scene references, source review, product-aware quality checks, and bounded scene repair.
- Scene captions, price/CTA/disclosure/end cards, post-copy export, music controls, and optional dubbing through configured providers.
- Offline Vietnamese speech analysis, staged production caches, and explicit review states.

### Changed

- Shopee cached captures accept the unavailable-price marker `-1` and fall back to the supplied current single price before item prices, preserving strict validation for other numeric facts and official API prices.
- Affiliate navigation, project list, setup tabs, scene cards, and advanced tools.
- Media preview byte-range handling and safe video seeking.
- Browser composer readiness, audio-menu download recovery, and provider-refusal handling without duplicate submission.
- Repository documentation, contribution workflow, formatting defaults, and validation on pushes to `main`; desktop packaging is an explicit manual option.
- macOS stress checks use a mock keychain in isolated test data.
- Linux CI fixes its subtitle font baseline to DejaVu Sans while retaining system fallbacks; visual assertions and application font settings are unchanged.
- CI checks the existing hierarchical subtitle render before the full suite; a failure reports its pixel peak and actual FFmpeg version without relaxing the assertion.
- Native installer CI follows the existing MaiHub build pattern: verification gate, separate platform runners, ad-hoc macOS signing, installer-only artifacts retained for 14 days, and explicit failure when upload outputs are missing.
- H.264 rendering requests x264's CPU-independent decisions across native runners; CRF, frame clock, typography and audio settings are unchanged.
- Manual development packaging runs alongside verification for earlier installer artifacts; acceptance still requires both verification and all native package jobs to pass.

### Verification and limits

- Local macOS ARM64 and controlled Linux ARM64 evidence is recorded in [acceptance.md](docs/reports/acceptance.md).
- A live Fashion/silent Affiliate case completed; all style/host/language combinations and full Muse parity remain unverified.
- Account login, human verification, regional restrictions, provider credentials, signing, and physical-platform coverage remain separate acceptance requirements.

## Initial development checkpoints — 2026-11-14

- Established the standalone Electron/React/TypeScript application and approved system contracts.
- Added local production workflows, persistence, media tools, staged planning, native speech analysis, and Linux media verification.
