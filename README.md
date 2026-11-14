# MaiStudio

Ứng dụng desktop sản xuất ảnh/video bằng TypeScript, Electron và FFmpeg cho macOS, Linux và Windows. Xây dựng từ thiết kế hành vi MuseStudio 1.13.12; không cần chạy EXE hoặc DLL/PYD Windows của sản phẩm gốc.

Đây là bản phát triển. Mã tích hợp và kiểm thử local không đồng nghĩa tài khoản Muse/VoiceTube/Market/Shopee hoặc mọi hệ điều hành đã được nghiệm thu live. Xem `SYSTEM_DOCUMENTATION.md` và báo cáo trong docs/reports khi có.

## Chạy local

Yêu cầu Node 24.15 trở lên, npm, Chrome/Chromium. FFmpeg đi kèm dependency; có ffprobe hệ thống thì đọc metadata đầy đủ hơn, không có sẽ dùng FFmpeg fallback.

```sh
npm ci
make build
npm start
```

App tự tạo dữ liệu tại Electron userData riêng. Khi kiểm thử, đặt MAISTUDIO_DATA_DIR tới một thư mục tạm mới, không trỏ vào dữ liệu đang sử dụng. Không đặt API key trong file repo.

## Luồng sử dụng

1. Tạo dự án, vào Tài khoản để thêm và mở profile Muse hoặc cấu hình image provider tương thích trong Cài đặt.
2. Nhập prompt/ảnh tham chiếu, lưu nháp và review, sau đó chạy. Mỗi profile chỉ có một lease; dùng Hủy/Tạm dừng khi cần.
3. Nhập ảnh/video local trong Thư viện để ghép hoặc tạo slideshow mà không cần dịch vụ AI.
4. SRT/Film/Series/Affiliate có editor shot/cast/script; lưu kế hoạch trước khi chạy pipeline. Lồng tiếng cần video nguồn, SRT và voice provider thực.
5. Market/Codex/voice/Shopee có cấu hình/đăng nhập riêng; thiếu quyền hoặc chưa cấu hình sẽ trả lỗi có lý do, không tạo kết quả giả.

Provider OpenAI-compatible dùng base URL bao gồm /v1. Model TTS/ASR/image/text phải đúng capability của endpoint anh sử dụng. Các provider là kết nối tùy chọn của app, không phải lời hứa về số dư, quyền dùng hoặc khả năng của bên thứ ba.

## Kiểm tra và đóng gói

```sh
make build
make test
make lint
node scripts/check-docs.js
node scripts/stress.mjs 1
node scripts/stress.mjs 2
npm run package -- --mac dir --arm64
```

Hai vòng stress chạy provider fixture cục bộ, 1.000 task/vòng và Electron thật; không gọi dịch vụ tính phí. Báo cáo/ảnh mặc định nằm trong thư mục tạm ngoài repo. Đặt MAISTUDIO_REPORT_DIR để chọn nơi giữ báo cáo.

Workflow `.github/workflows/build.yml` chuẩn bị macOS Intel/Apple Silicon, Linux x64/arm64 và Windows x64. Workflow chưa được push/chạy hoặc phát hành. Build unsigned là artifact kiểm thử; phát hành macOS/update chính thức cần signing, public key và feed của anh.

macOS lần đầu có thể hỏi quyền truy cập Keychain; xử lý hộp thoại hệ điều hành để app tiếp tục. Bản dev ký ad-hoc chưa notarized. Linux AppImage cần executable permission và FUSE tương thích, hoặc cài DEB; cần Chrome/Chromium cho browser automation và thẻ chữ. Chi tiết coverage và tính năng chưa đủ parity nằm trong docs/reports/acceptance.md.

## License Hub riêng

`services/studio-hub.ts` là authority riêng của MaiStudio, không chấp nhận/bypass key của MuseStudio. Sau build, chạy CLI bằng biến môi trường được ghi trong tài liệu module. Private key và admin token không được đưa vào bundle hoặc renderer. Chưa có deployment được cấp phép.

## Kế thừa

Tái sử dụng kinh nghiệm thiết kế bridge, hàng đợi/profile, đóng gói và công cụ check-docs từ MaiHub của anh; không sao chép CRM/ERP hoặc thêm các kênh chat vào app mới. SQLite dùng module Node chuẩn để tránh một dependency native theo ABI Electron. Lựa chọn và phạm vi nằm ở `docs/plans/2026-11-14-mai-studio.md`.
