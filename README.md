# MaiStudio

[![Validate MaiStudio](https://github.com/maiychrus25/Mai-Studio/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/maiychrus25/Mai-Studio/actions/workflows/build.yml)

Ứng dụng desktop sản xuất ảnh/video bằng TypeScript, Electron và FFmpeg cho macOS, Linux và Windows. Xây dựng từ thiết kế hành vi MuseStudio 1.13.12; không cần chạy EXE hoặc DLL/PYD Windows của sản phẩm gốc.

Đây là bản thử nghiệm **0.2.0-dev.4**, đã công khai ngày20/11/2026, sửa tiếp tục job sau một lượt review mới, thêm đánh giá lại các cảnh lỗi bằng media đã lưu và căn thời lượng/lời cho Affiliate. Có mẫu Affiliate thật trên Mac ARM64 với một số bước chỉnh dựng thủ công; chưa chứng nhận mọi provider/hệ điều hành hoặc full parity. Các bản sửa Shopee trước đó được giữ; sau nâng cấp từ bản lấy ảnh cũ cần thay URL dấu trang bằng mã lấy sản phẩm mới. Xem [tài liệu hệ thống](SYSTEM_DOCUMENTATION.md), [nghiệm thu](docs/reports/acceptance.md) và [giới hạn tương đương](docs/reports/parity.md).

Tải [bản 0.2.0-dev.4](https://github.com/maiychrus25/Mai-Studio/releases/tag/v0.2.0-dev.4): macOS Apple Silicon/Intel, Linux ARM64/x64 và Windows x64, kèm `SHA256SUMS.txt`. CI verify và đủ năm job đóng gói thành công; chín digest upload khớp manifest, bộ cài cũ vẫn được giữ nguyên. Kubuntu ARM64 dùng `mai-studio_0.2.0-dev.4_arm64.deb`. GitHub Packages dành cho registry npm/container, không chứa bộ cài desktop này.

## Phạm vi hiện tại

| Nhóm | Khả năng hiện có | Giới hạn kiểm chứng |
| --- | --- | --- |
| Dự án và thư viện | Lưu dự án, hàng đợi, hủy/thử lại, nhập/xem/xuất media | Cần ghi rõ OS và provider của từng lượt |
| Shopee | Nhập facts, biến thể và ảnh từ capture được cấp quyền hoặc API đã cấu hình | Đã nhập thật một sản phẩm; không cam kết mọi layout/API live |
| Affiliate | 11 kiểu nội dung, 3 chế độ host, review/sửa cảnh, caption/CTA và MP4/TXT | Có lượt Fashion/silent thật; chưa nghiệm thu mọi tổ hợp |
| Media và âm thanh | Ghép/cắt, phụ đề, nhạc, ducking, lồng tiếng từ audio và provider được cấu hình | Không cam kết nhép miệng hoặc quyền TTS/video của bên thứ ba |
| Film, Series, SRT | Engine, editor và kiểm thử cục bộ | Còn nghiệm thu chất lượng và so sánh live |

## Chạy local

Yêu cầu Node 24.15 trở lên, npm, Chrome/Chromium. FFmpeg đi kèm dependency; có ffprobe hệ thống thì đọc metadata đầy đủ hơn, không có sẽ dùng FFmpeg fallback.

```sh
git clone https://github.com/maiychrus25/Mai-Studio.git
cd Mai-Studio
npm ci
make build
npm start
```

App tự tạo dữ liệu tại Electron userData riêng. Khi kiểm thử, đặt MAISTUDIO_DATA_DIR tới một thư mục tạm mới, không trỏ vào dữ liệu đang sử dụng. Không đặt API key trong file repo.

## Luồng sử dụng

1. Tạo dự án, vào Tài khoản để thêm và mở profile Muse hoặc cấu hình image provider tương thích trong Cài đặt.
2. Nhập prompt/ảnh tham chiếu, lưu nháp và review, sau đó chạy. Mỗi profile chỉ có một lease; dùng Hủy/Tạm dừng khi cần.
3. Nhập ảnh/video local trong Thư viện để ghép hoặc tạo slideshow mà không cần dịch vụ AI.
4. SRT/Film/Series/Affiliate có editor shot/cast/script; chọn phân tích AI hoặc chia thủ công, rồi chạy từng bước hoặc toàn bộ. Bước render dùng media đã có; đổi nội dung có thể yêu cầu cập nhật plan hoặc tạo lại đúng bước. Lồng tiếng cần video nguồn, SRT và voice provider thực; chạy speech trước, render lại dùng speech cache và không gửi TTS thêm.
5. Market/Codex/voice/Shopee có cấu hình/đăng nhập riêng; thiếu quyền hoặc chưa cấu hình sẽ trả lỗi có lý do, không tạo kết quả giả.

Provider OpenAI-compatible dùng base URL bao gồm /v1. Model TTS/ASR/image/text phải đúng capability của endpoint anh sử dụng. Các provider là kết nối tùy chọn của app, không phải lời hứa về số dư, quyền dùng hoặc khả năng của bên thứ ba.

ASR tiếng Việt và speaker embedding có thể chạy CPU local sau khi chuẩn bị model trong Cài đặt. App tải và kiểm SHA bộ model công khai (~86,7 MB payload), không cần Python; weights nằm ngoài thư mục ứng dụng. Khi chạy toàn bộ/video, cảnh QC fail có thể được tự tạo lại trong giới hạn `qualityRetries` và phát sinh phí provider; kết quả unknown dừng để người dùng xem. Review-only/render không tự tạo lại media. Series recap là tùy chọn; nhạc recap liên tục, teaser/credit/continuity và căn khẩu hình vẫn cần hoàn thiện/nghiệm thu.

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

Hai vòng stress chạy provider fixture cục bộ, 1.000 task/vòng và Electron thật; không gọi dịch vụ tính phí. Mỗi vòng kiểm desktop/mobile, light/dark và mở lại không gửi trùng. macOS dùng mock keychain cho dữ liệu thử nghiệm, không chứng nhận Keychain thật. Linux không có display cần `xvfb-run -a` trước lệnh stress. Báo cáo/ảnh mặc định nằm trong thư mục tạm ngoài repo. Đặt MAISTUDIO_REPORT_DIR để chọn nơi giữ báo cáo.

Workflow [Build](https://github.com/maiychrus25/Mai-Studio/actions/workflows/build.yml) kiểm build/test/lint/docs khi push `main` hoặc mở pull request. Chạy thủ công từ Actions, bật `package_artifacts` để đóng gói macOS Intel/Apple Silicon, Linux x64/arm64 và Windows x64 song song với verify cho bản dev ra sớm. Chỉ công nhận toàn lượt Build đạt khi verify và các job đóng gói đều qua; artifact có thể xuất hiện trước khi verify kết thúc. Mỗi OS/architecture dùng runner native, không build chéo. macOS ký ad-hoc; Windows chưa ký chứng chỉ. Mục Artifacts của lần chạy chứa các bản cài và metadata/blockmap được tạo, chia theo nền tảng, giữ 14 ngày; không tải kèm thư mục app-unpacked. Khi chạy thủ công với package_artifacts=true và release_tag khớp version, workflow chỉ tạo draft Release sau verify và đủ năm job đóng gói; người thực hiện còn phải đối chiếu digest rồi công khai. Không tự deploy. CI được cấu hình không có nghĩa mọi nền tảng đã được nghiệm thu; xem kết quả chạy thực tế trong Actions. Phát hành macOS/update chính thức cần signing, public key và feed của anh.

macOS lần đầu có thể hỏi quyền truy cập Keychain; xử lý hộp thoại hệ điều hành để app tiếp tục. Bản dev ký ad-hoc chưa notarized. Linux AppImage cần executable permission và FUSE tương thích, hoặc cài DEB; cần Chrome/Chromium cho browser automation và thẻ chữ. Chi tiết coverage và tính năng chưa đủ parity nằm trong docs/reports/acceptance.md.

## Cấu trúc dự án

```text
electron/       Desktop lifecycle, preload, IPC và media protocol
src/core/       Workflow, queue, Store, provider/browser và media engine
src/shared/     Types và validation contract dùng chung
src/ui/         Giao diện React
services/       Service độc lập, gồm license hub
tests/          Unit/integration tests và fixture được kiểm soát
scripts/        Docs check và stress Electron
tools/          Container kiểm thử/đóng gói theo nền tảng
docs/specs/     Đặc tả và phạm vi được duyệt
docs/plans/     Kế hoạch triển khai
docs/reports/   Bằng chứng nghiệm thu và giới hạn parity
```

Hướng dẫn phát triển, commit, pull request và kiểm tra ở [CONTRIBUTING.md](CONTRIBUTING.md). Các thay đổi được ghi trong [CHANGELOG.md](CHANGELOG.md); quy tắc thiết kế ở [DESIGN.md](DESIGN.md). Package dùng `UNLICENSED`; repo công khai không đồng nghĩa cấp giấy phép mã nguồn mở.

## License Hub riêng

`services/studio-hub.ts` là authority riêng của MaiStudio, không chấp nhận/bypass key của MuseStudio. Sau build, chạy CLI bằng biến môi trường được ghi trong tài liệu module. Private key và admin token không được đưa vào bundle hoặc renderer. Chưa có deployment được cấp phép.

## Kế thừa

Tái sử dụng kinh nghiệm thiết kế bridge, hàng đợi/profile, đóng gói và công cụ check-docs từ MaiHub của anh; không sao chép CRM/ERP hoặc thêm các kênh chat vào app mới. SQLite dùng module Node chuẩn để tránh một dependency native theo ABI Electron. Lựa chọn và phạm vi nằm ở `docs/plans/2026-11-14-mai-studio.md`.
