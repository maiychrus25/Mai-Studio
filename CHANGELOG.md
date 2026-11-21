# Changelog

This file records development changes. No production release is declared by a development checkpoint.

## Unreleased — development

- Video Aff "run all" finishes with a rendered video and a list of shots to review instead of stopping: failing or unknown quality reviews keep the best take within `qualityRetries` (unknown is never repaired or marked passed), a script that still fails review after one rewrite is used and flagged, legacy projects whose line overflows its slot render by measured speech without cutting words, and a cut-off line is rendered and flagged. The list is saved as `production.attention` and shown in the task message ("cảnh N" by order); manual render renders a legacy overflow by measured speech and lists it, and stops only at a cut-off line or a silent clip, naming the shot and what to press. Other project kinds and dubbed Video Aff reviews keep today's stops.
- Video Aff run-all review fixes: manual render of a legacy project whose line overflows its slot now renders by measured speech and lists the shot instead of stopping; a silent spoken clip in a checked run is repaired within `qualityRetries` and then rendered and listed; a script that failed review is listed on every Video Aff render, dubbed or not; `production.attention` is cleared when each run starts; stop messages name the card as "Shot N" in the "Shot & timeline" tab (Storyboard) and the "Tạo lại clip riêng cảnh này" icon button, the edited-script stop lists readable reasons, speech reasons no longer show the model's repair instruction, and the review note in advanced tools is accurate for Video Aff.
- Find the music reply after a Muse page reload: a reload renders fewer assistant replies than the live page, so a resumed music task waited 15 minutes beside its finished track. Music submits now record the newest user message (`beforeUserCount`, `beforeUserId`, `beforeUserText`); the task takes the last audio reply after the newest user message once that message is no longer the pre-submit one, never attaches audio while the pre-submit message is still newest, and stops at once with import instructions (download the MP3 from the last reply, import it in Thư viện, pick it as the project's music file) when it cannot tell. Legacy checkpoints with only a reply baseline use the exact prompt as the anchor. The music timeout gives the same instructions.
- Fix the silent-clip note in a reviewed render so an empty note list is filled.
- In-app updates from public GitHub releases: the app shows its real version (`app.getVersion()`), checks for a newer release on start and from Settings → License & updates, and shows a banner. Windows and Linux AppImage download and install with a restart; macOS downloads the dmg for its architecture, verifies its sha512 against `latest-mac.yml` and opens it; Linux .deb opens the release page. Installing still requires no running tasks. Installs from 0.2.0-dev.4 or older need one manual install of the first release with this feature.
- Pushing a `v<version>` tag publishes a public (pre-)release after verification and all five package jobs, with installers, blockmaps, `latest*.yml` (macOS arm64/x64 merged) and SHA256SUMS.txt. Installer names have no spaces (`MaiStudio-<v>-<arch>.dmg/.zip`, `MaiStudio-Setup-<v>.exe`); the manual draft-release input is removed.
- Accept the new Muse audio reply when the music request has a reply baseline, even if Muse shows the request text differently; the exact-text binding now applies only to legacy admissions without a baseline. Run-all with automatic music no longer stops on "Reply nhạc không thuộc yêu cầu đang chạy".
- Normalize Video Aff background music to −10 LUFS before applying its volume (new `musicLoudness` media option), so the music bed is audible at the chosen level whatever the track's mastering; a quiet −20 LUFS track at 14% used to sit more than 20 dB under the voice. Other project kinds mix music as before.
- Plan Video Aff scripts in Muse's shape for nine content styles (one fact per shot, labelled beats, product/presenter shots, `productLook`, `productVisible`, outfit and narrator descriptions) behind a stored `affiliatePlanVersion: 2` marker. Planning these styles always requires the v2 shape (one repair attempt, then the existing stop); ASMR, POV and saved projects that are not re-planned keep the previous path.
- Compose v2 image, clip and host-portrait prompts from Muse's observed templates with Muse's reference order; spoken Vietnamese lines in clip prompts read numbers and units as words while frames and subtitles keep the written line.
- Cut v2 spoken clips at the measured speech (0.12 s lead, 0.30 s hold, 1 s run gap) and place them back to back; a line ending in the last 0.15 s stops render and fails speech review instead of being clipped. Captions and flashes follow the real cuts, so spoken videos can run longer or shorter than the target.
- Render spoken v2 Video Aff projects with Muse's fast edit by default: jump-cut silences over 0.3 s (0.08 s kept each side), speed 1.1× with pitch kept and 2–6-word phrase captions, with no automatic zoom (Muse's punch-in and opening pop were dropped after the owner found them jerky). Segments are whole output frames, punch/pop keep square pixels at any frame size, and the two render options stay out of planning and review prompts. New "Edit pace" and "Speech speed" options (`pace`, `speechSpeed`); "Plain", fashion/lookbook/ASMR/POV, dubbing, slideshow and legacy projects render exactly as before.
- Cap the v2 planning product description at 4000 characters, omit the planned duration from v2 repair feedback, and stop a partial v2 render with a clear message.

## 0.2.0-dev.4 — pre-release, 2026-11-20

- Publish nine desktop installers and SHA256SUMS.txt from `185b618` after CI verification, five native package jobs, local 433/433 tests, two 1,000-task stress rounds and final artifact checks; retain documented provider/runtime limits.

- Give native Affiliate generation its exact edit window and synchronize speech/action; keep empty-dialogue inserts free of voice directions.
- Pass measured speech failures, unexpected words and failed visual evidence into bounded repair feedback instead of generic retries or passed checks.
- Ask planning and independent review to reject product/action contradictions and unexplained anchor/framing changes, preserving existing saved scripts and exhausted repair limits.
- Resume automatic quality control with the newest matching explicit image/video/speech assessment, preserving unresolved admission, source identity and quality gates.
- Keep the current assessment/score for an existing take without counting a resume as another generation.
- Add a confirmed reassessment action for failed/inconclusive shots within the waiting job's scope, reusing the existing review stage and saved media.
- Exclude assessments from a different review policy when restoring the best take and preserve its completed review checkpoint on repeated resume.
- Bind browser text replies to new message IDs when available, retaining legacy count-based checkpoints and admission guards.
- Install the prebuilt Mac ARM64 application after explicit approval, preserving existing accounts and media; live provider review remains under verification.

## 0.2.0-dev.3 — pre-release, 2026-11-20

- Fix page capture choosing one JSON-LD image instead of the full scoped product gallery. Explicit gallery containers take priority over generic hero-image classes; valid structured product images remain a fallback.
- Preserve structured price/description and the cache-only capture path; do not append an unrelated SEO image to a known gallery.
- Explain that an existing capture bookmark must have its URL replaced with freshly copied code after upgrading the app.
- Published after native Build44648246603 completed all seven jobs; nine installers and the checksum manifest were digest-verified before and after publication. Source3618cc0; local415/415 tests, focused23/23 and two isolated stress rounds pass. Existing releases remain available.
- Live Shopee DOM and bare-metal Kubuntu installer execution remain unverified. Installation is deferred at the operator's request while an existing job is active.

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
