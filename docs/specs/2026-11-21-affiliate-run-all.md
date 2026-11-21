# Video Aff: chạy toàn bộ luồng không dừng giữa chừng

Ngày: 21/11/2026
Trạng thái: Anh đồng ý hướng ngày 21/11/2026 ("ok trong lúc làm a sẽ test"); đã thực thi trên nhánh `feat/affiliate-run-all` ngày 21/11/2026, xem "Ghi chú sau thực thi".

## 1. Mục đích

Khách dùng Video Aff trên máy Windows bấm chạy toàn bộ luồng nhưng luồng dừng ở trạng thái "Cần thao tác", phải chạy tay từng bước. Khi tự bấm dựng thì gặp thông báo như "Lời thoại shot … vượt khoảng dựng; review và tạo lại clip trước khi xuất để không cắt mất lời" và không biết làm gì tiếp. Muse không dừng ở những chỗ này: nó giữ bản tốt nhất, gắn nhãn cảnh cần xem lại và vẫn dựng ra video.

Mục tiêu: với Video Aff, một lần bấm chạy toàn bộ luồng (`studio.run` với `stage: 'all'`) cho ra video cuối, kèm danh sách cảnh cần xem lại, trừ khi thật sự cần người dùng làm một việc cụ thể. Mỗi chỗ còn dừng phải nói rõ bấm gì.

## 2. Các chỗ đang dừng (đọc từ `src/core/studio.ts` trên `main` 6634c55)

| Chỗ | Thông báo hiện tại | Hướng xử lý |
|---|---|---|
| `reviewAndRepair`, hết lượt tạo lại mà còn fail (~1412) | "Kiểm tra chất lượng còn fail; đã giữ bản có đánh giá tốt nhất… Xem review trước khi dựng thủ công" | Giữ bản tốt nhất như hiện tại, ghi cảnh cần xem lại, đi tiếp sang dựng |
| `reviewAndRepair`, còn `unknown` (~1389) | "Review còn unknown hoặc thiếu bằng chứng…" | Không coi là đạt; ghi cảnh "chưa kiểm được", đi tiếp sang dựng |
| `planAffiliate`, kịch bản chưa đạt sau một lượt viết lại (~1137, ~1138) | "Kịch bản Affiliate chưa đạt sau một lượt sửa…" / "Chưa đủ bằng chứng…" | Dùng bản kịch bản hợp lệ mới nhất, ghi lý do review vào danh sách cần xem lại, đi tiếp |
| `planAffiliate`, kịch bản sai cấu hình sau một lượt sửa (~1130) | "Kịch bản Affiliate chưa đúng cấu hình sau một lượt sửa…" | Vẫn dừng (không có kịch bản dùng được), thông báo nói rõ bấm "Chạy lại" để AI viết lại |
| Dựng, lời tràn khoảng dựng — chỉ dự án kiểu cũ (~761) | "Lời thoại shot … vượt khoảng dựng…" | Không dừng: nối các cảnh theo lời nói thật như Video Aff v2 cho cả video đó (thời lượng thật có thể dài hơn mục tiêu), ghi cảnh dài hơn dự kiến |
| Dựng, câu bị cắt ở cuối clip gốc (~762) | "Lời thoại shot … bị cắt ở cuối clip…" | Khi chạy toàn bộ luồng và đã hết lượt tạo lại: dựng với clip đó, ghi cảnh "câu cuối bị cụt trong clip gốc". Khi bấm dựng tay: giữ dừng, nhưng thông báo nói rõ bấm "Tạo lại clip" cho cảnh đó |

## 3. Mục tiêu, ngoài phạm vi, điều phải tránh

**Mục tiêu**
- Chỉ áp cho dự án Video Aff (`project.kind === 'affiliate'` và có `data.affiliate`), cả dự án kiểu cũ lẫn v2.
- Chạy toàn bộ luồng có bật tự kiểm (`autoChecks`) ra video cuối trong các trường hợp ở bảng 2 (trừ dòng sai cấu hình).
- Kết thúc thành công, tin nhắn của tác vụ liệt kê cảnh cần xem lại kèm lý do ngắn tiếng Việt, ví dụ: "Đã xuất video Affiliate. 2 cảnh cần xem lại: cảnh 4 (chuyển động máy quay quá mức), cảnh 5 (thao tác chưa đúng mô tả)." Nếu không có cảnh nào thì giữ nguyên tin nhắn hiện tại.
- Danh sách cần xem lại được lưu trong dự án (`production.attention`, mảng `{ shot: string; reasons: string[] }`, ghi đè ở mỗi lần chạy) để giao diện đọc được sau này.
- Bước `videos` chạy riêng có tự kiểm cũng kết thúc thành công với danh sách cần xem lại thay vì dừng.

**Ngoài phạm vi (đợt sau)**
- Nút "Gửi lại" cho các chỗ "đối soát trước khi gửi lại" (yêu cầu có thể đã được Muse nhận, không được tự gửi lại). Hiện khách không có cách thoát ngoài xoá tác vụ; đợt sau sẽ thêm nút gửi lại có cảnh báo tốn phí.
- Hiển thị danh sách cần xem lại thành giao diện riêng; đợt này chỉ ở tin nhắn tác vụ.
- Phim, SRT, phim bộ, lồng tiếng độc lập.

**Điều phải tránh**
- Không bao giờ coi `unknown` là đạt: `qualityReviews` vẫn ghi đúng trạng thái `fail`/`unknown`.
- Không gửi lại job tính phí ngoài giới hạn tạo lại đã có (`qualityRetries`).
- Không cắt thêm chữ nào khi dựng: chỉ dựng clip như nó có.
- Dự án không phải Video Aff hành xử y như hiện tại.
- Bước dựng tay (`stage: 'render'`) của Video Aff kiểu cũ không còn dừng vì lời tràn khoảng dựng (dòng ~761), vì lý do dừng đó không giúp được gì khi khách không có cách sửa ngay.

## 4. Các cách đã cân nhắc

1. **Đổi các điểm dừng thành "ghi cảnh cần xem lại rồi đi tiếp" ngay tại chỗ (đã chọn).** Sửa ít, giữ nguyên giới hạn tạo lại và quy tắc không coi `unknown` là đạt.
2. **Thêm một tầng tự chạy lại toàn bộ luồng sau 2/10/30 phút như Muse.** Không giải quyết được trường hợp hết lượt tạo lại; tốn thêm hạn mức. Loại.
3. **Giữ điểm dừng, chỉ viết lại thông báo.** Đúng một nửa vấn đề; khách vẫn phải bấm tay từng bước. Loại.

## 5. Ghi chú cho người làm

- Dựng khi lời tràn ở dự án kiểu cũ: dùng lại đúng cách v2 đang làm (`affiliateSpeechWindow`, đặt các clip nối tiếp theo thời lượng thật, `measuredCuts`, phụ đề và caption đọc điểm cắt thật). Chỉ bật khi có ít nhất một cảnh tràn; video kiểu cũ không tràn dựng y như trước.
- Lý do ngắn trong danh sách cần xem lại lấy từ review đã có (lý do của tiêu chí `fail` đầu tiên, rút gọn ≤ 80 ký tự) hoặc từ câu cố định cho `unknown`, lời tràn, câu cụt và kịch bản chưa đạt.
- Đánh số cảnh theo thứ tự trong video (cảnh 1, 2, …), không dùng mã nội bộ như `e8cb6f1f…/shot1`.
- Tên hàm, cách tách hàm, chỗ lưu tạm trong checkpoint: người làm tự quyết, miễn giữ đúng mục 3.

## 6. Kiểm thử

- Chạy toàn bộ luồng Video Aff với review giả lập luôn `fail` → tác vụ `succeeded`, có video, tin nhắn liệt kê cảnh, `qualityReviews` vẫn ghi `fail`, số lần tạo lại đúng `qualityRetries`.
- Tương tự với review `unknown` → `succeeded`, cảnh ghi "chưa kiểm được", không cảnh nào bị ghi thành đạt.
- Kịch bản review `fail` sau lượt viết lại → đi tiếp với kịch bản mới nhất, cảnh báo kịch bản có trong tin nhắn; kịch bản sai cấu hình sau lượt sửa → vẫn `waiting_input` với thông báo mới.
- Dự án kiểu cũ có lời tràn: chạy toàn bộ luồng và bấm dựng tay đều ra video, không chữ nào bị cắt (cụm lời nằm trọn trong đoạn dựng).
- Dự án không phải Video Aff: các điểm dừng giữ nguyên (kiểm bằng test có sẵn, không sửa test cũ).
- `make build`, `caffeinate -i -s make test`, `make lint`, `node scripts/check-docs.js`, hai vòng stress.

## Ghi chú sau thực thi

- **Dựng tay dự án kiểu cũ có lời tràn (sửa 21/11/2026 theo quyết định của anh).** Lượt đầu giữ điểm dừng vì test có sẵn; anh quyết định bỏ điểm dừng và cho sửa test đó. Nay bấm "Dựng" cũng nối cảnh theo lời nói thật, ghi "dài hơn dự kiến". Trong test `v2 render places spoken clips by measured speech and stops on a cut-off line` chỉ hai assertion về dừng lời tràn kiểu cũ được đổi thành dựng thành công và có "cảnh 1 (dài hơn dự kiến)"; assertion câu cụt v2 giữ nguyên. Dựng một phần cảnh vẫn dừng (test `partial v2 render stops with a clear message instead of misplacing cuts` không đổi), lời bảo bỏ chọn cảnh.
- Chạy toàn bộ không bật `autoChecks` mà gặp lời tràn kiểu cũ: tạo xong mọi clip rồi chuyển sang lượt dựng, ở đó nối cảnh theo lời nói. Câu cụt và clip im lặng ở chạy toàn bộ không `autoChecks` vẫn dừng như dựng tay (không có lượt tạo lại nào đã dùng).
- Cửa sổ dựng kiểu cũ lấy từ đầu đoạn lời đầu tiên đến cuối đoạn lời cuối cùng (qua `affiliateSpeechWindow`), không chỉ cụm lời đầu như v2, để không cắt chữ nào. Nhịp nhanh (`pace: 'fast'`) không bật cho dự án kiểu cũ.
- Nếu kịch bản viết lại sai cấu hình nhưng bản trước hợp lệ (chỉ chưa đạt review), chạy toàn bộ dùng bản trước.
- Nút "Chạy lại" ở bảng 2 không có; tác vụ "Thử lại" dùng lại checkpoint nên sẽ ra cùng kết quả. Thông báo dùng nút thật "Phân tích kịch bản".
- `production.attention` có thêm mục `{ shot: 'kịch bản', reasons }` khi kịch bản chưa đạt; danh sách được xoá đầu mỗi lượt chạy toàn bộ, dựng hoặc `videos` có tự kiểm, và dựng tay cũng ghi danh sách.
- Clip im lặng (không có tiếng hoặc không đo được lời) ở chạy toàn bộ có `autoChecks` không dừng trước review: review lời đánh fail "không nghe rõ lời thoại", tạo lại trong `qualityRetries`, hết lượt thì dựng nguyên khe kế hoạch. Dự án không phải Video Aff giữ thông báo cũ.
- Video Aff lồng tiếng vẫn giữ điểm dừng review (mục dưới), nhưng lý do kịch bản chưa đạt nay luôn vào danh sách và tin nhắn khi dựng (phát hiện của review độc lập).
- Review chưa có provider lời nói (ASR) vẫn báo lời tràn là fail theo đo âm thanh; lý do đó (rút gọn) đứng trước "dài hơn dự kiến" trong cùng cảnh.
- **Video Aff lồng tiếng giữ điểm dừng review.** Test có sẵn `Affiliate dub speech review assesses the fitted current TTS clip, not the replaced native voice` yêu cầu chạy toàn bộ dự án lồng tiếng có review lời fail phải `waiting_input`; không sửa test cũ nên `reviewAndRepair` chỉ đổi hành vi cho Video Aff không lồng tiếng. Dự án lồng tiếng vẫn được ghi lý do kịch bản khi chạy toàn bộ không bật `autoChecks`.
