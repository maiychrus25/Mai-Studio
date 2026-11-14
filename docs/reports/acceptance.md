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
