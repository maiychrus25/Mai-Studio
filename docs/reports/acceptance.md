# Nghiệm thu bản dev MaiStudio 0.1.0

Ngày kiểm: 14/11/2026. Phạm vi: repo riêng, dữ liệu tạm, dịch vụ HTTP fixture sở hữu bởi kiểm thử. Không ghi vào MuseStudio/MaiHub, không gọi job tính phí, không push/deploy/migrate/publish.

**Kết luận:** Có ứng dụng desktop và engine thực, chưa đạt M5/full parity. Trạng thái từng nhóm trong SYSTEM_DOCUMENTATION.md là nguồn đối chiếu; chưa chứng nhận provider live hoặc mọi OS chỉ từ một build.

```text
make build: Build succeeded
make test: 91 tests, 91 pass, 0 fail, 0 skipped
make lint: exit 0, không warning
node scripts/check-docs.js: docs-check: OK
Linux ARM64 core: 88 tests, 88 pass, 0 fail, 0 skipped
npm audit --omit=dev: found 0 vulnerabilities
```

## Bằng chứng hành vi

- SQLite thật giữ projects/tasks/refs/queue pause qua reopen; running trở thành interrupted. Test kiểm profile lease và không tự submit lại remote admission chưa rõ.
- Chrome thật với trang fixture: nhập prompt/ref, submit đúng một lần, checkpoint và tải PNG mới. Selector/URL Muse mặc định chưa được nghiệm thu bằng tài khoản thật.
- FFmpeg thật: probe/fallback, merge/normalize/audio/music/subtitle, slideshow, dub, Unicode/path có khoảng trắng, atomic publish, cancel. Pixel test xác nhận overlay PNG thực sự thay đổi frame. Timeline SRT có khoảng nghỉ và mốc phân số không bị dồn; film có thẻ đầu/cuối, series có output riêng từng tập.
- HTTP fixture kiểm image/edit/TTS/ASR/translate, VoiceTube, Market và chữ ký Shopee. TTS lỗi sau admission không submit trùng khi retry. ASR chỉ xuất timing khi provider trả segment thật.
- License Hub Ed25519 riêng kiểm activate/trial/device/revoke/config/update. Update gate kiểm signed manifest/OS/arch/version/feed/URL/hash/size. Codex dùng CLI fixture kiểm plan, approve, bounded jobs, redaction và cancel cây process.
- Renderer thật chạy Create & run, lưu tên/kịch bản từng tập và title/end card từ form; cả 12 màn hình qua navigation desktop/mobile và light/dark, không overflow ngang hoặc lỗi JS. Đã xem ảnh desktop tối và mobile sáng.

## Hai vòng stress Electron

| Vòng | Batch | Thành công | Lỗi cố ý 429 | Hủy | Đỉnh concurrency | Thời gian queue | RSS cuối |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1.000 | 980 | 0 | 20 | 2 | 6.608 ms | 226.492.416 bytes |
| 2 | 1.000 | 879 | 70 | 51 | 2 | 10.347 ms | 313.720.832 bytes |

Vòng 2 có hủy request đang chạy; số failed là phản hồi lỗi được fixture chủ động tiêm, retryLimit=0. Mỗi vòng kiểm 1440×900 và 390×844, light/dark, 4 screenshot; mở lại giữ đủ 1.000 task và không có request mới. RSS là mẫu cuối, chưa phải peak memory. Hard-kill/power loss, disk pressure/file lock thực không thuộc hai vòng tải này; các unit/integration cancellation/failure không thay thế kiểm thử đó.

## Nền tảng và artifact

- macOS Apple Silicon: build `.app` ký ad-hoc; mở gói app.asar thật, provider loopback cấp PNG và bundled FFmpeg dựng MP4 4,5 giây có title/end card, 0 renderer error. Smoke dùng `--use-mock-keychain` trong userData tạm. Cold start bình thường đã gặp chờ quyền OS Keychain, stack nằm ở SecItemCopyMatching; chưa chứng nhận native keychain persistence, Gatekeeper/notarization hoặc auto-update.
- Linux ARM64 Debian 12 container: 88 kiểm thử lõi qua, 0 skip; gồm media/process/cancel/SQLite/integrations và update admission khi có I/O đang chờ. Chạy tini để reaping descendant, không sửa test để bỏ qua zombie. Suite này chủ động không bao gồm 3 ca Chrome/cards.
- Linux ARM64 packaged runtime: mở binary app.asar thật dưới Xvfb bằng user UID 1000, fixture ảnh 1 request, FFmpeg bundled tạo MP4 1 giây/320×240/24 frame và decode exit 0. Preview Library readyState=4, không lỗi media/renderer; bốn ảnh desktop/mobile/light/dark không overflow. Raw file import và command giả bị từ chối. Container thiếu usable sandbox nên chỉ lượt QA cô lập dùng --no-sandbox; không chứng nhận sandbox desktop thông thường, title/end card Linux hoặc keystore thật. Không đổi permission/source/artifact để làm test qua.
- Linux ARM64 và x64: có AppImage/DEB, binary Electron/FFmpeg của Linux, không dùng binary macOS. x64 là cross-build trên ARM64, chưa chứng nhận runtime x64. Chưa thử launch AppImage qua FUSE hoặc cài DEB; Linux GUI smoke dùng thư mục unpacked cùng artifact.
- macOS Intel, Windows, Wayland và installer/update rollback: chưa chạy. CI matrix đã viết, chưa được push/chạy.

## Điều kiện còn thiếu để tương đương đầy đủ

1. Tài khoản/provider và quyền hợp lệ cho Muse image/video/image-to-video, VoiceTube/ASR/TTS, Market entitlement, Shopee và Codex thực; chưa có quyền gọi job tính phí. HTTP fixture chứng minh contract đã kiểm, không chứng minh dịch vụ live.
2. Nâng cao còn thiếu hoặc chưa đủ parity: quality review face/outfit/speech, automatic speaker matching, recap/credit và dirty-state khi thay cast series; CSV/batch product import và provenance khi lấy trang; Market attachment delivery; media dài/codec, fade/crop/covers và export audio riêng cần đối chiếu tiếp. Không được coi JSON editor hoặc tên module là bằng chứng đã hoàn tất các hành vi này.
3. Kiểm OS/architecture thực, native keystore, installer, signing/notarization, feed ký, cập nhật/rollback và disk pressure trước phát hành. Bản dev chưa có domain sản phẩm nên homepage metadata là about:blank.

## Tái sử dụng và phạm vi thay đổi

Dùng Node SQLite/crypto/fs/process thay dependency native và dùng React, Playwright, FFmpeg đã chốt phiên bản. Tái sử dụng checker tài liệu cùng pattern bridge/queue của MaiHub; không kéo CRM/ERP hoặc dựng framework plugin mới. Repo automation-marketing có thay đổi riêng của anh, không được sửa/revert. Các dependency mới đều phục vụ runtime desktop/build đã duyệt; updater nâng 6.8.11 theo audit, production audit 0 vulnerability tại lần kiểm này.

Mã ứng dụng giữ trên nhánh feat/studio-foundation; mọi artifact là dev, không phải bản phát hành production. Xem README để chạy/build và SYSTEM_DOCUMENTATION.md để đọc giới hạn/contract.

## Functional parity dev — snapshot bổ sung ngày 14/11/2026

**Trạng thái: đang tích hợp P1–P5, chưa full parity; vẫn version 0.1.0.** Các số 91/88 test, stress và packaged runtime ở trên là mốc bàn giao trước, không phải final report của source mới. Không đổi chúng thành kết quả suite mới. Parent sẽ bổ sung full-suite/build/lint, hai stress desktop/mobile/light/dark và artifact mới sau khi checkout ổn định; phần này không ghi final-suite pass.

### Hành vi đã có và bằng chứng theo phần

| Phần | Bằng chứng hiện có | Giới hạn của bằng chứng |
| --- | --- | --- |
| Source contracts | Báo cáo docs/reports/parity.md; frontend/bytecode đối chiếu; schema/call boundaries và native unknowns được tách riêng | Prompt/luật recipe đầy đủ nằm trên server gốc; static analysis không quan sát runtime |
| Story helpers | tests/story.test.ts: 7 test xanh tại handoff, giữ 21 oracle fixture cũ, thêm 74 alignment case và 2 digest cho 1.000 câu; replay pure functions có SHA/allowlist | Không import/chạy app gốc, EXE/provider/native; không suy thành full Windows parity |
| AI/director/stages | Local HTTP/Chrome tests cho new reply/ref/stream/admission; queued plan, per-turn director checkpoint, selected stages và cache/signatures; các ca summary rỗng đã được sửa/kiểm riêng | Prompt/schema MaiStudio tự viết; full integration snapshot đang thay đổi, chưa dùng số test cuối |
| Narration/source voice | Có WAV TTS 1.25/0.5 giây trong test service, cue .25–1.5 và 1.85–2.35, mixed tail 2.9; alignScript hỗ trợ số câu khác số ASR spans; source-service case đã được bổ sung | Kết quả integration cuối do parent chốt; chưa kiểm chất lượng/chi phí live VoiceTube |
| Native speech | offline-asr-qa/parts/stress/electron/prepare JSON ở scratch; chạy model thật trên host macOS ARM64 Node24.22.1 và Electron41.5.1/Node24.15, measured parts/256D embedding/cancel/silence/hash checks | Chưa chứng nhận app.asar/Windows/Linux native hoặc Python numeric/accuracy parity |
| Media/music | Test FFmpeg cho trim/crop/fade/ducking/Ken Burns/audio extraction/mix, phân cấp trên 100 input; Chrome audio fixture cho music/thread/resume, probe trước lưu | Chưa job nhạc tính phí; benchmark/artifact/codec đợt mới và OS khác còn mở |
| Series/products | CSV/JSON parser/bounds/provenance; service tests giữ kế hoạch/cache tập và stale shared cast; recap helper có test video thật | Recap chưa nối pipeline series; path-only tail chưa phải QA speech windows; Market attachment/link access chưa hoàn tất |
| QA | Vision gửi bytes frame/refs thật; speech acoustic/transcript/WeSpeaker cohort; kernel có replay vectors, 2×1.000 cohort stress theo agent handoff | Agent đang hoàn thiện review commit/stale/silent/cohort integration; không ghi pass đầy đủ hay accuracy từ việc có model |

Artifact bằng chứng tạm: `/private/tmp/mai-studio-parity/` (offline-asr-report.json, offline-asr-parts-qa.json, offline-asr-electron-qa.json, offline-asr-stress-qa.json, offline-asr-prepare-qa.json, story-align-handoff.json). Đây là kết quả từng lượt có phạm vi riêng; các full-suite lỗi trong lúc ghép code không được xóa hoặc đổi thành pass bằng kết quả focused test.

### Thay đổi runtime và bảo toàn kết quả

- Thêm native CPU dependency đã pin `sherpa-onnx-node@2.0.1`/platform package; weights Zipformer + WeSpeaker có tổng payload pin 86.715.403 bytes (~86.7 MB), kiểm SHA từng file, không commit weights, không cần Python của người dùng. Dung lượng staging/native/RAM không nằm trong con số download. Giới hạn local ASR 30 phút khác media timeline 6 giờ; chưa coi cùng weights là cùng thuật toán frontend/decoder accuracy.
- `studio.run` thêm plan/music/characters/images/videos/speech/check/render/all; thủ công vẫn là `studio.plan`. Force chỉ dành cho generated stages, không xóa unknown admission; completed checkpoint, explicit input và output còn hợp lệ được giữ. Đổi input/ref/style làm cache stale; retry cũ ưu tiên output production mới hợp lệ, không phục hồi snapshot cũ.
- Same project/series family có lease và kiểm unknown paid admission lồng nhau; render-only không gọi provider. Response cũ đã có được reuse; cần đối soát task cũ khi không biết remote đã nhận hay chưa. Chưa nghiệm thu UI reconciliation tổng quát; không có quyền paid live/prod chỉ vì anh sở hữu account.
- Series shared edits giữ nguyên media cũ và đánh dấu child stale. Auto quality gate ở all của AI film mới dừng trước render khi verdict fail/unknown; review/cohort agent đang kiểm integration. Không tự sửa prompt/tạo lại media để che verdict lỗi.

### Phần còn mở trước nghiệm thu đợt mới

1. Chốt ownership/review thay đổi director đồng thời, full integration nguồn mới, review/cohort/silence/stale commit, source-voice service và UI thực desktop/mobile/light/dark. Giữ nguyên director section của SYSTEM_DOCUMENTATION.md; không suy tác giả từ file untracked.
2. Wiring recap/teaser/credit, QA-selected recap windows, continuity/props/outfits và native speech/voice accuracy với dữ liệu thực. Schema/prompt gốc remote vẫn unknown, không gắn nhãn recipe recovered cho prompt mới.
3. Đối chiếu runtime Windows MuseStudio với port bằng account/VPS của anh khi có thông tin kết nối và phạm vi chạy được cho phép. Không đưa password vào chat; chưa phát paid job để kiểm, không gọi live ở lượt viết docs này.
4. Parent chốt final suite, regression, hai vòng stress mới và packaged/runtime native đúng OS/architecture. Không nâng version, ghi đè packaged build đang mở, push/publish/deploy, đổi production hoặc migrate dữ liệu thật trong lượt này.


## Checkpoint dev 0.2.0-dev.1 — kiểm chứng chức năng

Checkpoint này thay trạng thái chờ của các ghi chú đợt trước; không sửa lại số liệu 0.1.0. Source runtime/test được đóng băng theo SHA-256 `951d0fd7e334ffb1633e134bf6f7ec64fd5c9f0839de23d9e4eaa4d6aef784fa` trong `verification/source.json` của gói bàn giao. Base Git là `f041899`; không có binary/source của MuseStudio hoặc model weights trong Git.

```text
make build: Build succeeded
make test: 296 tests, 296 pass, 0 fail, 0 skipped
make lint: exit 0
node scripts/check-docs.js: docs-check: OK
Linux ARM64: make build/lint/docs-check + 296 tests, 296 pass, 0 fail, 0 skipped
```

Các regression đã kiểm bằng HTTP/Chrome/SQLite/FFmpeg thực: AI planning và director checkpoint nhiều lượt; malformed JSON giữ plan cũ; source/narration clock và phụ đề; selected stage, cache, force và unknown admission không submit trùng; cập nhật portrait mới không bị retry cũ ghi đè; project/series lease; product vision refs; QC stale/silence/cohort; series recap/QA windows/cache khi raw bị xóa; Dub speech cache, render/check không TTS, tempo giữ đuôi câu và legacy trim; queue cancel/reopen; library, proxy/account isolation, Codex, license và signed update admission. Kiểm thử fixtures không chứng nhận dịch vụ live.

Hai vòng tải trên Electron thật, cùng source đóng băng:

| Vòng | Task | Hoàn tất | 429 cố ý | Hủy | Requests | Peak concurrency | Queue ms | RSS mẫu cuối |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1.000 | 980 | 0 | 20 | 980 | 2 | 16.069 | 251.527.168 bytes |
| 2 | 1.000 | 874 | 75 | 51 | 950 | 2 | 10.713 | 259.522.560 bytes |

Mỗi vòng có bốn ảnh desktop 1440px/mobile 390px, sáng/tối; kiểm đủ màn hình điều hướng, primary Create & run, form episode, không tràn ngang/renderer error, reopen giữ 1.000 task và không phát request thêm. Đã xem ảnh mobile tối và desktop sáng của lượt cuối. Các lỗi 429 là fault injection có chủ đích; không gọi đó là 2.000 task thành công. RSS là mẫu cuối, không phải peak. Một lượt chụp chạy đồng thời nhiều Electron bị timeout 30s; giữ log chẩn đoán, chạy lại tuần tự không đổi source/test và hai vòng qua. Không chứng nhận power loss/disk pressure thực.

macOS ARM64: build `.app` 0.2.0-dev.1 ký ad-hoc, kiểm codesign và đối chiếu SHA compiled modules trong ASAR với dist. Gói thật chạy native Vietnamese ASR của sample công khai, trả cue 0,096–3,476s; dựng MP4 64×64/4,5s bằng bundled FFmpeg, title/end card, sidecar 2–2,5s; render-only không tăng từ một request tạo ảnh fixture. Player qua studio-media tải metadata, tua đến 3s; phản hồi ghi nhận 200, không chứng nhận byte-range 206. Bốn ảnh packaged desktop/mobile sáng/tối không tràn hoặc renderer error. Smoke dùng userData riêng và mock Keychain; không chứng nhận native Keychain/Gatekeeper/notarization/update. Bản mới đã mở bình thường trên máy anh sau khi kiểm idle và sao lưu SQLite riêng; giữ nguyên app 0.1.0 và không migrate schema. Model công khai đã kiểm hash được chuẩn bị trong userData, không nhúng trong archive app.

Linux ARM64: suite đầy đủ qua dưới Xvfb/UID 1000; cùng weights pin được kiểm trên Node 24.22.3 và Electron 41.5.1/Node 24.15.0, có text tiếng Việt, embedding 256 chiều norm ≈1 và dọn workdir. Sáu lỗi media do khác FFmpeg được sửa tại graph chung (output fps và sidechain block), không sửa test hoặc đổi FFmpeg pin. Container thiếu namespace sandbox nên chỉ QA dùng wrapper; source/default app không tắt sandbox.

Linux x64: binary Electron/FFmpeg/Sherpa đúng ELF x86-64 và native speech smoke đã chạy qua giả lập trên host ARM. Suite chọn 263 ca: 258 pass, 4 fail và 1 cancelled; 34 tên browser cases nằm trong danh sách loại trước chạy, chi tiết trong x64-test-coverage.json. Các bài media nặng chạm deadline 10/25/45 giây trong lượt giả lập, nên không ghi full x64 suite pass hoặc coi nguyên nhân hiệu năng là đã được chứng minh trên máy x64 thật. Không nới timeout hoặc xóa bài test để đổi kết quả.

Đã xuất AppImage và DEB 0.2.0-dev.1 cho cả ARM64/x64; Debian metadata dùng 0.2.0~dev.1. Đối chiếu 49 compiled files/ASAR, kiến trúc ELF của Electron/FFmpeg/Sherpa, SHA artifact và xác nhận không nhúng weights. Cả hai gói chạy packaged-native worker qua Electron, trả transcript tiếng Việt và embedding 256 chiều norm ≈1, dọn workdir. Gói x64 còn mở renderer thật dưới Xvfb/UID1000, nodeIntegration=false, không renderer error; sandbox=false chỉ trong QA container. X64 được đánh dấu dev-limited-runtime-smoke, giữ nguyên log suite đỏ. Không thử FUSE launch, cài DEB, Wayland hoặc update/rollback; packaged speech không thay thế chứng nhận installer hoặc mọi thao tác GUI.

ARM64 packaged GUI: giải nén chính AppImage sau khi kiểm SHA d4213fb254dc172224578fdc9fd8f33ec18a5f95929634e929954bd7f2c79923, mở renderer từ ASAR thật dưới Xvfb/UID1000. Bốn viewport 1440×900 và 390×844, sáng/tối đều không tràn ngang hoặc renderer error; nodeIntegration=false. Đây là kiểm payload AppImage bằng --appimage-extract, không chạy qua FUSE hoặc cài DEB. QA --no-sandbox chỉ áp dụng container, không được nhúng vào mặc định app.

Rà độc lập actual diff phát hiện ba lỗi admission/portrait/Dub; đã sửa bằng regression và reviewer chạy lại 3/3 repro qua. Bản sửa media sau review chỉ đặt fps output và chia block sidechain, giữ nguyên tests và dependency. Tái sử dụng queue/checkpoint/browser/FFmpeg/SQLite hiện có; dependency mới duy nhất là sherpa-onnx-node 2.0.1 cho native speech CPU. Không tạo framework hoặc service mới để thay luồng đang chạy.

Chưa nghiệm thu: runtime MuseStudio trên VPS Windows, provider/account/commerce live, prompt recipe remote, hai business native modules, accuracy giọng thật/khẩu hình, teaser/credit/continuity tự động, nhạc recap liên tục, macOS Intel, FUSE/DEB installation, Wayland và installer/update rollback. Không phát paid job, push/publish/deploy, thay production hoặc sửa repo automation-marketing. Chưa đủ bằng chứng tuyên bố toàn sản phẩm “tốt bằng” bản gốc.
