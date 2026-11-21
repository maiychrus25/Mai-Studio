# Cập nhật trong app và phát hành theo phiên bản trên GitHub

Ngày: 21/11/2026
Trạng thái: Anh đồng ý hướng ngày 21/11/2026 ("ok": Mac báo + tải + mở bộ cài; Windows/Linux tự cài; được push `main` và phát hành `0.2.0-dev.5` khi xong).

## 1. Mục đích

Hiện muốn lên bản mới phải tự vào GitHub tải bộ cài. CI build trên `main` nhưng không tạo release, nên anh không thấy phiên bản nào mới. App hiển thị sai phiên bản (`src/core/studio.ts` ghi cứng `0.2.0-dev.1`) và nút "Kiểm tra cập nhật" luôn báo lỗi vì cần License Hub chưa triển khai.

Mục tiêu: mỗi lần phát hành có một release công khai trên GitHub ghi đúng phiên bản; app tự phát hiện bản mới, báo trên giao diện, tải về và cài.

## 2. Hành vi mong muốn

**Phát hành (CI)**
- Đẩy tag `v<version>` (ví dụ `v0.2.0-dev.5`) khớp `package.json` → CI chạy verify, đóng gói đủ năm nền tảng, rồi tạo release **công khai** (không phải nháp). Phiên bản có `-` (dev) là pre-release.
- Release gồm các bộ cài hiện có, `SHA256SUMS.txt` và các tệp mô tả cập nhật của electron-builder (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`, `latest-linux-arm64.yml`, `*.blockmap`). `latest-mac.yml` phải gộp cả arm64 lẫn x64 (hai job mac mỗi job sinh một tệp).
- Tên tệp bộ cài không có dấu cách, khớp đúng URL ghi trong `latest*.yml`.
- Lối chạy tay (`workflow_dispatch`) vẫn giữ để đóng gói thử.

**Trong app**
- Hiện đúng phiên bản đang chạy (`app.getVersion()`).
- Bản đóng gói tự kiểm tra cập nhật khi mở app; có nút kiểm tra lại trong Cài đặt → "Bản quyền & cập nhật". Bản dev (có `-`) nhận cả pre-release; bản chính thức chỉ nhận bản chính thức.
- Khi có bản mới: dải thông báo trên cùng app "Có bản MaiStudio X" kèm nút hành động, và trạng thái chi tiết trong Cài đặt (đang kiểm tra / có bản mới / đang tải N% / sẵn sàng cài / lỗi / đã mới nhất).
- **Windows (NSIS) và Linux AppImage:** bấm "Tải và cài" → tải nền có tiến độ → khi xong bấm "Khởi động lại để cài" → app thoát, cài lặng và mở lại.
- **macOS:** app chưa ký Developer ID nên không tự thay được. Bấm "Tải bản cài" → tải `.dmg` đúng kiến trúc, kiểm sha512 theo `latest-mac.yml`, rồi mở `.dmg` để anh kéo vào Applications. Dải thông báo nói rõ bước còn lại.
- **Linux .deb:** không tự cài được; nút mở trang release.
- Không cài khi đang có tác vụ chạy/xếp hàng: giữ luật `assertUpdateIdle` hiện có và báo rõ "Đợi tác vụ xong rồi cài".
- Không gửi gì ngoài yêu cầu tới GitHub (không token, không định danh người dùng).

## 3. Phạm vi

**Ngoài phạm vi**
- Ký mã Apple Developer ID / notarize, ký chứng chỉ Windows.
- Kênh cập nhật qua License Hub và manifest Ed25519 (`SignedUpdateGate`): giữ nguyên code và test, chỉ thôi bắt buộc cho đường cập nhật GitHub.
- Tự động cập nhật ngầm không hỏi.

**Điều phải tránh**
- Không cài bản tải về khi sha512 không khớp tệp `latest*.yml` (electron-updater tự kiểm cho Windows/AppImage; macOS phải tự kiểm).
- Không làm hỏng chạy app khi offline hoặc GitHub lỗi: lỗi chỉ hiện ở trạng thái cập nhật, không chặn app.
- Không kiểm tra cập nhật ở bản dev chạy từ mã nguồn (`!app.isPackaged`): báo "Chỉ bản cài mới cập nhật được".
- Không lộ secret, không thêm dependency mới (electron-updater 6.8.11 đã có).

## 4. Các cách đã cân nhắc

1. **electron-updater với provider GitHub cho Windows/AppImage, tự tải dmg cho macOS (đã chọn).** Dùng thư viện đã có, release GitHub công khai là nguồn duy nhất; macOS đi đường riêng vì Squirrel.Mac đòi app đã ký.
2. **Giữ kênh License Hub + manifest ký Ed25519.** An toàn hơn (khoá ký tách khỏi GitHub) nhưng Hub chưa triển khai, chặn toàn bộ tính năng. Để sau.
3. **Chỉ báo có bản mới và mở trang release.** Đơn giản nhất nhưng không đạt yêu cầu "kéo về rồi tự cài".

Đánh đổi của cách 1: ai có quyền ghi repo GitHub đều có thể phát hành bản cập nhật; tính toàn vẹn dựa vào sha512 trong `latest*.yml` của cùng release. Chấp nhận cho giai đoạn dev.

## 5. Ghi chú cho người làm

- Cấu hình `build.publish` GitHub (owner `maiychrus25`, repo `Mai-Studio`) để electron-builder nhúng `app-update.yml` vào bản đóng gói; vẫn đóng gói với `--publish never`, release do job của mình tạo.
- Đặt `artifactName` không dấu cách. Job release hiện kiểm danh sách tên tệp cố định và đổi dấu cách thành dấu chấm: cập nhật cho khớp tên mới.
- Bản 0.2.0-dev.4 trở về trước không có updater dùng được: người dùng cài tay 0.2.0-dev.5 một lần, từ đó trở đi cập nhật trong app.
- Tên hàm, cách tách module, chi tiết giao diện: người làm tự quyết, giữ đúng mục 2–3 và DESIGN.md.

## 6. Kiểm thử

- Test đơn vị: chọn tệp dmg đúng kiến trúc từ `latest-mac.yml`, kiểm sha512 (khớp/sai), `allowPrerelease` theo phiên bản, chặn cài khi có tác vụ, trạng thái cập nhật trong snapshot, phiên bản hiển thị đúng.
- Test hoặc script kiểm gộp `latest-mac.yml` hai kiến trúc.
- Đóng gói thử cục bộ macOS arm64 (`--publish never`): có `app-update.yml` trong Resources, tên tệp khớp URL trong `latest-mac.yml`.
- `make build`, `caffeinate -i -s make test`, `make lint`, `node scripts/check-docs.js`, hai vòng stress desktop/mobile có ảnh dải thông báo sáng/tối.
- Chạy thật toàn bộ chu trình chỉ kiểm được sau khi có hai release liên tiếp (dev.5 → dev.6); ghi rõ phần chưa kiểm.
