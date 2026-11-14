# MaiStudio — tài liệu hệ thống

Phiên bản ứng dụng được khảo sát: `0.1.0`.

Trạng thái: bản dev đã kiểm chứng local, đang nghiệm thu đóng gói; chưa phát hành, chưa chứng nhận full parity hoặc mọi nền tảng/provider. Anh đã duyệt thiết kế ngày 14/11/2026.

## Ranh giới và runtime

`electron/main.ts` sở hữu app lifecycle, file dialogs, custom media protocol và sender validation. `electron/preload.ts` chỉ công khai invoke/onChanged/pickFiles/pickFolder/mediaUrl. Renderer React trong `src/ui/` không có Node access; contextIsolation, sandbox và webSecurity bật, chặn navigation/window mới/quyền web không được cấp.

`src/core/studio.ts` điều phối commands; `src/core/store.ts` sở hữu SQLite; `src/core/queue.ts` sở hữu lease và AbortController; `src/core/browser.ts` điều khiển Chrome/Chromium; `src/core/media.ts` gọi FFmpeg/ffprobe bằng argv không qua shell; `src/core/pipelines.ts` validate shot/cast/episode. `src/core/cards.ts` vẽ thẻ chữ thành PNG bằng Chromium sandbox, chặn mạng/script và dùng textContent. `src/core/integrations.ts` kiểm contract HTTP, `src/core/codex.ts` chạy CLI sandbox có review, `src/core/updates.ts` kiểm artifact và `services/studio-hub.ts` quản lý license/config/update riêng.

Node 24.15+ có node:sqlite đã kiểm trong Electron 41.5.1 (Node 24.15.0) và host Node 24.22.1. Không dùng better-sqlite3. Lockfile là nguồn phiên bản chính xác; updater đã nâng từ 6.8.3 lên 6.8.11 sau khi npm audit phát hiện advisory rò header credential qua redirect.

## Dữ liệu

userData chứa studio.sqlite, assets/, profiles/, work/, output/ và kho ciphertext secrets.json khi OS keystore thực sự sẵn sàng. Các bảng projects/tasks/accounts/proxies/assets/settings lưu JSON đã validate; logs có giới hạn. Schema version 1, WAL, busy_timeout và secure_delete. Database version mới hơn bị từ chối thay vì sửa nhầm. Chưa có migration từ MuseStudio; không mở dữ liệu gốc của anh để ghi.

Asset path chỉ có ở main; UI nhận asset ID/mime/size/name. Import qua native dialog, kiểm file thường, từ chối symlink và kiểm magic bytes; chưa coi magic bytes là kiểm chứng mọi bit nội dung media. Renderer không được gửi raw source path vào media.import. Output ghi file tạm rồi publish; file lỗi/hủy không trở thành output thành công.

Mật khẩu/key dùng `src/core/vault.ts` và Electron safeStorage. Linux basic_text bị loại; không có keystore thì chỉ giữ RAM trong phiên, thông báo rõ. Snapshot chỉ có hasKey; không chứa token/cookie/API key. Provider URLs yêu cầu HTTPS, ngoại lệ loopback chính xác dành cho dev/self-host local; credentials không được nhúng URL. Cần xác nhận native khi đổi đường dẫn binary thực thi.

## Hàng đợi và giới hạn

- Task: draft, queued, running, waiting_input, paused, succeeded, failed, cancelled, interrupted.
- Một automation/profile tại một thời điểm, mặc định 2 generation và 1 media job; settings giới hạn 1–8 và 1–2.
- Running khi mở lại app trở thành interrupted; không tự gửi lại paid request có remote admission không rõ. Checkpoint chứa URL/thread/asset ID và bước pipeline để tiếp tục.
- Retry tự động chỉ dành cho lỗi được phân loại chắc chắn trước admission (hiện HTTP 429 của API ảnh), tối đa 2 lần với backoff; HTTP 5xx/timeout sau khi gửi giữ checkpoint để đối soát. Retry tay tạo budget mới nhưng không bỏ qua guard remote acceptance.
- Mỗi prompt tối đa 32 KiB UTF-8, batch sau nhân count tối đa 1.000, tối đa 16 ref/task; count 1–16 được tách thành task độc lập.
- Media import tối đa 2 GiB; output/provider download có trần riêng và không chạy shell interpolation.
- Pause toàn queue được lưu qua lần mở lại. Hủy một task đã thành công không đổi kết quả thành cancelled. Xóa account có task đang chờ/chạy bị từ chối trước khi đóng browser.
- Speech lồng trong film/dub cũng ghi remoteSubmitted trước POST; lỗi mất kết nối không được retry thành một lần tính phí thứ hai. Các pipeline dùng chung giới hạn mediaConcurrency, không vượt trần bằng job con.

<!-- docs-check: src/core/store.ts#MAX_BATCH = 1000 -->
<!-- docs-check: src/core/store.ts#MAX_PROMPT_BYTES = 32768 -->
<!-- docs-check: src/core/store.ts#MAX_ASSET_BYTES = 2147483648 -->

Media có trần 100 input, 1 giờ/clip, 6 giờ/timeline; 2 process tools tổng; probe 30 giây, render 15 phút. FFmpeg baseline CPU H.264/AAC. Cần regression riêng khi thay đổi giới hạn và runtime binary.

Cue SRT giữ start tuyệt đối, gồm khoảng trống đầu/giữa cue; video đệm đen và audio đệm im lặng, lượng tử hóa theo frame một lần để không cộng dồn sai số. Mỗi series tạo output riêng và film project sửa được cho từng tập. titleCard/endCard là chuỗi tùy chọn, mỗi thẻ 2 giây; narration/subtitle được dịch mốc khi có thẻ đầu. productOverlay dùng tên/giá/CTA đã nhập, có thể tắt; PNG overlay, nhạc nền và subtitle burn-in đi qua FFmpeg thật. Thẻ chữ cần Chrome/Chromium; text không vừa khung báo lỗi thay vì cắt chữ âm thầm.

voice.transcribe trả text và subtitle khi provider cung cấp segments thật; không suy timestamp từ số chữ. whisper-1/custom timestamp endpoint dùng verbose_json/segment; GPT ASR biết trước không hỗ trợ timestamp giữ JSON, không gửi thêm request fallback có phí. Dubbing sửa/dịch transcript theo block cue, kiểm số block bằng cue và giữ timecode; lệch số block báo lỗi khi lưu. Speaker/face/outfit matching tự động chưa được chứng nhận.

## Ma trận chức năng — trạng thái dev

| Nhóm | Mã hiện có | Điều kiện nghiệm thu còn lại |
|---|---|---|
| F01 Studio/projects | Project/task CRUD, batch/count, refs, filter/selection, run/cancel/retry; 2 vòng 1.000 task | live provider |
| F02 generation | Muse browser adapter, API ảnh/edit, thread/download/checkpoint | tài khoản Muse thật, video/image-to-video live và DOM thay đổi |
| F03 accounts/proxy | Persistent profiles, native browser, proxy configuration/test, isolation | Linux/Windows desktop, HTTP/SOCKS thật |
| F04 queue | SQLite lifecycle, bounded concurrency, cancel/restart checkpoint, pause bền, tải 1.000 task/vòng | hard-kill/power loss và disk pressure thực |
| F05 library | Import, preview, export/open/delete, asset provenance | UI/render codec theo OS |
| F06 hậu kỳ | Slideshow, merge, normalize, music/audio/subtitle/dub CPU | media dài và codec thực trên OS khác |
| F07 SRT/story | Parse/export cue, shot editor, voice/ASR/text endpoints | live narrator/ASR quality, giữ cue khi đổi giọng |
| F08 film | Shot/cast/scripts, image/video/speech checkpoints, title/end card, subtitle, nhạc | live multi-shot, quality/consistency review |
| F09 series | Episode editor/common cast, shot từng tập, output/film từng tập | continuity thực, recap/credit và đánh dấu thay cast cần dựng lại |
| F10 affiliate | Product facts/JSON/shot pipeline, signed Shopee query, product overlay/CTA | credential thật, batch import CSV/link scraping và claim review |
| F11 dub/voice | Transcript/SRT/source/voice UI và TTS/mix/dub pipeline | live VoiceTube/ASR; speaker auto-detection/quality không được suy ra từ tên module |
| F12 Market | Cookie session, catalog/library, master prompt/preview download, mở checkout nhà cung cấp | tài khoản có quyền, mua/tải thật và attachment delivery chưa hỗ trợ |
| F13 Codex | CLI capability detection, private job workspace, schema/log/cancel/approve | CLI installed compatible và thao tác thật có review |
| F14 license/update | Hub ký Ed25519, activate/trial/deactivate/revoke/config/update; signed artifact gate + Electron updater | feed/signing thực, update rollback, clock/revocation/offline window; chưa deploy |

## Tích hợp và quyền ngoài app

OpenAI-compatible clients dùng base URL chứa /v1 và model/key do người dùng cung cấp; có kiểm multipart/media/type/response bounds. Browser adapter dùng selectors cấu hình và session của đúng profile, không vượt CAPTCHA/MFA hoặc chặn dịch vụ. Muse default URL dựa trên artifact là https://muse.ai/; chưa xác nhận live nó cung cấp đúng behavior cho tài khoản của anh.

VoiceTube/Market/Shopee cần contract và entitlement của từng dịch vụ, không tự có vì sở hữu EXE. HTTP fixtures chỉ chứng minh request/response và lỗi đã test, không chứng nhận nhà cung cấp. Không chạy paid jobs khi chưa được cho phép. Không gửi cookie/license/admin token sang URL khác qua redirect.

License Hub API public: /activate, /trial, /validate, /deactivate; admin provisioning/revoke/config/update tách Bearer auth. Chỉ key provisioned mới kích hoạt. Token ký Ed25519, lease tối đa 24 giờ; kiểm kind/device/expiry tại app. Revocation tức thời cần validation online; offline signature check không biết trạng thái mới hơn lease. Dev mode hiển thị rõ là development, không phải bypass license app gốc.

Updater yêu cầu public key và feed, đọc signed manifest từ Hub; ràng buộc kind/update/version/platform/arch/feed/URL/size/SHA-256, đối chiếu metadata trước download và hash/size trước báo sẵn sàng rồi kiểm lại trước install. Không tải manifest dịch vụ thật hoặc chạy installer trong các kiểm thử hiện tại; tests dùng authority/HTTP/artifact do app kiểm soát. Market session được giữ trong main/vault, snapshot chỉ báo trạng thái; mua mở checkout ngoài app để vendor xử lý thanh toán/quyền.

Chuẩn bị cập nhật tạm dừng admission queue và khóa các command thay đổi dữ liệu/import native mới; vẫn cho đọc state/diagnostics. Mutation/import đang chờ I/O cũng ngăn cập nhật, gồm Codex đang nhận việc nhưng chưa có job record. Nếu chỉ đang tải hoặc bị lỗi thì phục hồi trạng thái pause ban đầu. Trước quitAndInstall có kiểm tra idle lần cuối sau hash verification, bao gồm Codex đang chạy; không coi khoảng chờ async là một lần kiểm idle còn hiệu lực.

## Build, test và release

`make build` chạy TypeScript + Vite rồi mới in Build succeeded. `make test` chạy node:test sau compile; `make lint` typecheck core/UI và diff whitespace, zero warnings. `scripts/check-docs.js` tái sử dụng từ MaiHub để kiểm version, docs-check constants và file paths.

`scripts/stress.mjs` chạy 1.000 task/vòng qua renderer bridge/Electron thật và provider local, đo concurrency/status/memory, screenshot desktop/mobile/light/dark và reopen persistence. Báo cáo ở thư mục tạm hoặc MAISTUDIO_REPORT_DIR; không ghi dữ liệu debug vào source repo.

`.github/workflows/build.yml` chuẩn bị runner macOS arm64/x64, Linux arm64/x64 và Windows x64. Chưa có quyền push/chạy workflow/publish, nên matrix cấu hình không đồng nghĩa artifacts trên OS khác đã chạy. Chỉ triển khai artifact build sẵn sau khi anh duyệt.

Hai Dockerfile trong tools/ tách kiểm thử lõi Linux khỏi đóng gói desktop. Verification image dùng FFmpeg hệ thống trong container; distribution image tải Electron/FFmpeg native của Linux. Package homepage là about:blank trong bản dev vì chưa có website công khai của sản phẩm, không trỏ tới domain tự nhận quyền sở hữu. Xem báo cáo nghiệm thu trong docs/reports/ để biết artifact và coverage thực.

## Ghi chú triển khai

- Template AGENTS và file-creation checklist không tồn tại tại các đường dẫn global được cung cấp; AGENTS mới chỉ ghi delta dự án.
- GitHub binary download lỗi DNS khi npm install. Local dùng lại Electron/FFmpeg đúng phiên bản đã có của MaiHub; dependency JavaScript và lockfile cài riêng. CI cài binary đúng runner bằng npm ci.
- Không thay đổi repo automation-marketing hoặc các bản MuseStudio gốc. Chưa deploy, migrate dữ liệu thật, push hoặc phát hành.
- Cập nhật trạng thái kiểm chứng bằng chứng thực sau mỗi vòng; không đổi cột chưa kiểm thành hoàn tất dựa vào source inspection.
- macOS bản ad-hoc có thể chờ hộp thoại OS Keychain; stack SecItemCopyMatching đã xác nhận khi thử cold start. Smoke tự động dùng --use-mock-keychain trong userData tạm với key fixture, không chứng nhận quyền keystore thật hay lưu secret qua lần mở lại. Không thay đổi ACL/keychain của anh.
