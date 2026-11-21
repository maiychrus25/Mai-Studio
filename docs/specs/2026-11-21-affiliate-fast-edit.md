# Video Aff: khâu dựng nhịp nhanh theo Muse

Ngày: 21/11/2026
Trạng thái: Đã được anh duyệt hướng ngày 21/11/2026 (quy trình spec → plan → giao việc → review, không duyệt lại tài liệu); chưa thực thi.
Nguồn bằng chứng: bản dịch ngược tĩnh MuseStudio 1.13.17 (`affstudio.fast_edit`, `affstudio.phrase_cues`, `affstudio._cut_ok`, `affstudio._best_cut`, `slideshow.render_slideshow.<locals>.build`) và giao diện Muse 1.13.18 trên VPS của anh, nơi Video Aff mặc định "Nhịp dựng: Nhanh kiểu TikTok — nói xong là chuyển, cắt khoảng lặng" và "Tốc độ nói 1,1× (khuyên dùng)".

## 1. Mục đích

Sau đợt Video Aff v2 (`docs/specs/2026-11-20-affiliate-muse-parity.md`), video chạy thật vẫn bị anh nhận xét là chậm. Muse dựng video bán hàng có lời bằng một khâu riêng: bỏ khoảng lặng giữa các cụm lời, đổi khung cận và thường ở mỗi chỗ cắt và sau mỗi khoảng 1,7 giây nói liền, tăng tốc toàn bộ 1,1 lần mà giữ cao độ giọng, phụ đề hiện từng cụm 2–6 chữ đúng lúc nói. MaiStudio chưa có khâu này. Mục tiêu là có đúng khâu đó.

## 2. Mục tiêu, ngoài phạm vi, điều phải tránh

**Mục tiêu**
- Dự án Video Aff v2 thuộc nhóm có lời (`review`, `story`, `problem`, `unbox`, `howto`, `top3`, `snack`) được dựng nhịp nhanh như Muse, mặc định bật.
- Có hai tuỳ chọn như Muse: nhịp dựng (nhanh / gọn) và tốc độ nói (1,0× / 1,1× / 1,2×).

**Ngoài phạm vi**
- `fashion`, `lookbook`, `asmr`, `pov`: Muse dùng các khâu dựng theo phách nhạc khác (`dance_edit`, `look_edit`, `montage_edit`); để sau.
- Dự án bật lồng tiếng (`affiliateDub`), dự án dựng kiểu trình chiếu ảnh (`renderMode: 'slideshow'`), dự án không phải v2.
- Chuẩn hoá âm lượng −14 LUFS, tiêu đề né khuôn mặt.

**Điều phải tránh**
- Dự án ngoài phạm vi trên phải dựng ra y như hiện tại.
- Không cắt mất chữ của lời thoại: chỉ cắt trong khoảng lặng giữa các cụm lời, mỗi bên chừa lại một đoạn đệm.
- Không gửi lại job tính phí: khâu này chỉ chạy ở bước dựng, trên clip đã có.

## 3. Cách Muse làm (đã quan sát)

Hằng số trong `affstudio`: `JUMP_GAP = 0.3`, `JUMP_KEEP = 0.08`, `PUNCH_EVERY = 1.7`, `POP_SEC = 0.4`, tốc độ `(1.0, 1.1, 1.2)` cho ba mức nhịp `fast`, `tight`, `full`. Docstring `fast_edit`:

> jump cut: bỏ khoảng lặng > JUMP_GAP giữa các cụm lời trong cùng câu (chừa JUMP_KEEP mỗi bên); tốc độ nói `speed` (1,1× = chuẩn video ngắn; tiếng giữ cao độ, khẩu hình vẫn khớp); "punch-in": mỗi chỗ jump cut đổi khung cận / thường, đoạn nói liền dài thì đổi khung mỗi ~PUNCH_EVERY giây (tiếng không ngắt) → hình đổi mỗi ~1,5–2 s như video ngắn; cảnh mở đầu "bật" hình (POP_SEC); phụ đề chia theo cụm lời (phrase_cues).

Trong mã còn thấy: mảnh ngắn hơn 0,12 giây sau khi chia tốc độ thì bỏ; đoạn nói liền còn lại không dài hơn 1,7 × 1,5 giây thì không chia nữa; cue phụ đề chồng nhau thì cue trước kết thúc ở `max(start + 0.2, start_sau − 0.02)`.

FFmpeg (`slideshow.render_slideshow.build`): tốc độ là `setpts=(PTS-STARTPTS)/speed` cho hình và `atempo=speed` cho tiếng; phóng cận là `crop=iw/z:ih/z:(iw-iw/z)/2:(ih-ih/z)*0.4` rồi `scale` về khung, với `z = punch_zoom = 1.1`, tức tâm ngang ở giữa và tâm dọc ở 40% chiều cao (chỗ mặt người).

Phụ đề (`phrase_cues`, docstring): chia chữ của câu theo các cụm lời (theo độ dài từng cụm), cụm dài thì chia tiếp, mỗi lần hiện 2–6 chữ đúng lúc đang nói; chỗ chia ưu tiên sau dấu câu, không xé từ ghép, không để "x", số hay hư từ đứng cuối mảnh. Chấm điểm chỗ ngắt trước chữ thứ k (`_cut_ok`, đọc từ bytecode):
- chữ trước kết thúc bằng `[,.;:!?…]` → 3;
- chữ trước (viết thường, bỏ ngoặc kép và ngoặc đơn) thuộc danh sách hư từ, hoặc là số `[\d.,]+`, hoặc chữ sau bắt đầu bằng `x` / `×` → 0;
- chữ trước thuộc danh sách âm tiết đầu từ ghép, hoặc chữ sau chỉ có 1 ký tự → 1;
- còn lại → 2.
`_best_cut` chọn trong các vị trí từ `max(lo, ideal − reach)` tới `min(hi, ideal + reach)` vị trí có điểm cao nhất, hoà thì gần `ideal` nhất.

Danh sách hư từ (`_WEAK_END`): `hay được để từ với × - của những là x rất có thì cho mà các một đến và không hoặc – khi`.
Danh sách âm tiết đầu từ ghép (`_VI_HEAD`): `gọn di bảo kích chất thiết sản giá thương cao chuyển hằng mỗi trẻ người công đặc nổi tiện thoải sang mềm sạch nhẹ bền chắc tinh tự hiện hoàn phù dễ thông khuyến chính đầy giao thanh dung cảm phong màu kiểu tay đeo xách da`.

Chưa quan sát được (do em tự quyết, ghi ở 5.4): cách `phrase_cues` chia chữ giữa các cụm lời và giá trị `reach`; hình dạng chính xác của hiệu ứng "bật" hình.

## 4. Các cách đã cân nhắc

1. **Cắt mỗi clip thành nhiều đoạn đầu vào cho `media.merge` (đã chọn).** Khâu dựng hiện ghép một danh sách đoạn có `trimStart`/`trimEnd`. Chỉ cần thêm cho mỗi đoạn hai thuộc tính "tốc độ" và "phóng cận", rồi một module thuần tính danh sách đoạn và phụ đề. Lớp FFmpeg đổi rất ít.
2. **Viết một lệnh FFmpeg riêng cho video nhịp nhanh.** Linh hoạt hơn nhưng lặp lại toàn bộ phần ghép, phụ đề, nhạc, khung kết đã có. Loại.
3. **Dựng như cũ rồi chạy thêm một lượt hậu kỳ cắt khoảng lặng trên video cuối.** Mất thông tin cụm lời theo từng clip và làm lệch lớp phủ chữ. Loại.

## 5. Thiết kế

### 5.1 Khi nào bật

Khâu nhịp nhanh chạy khi tất cả đúng: `affiliateV2(project)`; nhóm khuôn là `talk`; không lồng tiếng; `nativeAudio === true`; `renderMode !== 'slideshow'`; `settings.pace === 'fast'`. Ngoài các trường hợp đó, khâu dựng giữ nguyên.

### 5.2 Tuỳ chọn

Thêm vào `AffiliateSettings` (`src/shared/affiliate.ts`, đọc qua `readAffiliateSettings`):
- `pace: 'fast' | 'plain'`, mặc định `'fast'`. `'plain'` là hành vi v2 hiện tại.
- `speechSpeed: 1 | 1.1 | 1.2`, mặc định `1.1`. Chỉ có tác dụng khi `pace === 'fast'`.
Giá trị sai kiểu thì báo lỗi như các trường khác. Dự án cũ thiếu hai trường thì nhận mặc định, nhưng vì 5.1 đòi v2 nhóm có lời nên dự án cũ không bị ảnh hưởng.

Giao diện (`AffiliateWorkflow.tsx`): hai ô chọn cạnh "Thời lượng mục tiêu", chỉ hiện khi kiểu nội dung thuộc nhóm có lời và không bật lồng tiếng:
- "Nhịp dựng" / "Edit pace": `Nhanh kiểu TikTok — cắt khoảng lặng, đổi khung` / `Fast — cut silences, switch framing`; `Gọn — giữ nguyên clip` / `Plain — keep clips whole`.
- "Tốc độ nói" / "Speech speed": `1,0×`, `1,1× (khuyên dùng)`, `1,2×` / `1.0×`, `1.1× (recommended)`, `1.2×`.

### 5.3 Module thuần `src/core/affiliate-fast-edit.ts` (mới)

Không đọc file, không gọi FFmpeg. Đầu vào cho mỗi cảnh: thời lượng clip, các cụm lời đo được (`parts`, giây trên clip, như `analyzeSpeech` trả), cửa sổ dựng hiện có của cảnh (`start`, `duration` từ `clipWindow`), câu thoại (chữ gốc, giữ chữ số), và cảnh có lời hay không. Đầu ra:
- danh sách đoạn theo thứ tự: chỉ số cảnh, `trimStart`, `trimEnd` (giây trên clip nguồn), `punch` (có phóng cận không), `pop` (chỉ đoạn đầu tiên của video), thời lượng ra = `(trimEnd − trimStart) / speed`;
- điểm cắt giữa các cảnh trên dòng thời gian ra (để lớp phủ chữ và chớp sáng dùng, cùng dạng `measuredCuts` hiện có);
- cue phụ đề theo cụm.

Quy tắc, theo 3:
- Cảnh có lời: chỉ giữ các cụm lời nằm trong cửa sổ dựng của cảnh. Giữa hai cụm liên tiếp cách nhau hơn `0.3` giây thì cắt: đoạn trước kết thúc ở `cuối cụm trước + 0.08`, đoạn sau bắt đầu ở `đầu cụm sau − 0.08`. Hai đầu ngoài cùng của cảnh giữ đúng cửa sổ dựng hiện có (đệm `0.12` trước, `0.30` sau, từ `AFFILIATE_SPEECH_LEAD`/`HOLD`).
- Cảnh không lời: một mảnh duy nhất là cửa sổ dựng của cảnh.
- Mảnh có thời lượng ra dưới `0.12` giây thì bỏ, trừ khi đó là mảnh duy nhất của cảnh.
- Phóng cận: mỗi cảnh bắt đầu bằng khung thường; mỗi chỗ cắt đảo khung. Mảnh dài thì chia thêm mỗi `1.7` giây thời lượng ra và đảo khung, trừ khi phần còn lại không dài hơn `1.7 × 1.5` giây.
- "Bật" hình: chỉ đoạn đầu tiên của cả video.
- Tốc độ áp cho mọi đoạn của video, kể cả cảnh không lời.

Phụ đề:
- Mỗi cảnh có lời tách câu thoại thành chữ theo khoảng trắng; chữ được chia cho các cụm lời theo tỉ lệ thời lượng cụm (mỗi cụm có ít nhất 1 chữ, tổng đúng số chữ).
- Cụm nào hơn 6 chữ thì chia tiếp thành các mảnh không quá 6 chữ, chỗ chia chọn bằng cách chấm điểm ở 3 với `reach = 2`, mỗi mảnh ít nhất 2 chữ khi đủ chữ.
- Thời điểm của mỗi mảnh chia theo tỉ lệ số chữ trong khoảng của cụm, đã đổi sang dòng thời gian ra (sau khi cắt và chia tốc độ).
- Cue chồng nhau thì cue trước kết thúc ở `max(start + 0.2, start_sau − 0.02)`.
- Cue mang chữ gốc (có chữ số), không phải câu đã đọc số thành chữ.

### 5.4 Lựa chọn của em, chưa có bằng chứng từ Muse

- Chia chữ giữa các cụm lời theo tỉ lệ thời lượng; `reach = 2`.
- "Bật" hình: khung bắt đầu phóng `1.15` lần và trở về `1.0` tuyến tính trong `0.4` giây đầu, cùng tâm như phóng cận.
- Cảnh đầu tiên bắt đầu bằng khung thường (sau hiệu ứng bật hình).

### 5.5 Lớp media (`src/core/media.ts`, `MediaInput` trong `src/shared/studio.ts`)

Thêm vào `MediaInput` ba trường tuỳ chọn, chỉ cho đầu vào video (ảnh tĩnh thì báo lỗi):
- `speed?: number` trong `[0.5, 2]`: hình `setpts=(PTS-STARTPTS)/speed`, tiếng `atempo=speed`. Khi có `speed`, `duration` là thời lượng ra và phải khớp `(trimEnd − trimStart) / speed` trong sai số một khung hình.
- `punch?: boolean`: phóng cận `1.1` lần, tâm ngang giữa, tâm dọc 40%, rồi đưa về đúng khung ra.
- `pop?: boolean`: hiệu ứng bật hình ở 5.4.
Đầu vào không có ba trường này phải sinh đúng chuỗi lệnh FFmpeg như hiện tại.

### 5.6 Nối vào khâu dựng (`executePipeline`, `src/core/studio.ts`)

Khi 5.1 đúng, thay vì đẩy mỗi clip một đầu vào, đẩy các đoạn của module 5.3; `measuredCuts` lấy điểm cắt của module; phụ đề dùng cue theo cụm của module thay cho một cue mỗi câu. Lớp phủ chữ, chớp sáng chuyển cảnh, khung kết, nhạc nền và xuất file giữ nguyên cách hiện tại, chỉ đọc dòng thời gian mới. Kiểm câu cụt (`truncated`) giữ nguyên, chạy trên cửa sổ dựng trước khi chia đoạn.

## 6. Kiểm thử

- Module thuần: các ví dụ số cụ thể cho cắt khoảng lặng, ngưỡng 0,3 giây, đệm 0,08, bỏ mảnh dưới 0,12, chia mỗi 1,7 và quy tắc 1,7 × 1,5, đảo khung, bật hình chỉ ở đoạn đầu, tốc độ; phụ đề 2–6 chữ, không để hư từ hay số cuối mảnh khi có lựa chọn khác, ưu tiên sau dấu câu, quy tắc chồng cue.
- Media: một clip tổng hợp bằng FFmpeg với `speed: 1.1` cho video ra dài đúng `nguồn / 1.1`, còn tiếng; `punch` và `pop` render được và đúng kích thước khung; đầu vào không có trường mới cho lệnh y như trước.
- Khâu dựng: dự án v2 nhóm có lời nhịp nhanh có nhiều đoạn hơn số cảnh, tổng ngắn hơn bản `plain`, phụ đề theo cụm; `pace: 'plain'`, dự án cũ, `fashion`, dự án lồng tiếng thì dựng như trước.
- `make build`, `make test` (chạy với `caffeinate -i -s`), `make lint`, `node scripts/check-docs.js`, hai vòng stress desktop và mobile.

## 7. Tài liệu

`SYSTEM_DOCUMENTATION.md`, `CHANGELOG.md`, `docs/reports/parity.md` (phần nào theo Muse, phần nào em tự quyết ở 5.4).

## 8. Phần để người làm tự quyết

Tên hàm nội bộ, cách tách hàm, cách viết chuỗi lọc FFmpeg miễn đúng 5.5.

## 9. Rủi ro

- Bộ dò lời của MaiStudio (`analyzeSpeech`) dò theo tính tuần hoàn âm, thô hơn Muse; khoảng lặng ngắn có thể bị dò thành có lời hoặc ngược lại. Đệm 0,08 giây giảm rủi ro cắt chữ nhưng không loại hẳn.
- Video nhiều đoạn hơn làm khâu dựng chậm hơn vài giây.
