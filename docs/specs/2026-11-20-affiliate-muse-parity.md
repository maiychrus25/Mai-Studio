# Video Aff bám theo Muse: khuôn prompt, khung kịch bản và thời lượng theo lời nói

Ngày: 20/11/2026
Trạng thái: Đã được anh duyệt ngày 20/11/2026; đã thực thi trên nhánh `feat/affiliate-muse-parity` ngày 20/11/2026, chưa phát hành. Code khác thiết kế ở các điểm ghi trong "Ghi chú sau thực thi" cuối tài liệu.
Nguồn bằng chứng: cơ sở dữ liệu Muse 1.13.18 của anh (`~/Downloads/muse_studio.db`, ba dự án Video Aff hoàn chỉnh: lookbook/voiceover, fashion/presenter, review/presenter) và bản dịch ngược tĩnh Muse 1.13.17.

## 1. Mục đích

Video Aff của MaiStudio hiện chạy ổn nhưng nội dung cứng, nhịp chậm và cảm giác ít cảnh. Mục tiêu của dự án là làm theo Muse, nên luồng Video Aff sẽ dùng lại đúng cách Muse làm: khuôn prompt ảnh và clip lấy từ dữ liệu thật của Muse, khung kịch bản của Muse, và cách Muse tính thời lượng theo lời nói thật.

Anh đã quyết ngày 20/11/2026: dùng lại câu chữ prompt của Muse, và chấp nhận thời lượng video dao động quanh mục tiêu như Muse.

## 2. Mục tiêu, ngoài phạm vi, điều phải tránh

**Mục tiêu**
- Prompt ảnh và clip của Video Aff được ghép bằng khuôn cố định theo nguyên văn Muse, thay cho việc để AI tự viết trọn prompt.
- Kịch bản ra đúng dạng của Muse: mỗi cảnh một ý, một câu ngắn, có chỉ dẫn cảm xúc, nhịp có nhãn chức năng, xen kẽ cảnh sản phẩm và cảnh người dẫn.
- Cảnh có lời được cắt theo đoạn lời nói thật; tổng thời lượng thả nổi.

**Ngoài phạm vi (để giai đoạn sau)**
- Kiểu `asmr` và `pov`: chưa có dữ liệu Muse, giữ nguyên hành vi hiện tại.
- Khâu dựng nhịp nhanh của Muse (`fast_edit`): cắt khoảng lặng trong clip, đổi khung cận/thường mỗi 1,7 giây, tăng tốc 1,1 lần, phụ đề cụm 2–6 chữ.
- Chuẩn hoá âm lượng −14 LUFS; so mặt và so trang phục bằng mô hình; chọn bản tốt nhất trong nhiều lần tạo; hai mức "làm mềm" prompt khi bị từ chối; tiêu đề né khuôn mặt.
- Đổi số thành chữ trước khi đọc (Muse đọc "ba xăng-ti-mét"). Repo chưa có hàm đọc số tiếng Việt, nên để sau.
- Thời lượng theo lời nói khi bật lồng tiếng (`affiliateDub`).
- Thay đổi giao diện ngoài một nhãn chữ.

**Điều phải tránh**
- Không làm hỏng dự án Video Aff đã lưu: dự án cũ phải dựng ra y như trước.
- Không gửi lại job đã tính phí, không biến kết quả review `unknown` thành đạt (nguyên tắc hiện có của dự án).
- Không cắt mất chữ của lời thoại.

## 3. Ràng buộc

- Prompt viết kịch bản của Muse (`aff.script_turn`) không có trong cơ sở dữ liệu; Muse gõ nó vào chat và không lưu. Chỉ có *kết quả* của nó. Prompt kịch bản của MaiStudio vì vậy do mình viết, nhắm tới đúng dạng dữ liệu của Muse.
- Chỉ có dữ liệu cho 3 trong 11 kiểu. Mọi chỗ suy rộng ra kiểu khác đều được đánh dấu "suy rộng" trong tài liệu này.
- `parsePlan` (`src/core/planning.ts`) và `buildShots` (`src/core/pipelines.ts`) chỉ giữ các trường đã biết của một cảnh, và bắt buộc có `prompt`. Thiết kế dùng lại các trường đó và chỉ thêm đúng một trường tuỳ chọn vào cảnh: `productVisible` (5.2).
- Dự án lookbook mẫu của Muse không có ảnh sản phẩm, nên khuôn lookbook quan sát được là bản "không ảnh" (xem 5.4).
- Mỗi yêu cầu lập kế hoạch tối đa 32.768 byte.
- Có một phiên khác đang làm việc trên repo; việc này làm trong worktree riêng, nhánh `feat/affiliate-muse-parity`.

## 4. Các cách đã cân nhắc

1. **Chuyển hẳn sang mô hình của Muse (đã chọn).** Bước kế hoạch chỉ sinh trường ngắn; một module khuôn mẫu ghép prompt; thời lượng theo lời nói. Giải quyết cả ba triệu chứng. Dự án đã lưu vẫn chạy theo đường cũ nhờ một dấu phiên bản.
2. **Giữ kế hoạch cũ, chỉ đổi câu chữ prompt cuối và nới thời lượng.** Ít việc hơn nhưng AI vẫn tự viết trọn prompt, nên kịch bản vẫn cứng. Loại.
3. **Làm đủ cả so mặt, so trang phục, chọn bản tốt nhất, dựng nhịp nhanh.** Giống Muse nhất nhưng lớn gấp nhiều lần và khó kiểm từng bước. Tách thành giai đoạn sau.

## 5. Thiết kế

### 5.1 Dấu phiên bản và tương thích

`finishAffiliatePlan` ghi `affiliatePlanVersion: 2` vào `project.data` khi kế hoạch được lập theo khung mới. Mọi hành vi mới chỉ bật khi có dấu này:

| | Không có dấu (dự án cũ, `asmr`, `pov`) | `affiliatePlanVersion: 2` |
|---|---|---|
| Prompt kế hoạch | như hiện tại | khung mới (5.3) |
| Prompt ảnh, clip | ghép chung như hiện tại | khuôn Muse (5.4) |
| Cắt clip có lời | đúng thời lượng kế hoạch, lời tràn thì dừng | theo lời nói thật (5.5) |

Kiểu dùng khung mới: `review`, `story`, `problem`, `unbox`, `howto`, `top3`, `snack` (nhóm "có lời", dùng khuôn của `review`; sáu kiểu sau là suy rộng), `fashion`, `lookbook`.

Tín hiệu bật v2:
- Lập kế hoạch mới (kể cả lập lại cho dự án cũ): theo kiểu ở trên. Lập lại kế hoạch cho một dự án cũ nghĩa là nâng nó lên v2.
- Kiểm lại một kế hoạch đã có (đường `reviewOnly` sau khi anh sửa tay): theo dấu đã lưu trong `project.data`, không theo kiểu. Dự án cũ đã sửa tay vẫn được kiểm theo luật cũ.
- `productLook`, `outfitLooks`, `narratorVoice` được mang theo từ `project.data` khi kiểm lại, vì JSON dựng lại ở đường đó không có chúng.

### 5.2 Ánh xạ dữ liệu Muse vào trường sẵn có

Một trường tuỳ chọn mới ở cảnh: `productVisible` (boolean, mặc định `true`), được thêm vào danh sách trường mà `parsePlan` và `buildShots` giữ lại. Bốn trường mới ở cấp dự án: `affiliatePlanVersion`, `productLook`, `outfitLooks`, `narratorVoice`.

| Muse | MaiStudio |
|---|---|
| `shot.scene` (câu mô tả khung hình, khoảng 200 ký tự) | `shot.prompt` |
| `shot.motion` (một câu chuyển động) | `shot.action` |
| `lines[].text` | `shot.dialogue` |
| `lines[].emotion` (ba từ) | `shot.acting` |
| `shot.kind` = `product` / `presenter` | `shot.shotType` = `insert` / `single` |
| `shot.caption` (3–5 từ) | `shot.caption` |
| nhãn nhịp `hook, problem, intro, benefit, demo, proof, offer, cta` | `shot.beat` (nhóm có lời và `fashion`) |
| `shot.move` = `hanger, wear, detail, final` | `shot.beat` (riêng `lookbook`) |
| `bible.locations[].look` | `scenes[].location` |
| `bible.characters[0].look` / `.voice` | `characters[0].description` / `.voiceProfile` |
| `bible.product_look` | `project.data.productLook` (mới) |
| `shot.product` (sản phẩm có trong khung không) | `shot.productVisible` (mới) |
| `bible.looks[]` = `{name, look}` theo từng bộ đồ | `project.data.outfitLooks[]` = `{name, description}`, cùng thứ tự với `outfitAssetIds` (mới, chỉ `lookbook`) |
| `bible.narrator_voice` | `project.data.narratorVoice` (mới; dùng khi không có người dẫn) |
| `bible.music` | `musicPrompt` |

### 5.3 Prompt kế hoạch mới

`affiliatePlanningPrompt` có nhánh mới cho các kiểu ở 5.1. Vẫn trả về JSON theo khung hiện có (để `parsePlan` đọc được), nhưng yêu cầu nội dung theo dạng Muse:

- Mỗi cảnh đúng một ý về sản phẩm. Nhóm có lời: mỗi cảnh một câu nói 8–12 chữ. `fashion` và `lookbook`: chỉ cảnh đầu và cảnh cuối có lời; các cảnh giữa không lời nhưng mỗi cảnh một `caption` 3–5 từ nêu một điểm bán hàng khác nhau và một động tác khác nhau.
- `beat` phải thuộc bảng nhãn ở 5.2. Trình tự mẫu cho nhóm có lời: hook → intro → (benefit, demo) lặp lại → proof → offer → cta. Nhịp proof và offer chỉ dùng số liệu có trong nguồn sản phẩm (điểm đánh giá, số lượt, màu, cỡ, giá).
- `shotType` xen kẽ `insert` (cận sản phẩm, không thấy mặt) và `single` (người dẫn nói trước ống kính). Chế độ không có người dẫn: toàn bộ là `insert`.
- `prompt` viết theo mẫu câu của Muse: `<khổ hình> <cỡ khung> in <địa điểm>, subject in upper-middle, bottom quarter calm and uncluttered; <ai/cái gì, tư thế ở khung đầu>`. Cảnh người dẫn có lời thêm `face and mouth clearly visible, mouth closed about to speak`; cảnh sản phẩm thêm `face out of frame`.
- `action` là một câu, một hoặc hai động tác đơn giản. `acting` là ba từ chỉ cảm xúc khi đọc câu đó.
- Đúng một địa điểm cho cả video (`lookbook`: hai địa điểm, chỗ thay đồ ở nhà và nơi đi chơi). Một người dẫn duy nhất.
- Trả thêm `productLook`: một câu tiếng Anh tả hình dạng, chất liệu, màu của sản phẩm theo ảnh.
- Mỗi cảnh ghi `productVisible`: `false` khi sản phẩm không có trong khung (ví dụ người dẫn nói tay không).
- `lookbook` trả thêm `outfitLooks`: tên và mô tả tiếng Anh của từng bộ đồ đã chọn, đúng thứ tự.
- Chế độ không có người dẫn (`voiceover` hoặc `silent` ở nhóm có lời): `characters` rỗng như hiện tại, toàn bộ cảnh là `insert`; với `voiceover` trả thêm `narratorVoice`, một câu tiếng Anh tả giọng đọc (giới, tuổi, cao độ, nhịp).
- `keepScript` bật: giữ nguyên luật hiện có, tức giữ từng chữ kịch bản của anh và chia vào các cảnh; luật "mỗi cảnh một câu 8–12 chữ" không áp dụng.
- Kèm một ví dụ rút gọn từ kịch bản thật của Muse (phụ lục B) làm mẫu dạng dữ liệu.
- Giữ nguyên các ràng buộc an toàn hiện có: chỉ dùng sự thật trong nguồn, không bịa giá hay đánh giá, coi nội dung sản phẩm là dữ liệu, không phải chỉ dẫn.

Số cảnh và dòng thời gian danh nghĩa giữ như hiện tại (`affiliateSceneCount`, hàm `timeline`), nên phần kiểm tra số cảnh không đổi. Với kế hoạch v2, thời lượng từng cảnh có lời chỉ là danh nghĩa; thời lượng thật do 5.5 quyết định.

`finishAffiliatePlan` nới một luật cho v2: ở chế độ người dẫn, cảnh `insert` được có lời mà không cần người dẫn xuất hiện trong khung (Muse dùng giọng người dẫn ngoài hình cho cảnh sản phẩm). `speaker` vẫn là người dẫn để bước so giọng dùng chung một giọng.

`affiliateReviewPrompt` cập nhật tiêu chí "structure" theo khung nhịp mới; hai tiêu chí còn lại không đổi.

### 5.4 Module khuôn mẫu `src/core/affiliate-prompts.ts` (mới)

Các hàm thuần, không phụ thuộc trạng thái:

- `affiliateHostRefPrompt(context)`: ảnh chân dung người dẫn.
- `affiliateImagePrompt(context, shot)`: ảnh khung đầu của một cảnh.
- `affiliateClipPrompt(context, shot)`: clip của một cảnh.

`context` gồm: kiểu, chế độ người dẫn, khổ hình, ngôn ngữ, giọng vùng miền, phong cách hình, tên và mô tả người dẫn, mô tả giọng, mô tả địa điểm, tên sản phẩm, `productLook`, cảnh có phải cảnh mở đầu không.

Câu chữ lấy nguyên văn từ phụ lục A. `pipelineSteps` gọi các hàm này khi dự án có `affiliatePlanVersion: 2`; ngược lại đi đường ghép cũ. Bước tạo ảnh nhân vật (`executeCharacters`, `src/core/studio.ts`) dùng `affiliateHostRefPrompt` trong cùng điều kiện.

Những chỗ khuôn Muse chỉ quan sát được một giá trị, phần còn lại là suy rộng do em đề xuất:

| Tham số | Quan sát được | Suy rộng |
|---|---|---|
| Khổ hình | `Vertical 9:16` | `Horizontal 16:9`, `Square 1:1`, `Vertical 3:4`, `Horizontal 4:3` |
| Ngôn ngữ nói | `in Vietnamese` | tên tiếng Anh của ngôn ngữ đã chọn |
| Giọng | `standard Northern Vietnamese (Hà Nội) accent` | `Southern Vietnamese (Sài Gòn)`, `Central Vietnamese (Huế)`; ngôn ngữ khác thì bỏ cụm giọng vùng |
| Chế độ `silent` của nhóm có lời | không có mẫu | dùng khối "Nobody speaks" của cảnh sản phẩm `fashion` |
| `voiceover` không có người dẫn | không có mẫu | dòng giọng: `VOICE LOCK — <giọng vùng>. Voice: the same off-screen narrator voice (narrator_v1): {narratorVoice}. The same voice in every clip of this video.` |
| `lookbook` có ảnh bộ đồ | chỉ có mẫu không ảnh | thay câu `Show it realistically, with no invented text or logo.` bằng câu khoá trang phục của `fashion`: `it must look EXACTLY like the garment(s) in the attached product photo(s): same cut, length, fit, neckline, colors, fabric texture, pattern and details.` |
| Ảnh bối cảnh anh tải lên (`backgroundAssetId`) | Muse có tính năng này nhưng không có mẫu câu | giữ dòng hướng dẫn hiện có của MaiStudio, nối vào cuối prompt |
| Tư thế (`pose` khác `auto`) | không có mẫu | giữ dòng hiện có của MaiStudio, nối vào cuối prompt |

Chuyển động máy quay (lựa chọn của em, dựa trên phân bố quan sát được, vì luật chọn nằm trên server của Muse):
- Người dẫn nói, người mẫu nhảy, cảnh `wear`: máy cố định (`LOCKED-OFF`).
- Cảnh sản phẩm: luân phiên lượn 30 độ và đẩy nhẹ 10% theo thứ tự cảnh.
- `hanger`, `final`: đẩy nhẹ 10%. `detail`: lượn 30 độ.

Ảnh tham chiếu gửi kèm, theo đúng những gì Muse đã gửi trong ba dự án:

| Loại cảnh | Ảnh gửi kèm, theo thứ tự |
|---|---|
| Người dẫn, có sản phẩm | 2 ảnh sản phẩm đầu, rồi ảnh người dẫn |
| Người dẫn, `productVisible: false` | chỉ ảnh người dẫn |
| Chỉ sản phẩm | 3 ảnh sản phẩm đầu |
| Ảnh chân dung người dẫn | không kèm ảnh nào (hiện MaiStudio kèm ảnh bộ đồ 1; v2 bỏ) |
| `lookbook` | ảnh của đúng bộ đồ trong cảnh, rồi ảnh người dẫn (suy rộng từ mã Muse; mẫu thật không có ảnh) |

Ảnh bối cảnh anh tải lên, nếu có, xếp sau cùng. Clip chỉ kèm ảnh khung đầu, như hiện tại.

### 5.5 Thời lượng theo lời nói (chỉ với v2)

- Khuôn clip yêu cầu clip 10 giây và đặt lời nói ở đầu clip theo đúng số của Muse: 0,5–5 giây (nhóm có lời), 0,5–4 giây (`fashion`), 0,5–3 giây (`lookbook`).
- `clipWindow` (`src/core/studio.ts`): với v2 và cảnh có lời, cửa sổ dựng bắt đầu trước tiếng đầu tiên 0,12 giây và kết thúc sau tiếng cuối cùng 0,30 giây, kẹp trong độ dài clip. Không còn khái niệm "lời tràn". Hai con số này là lựa chọn của em (Muse giữ 0,08 giây quanh chỗ cắt, nhưng bộ dò lời của MaiStudio thô hơn) và sẽ chỉnh sau lần chạy thật đầu tiên.
- "Đoạn lời nói" là cụm tiếng liền nhau đầu tiên: các đoạn có tiếng cách nhau không quá 1,0 giây. Tiếng động xuất hiện sau một khoảng lặng dài hơn 1,0 giây bị bỏ qua. Lý do: bộ dò của MaiStudio (`analyzeSpeech`) dò theo tính tuần hoàn của âm chứ không nhận dạng chữ, nên một tiếng động muộn có thể kéo cảnh dài ra gần 10 giây. Khuôn clip đã dặn "5–10 s: stops talking".
- Khi dựng, các cảnh v2 nối tiếp nhau theo thời lượng thật, không dùng `start` của kế hoạch.
- Mọi thứ bám theo dòng thời gian cũng chuyển sang điểm cắt thật với v2: chữ trên hình, điểm chớp sáng chuyển cảnh (`affiliateCaptionCues` và phần liên quan trong `src/core/affiliate-edit.ts`, phần dựng trong `executePipeline`). Giới hạn "không vượt tổng thời lượng kế hoạch" trong `affiliateCaptionCues` đổi thành "không vượt tổng thời lượng thật".
- Bật lồng tiếng (`affiliateDub`): giữ nguyên như hiện tại, tức clip cắt theo thời lượng kế hoạch và giọng đọc được ép vừa khe. Thời lượng theo lời nói chỉ áp cho đường dùng tiếng gốc của clip.
- Cảnh không lời giữ thời lượng kế hoạch. Với `fashion` và `lookbook`, cảnh có lời dài bằng giá trị lớn hơn giữa thời lượng kế hoạch và đoạn lời nói thật, để không cắt chữ; các cảnh sau lùi theo.
- Bỏ hai chỗ chặn "lời vượt khoảng dựng" cho v2 (`executePipeline` và `executeReview`). Thay bằng một phép kiểm lời bị cụt: nếu đoạn lời nói (theo định nghĩa trên) kết thúc trong 0,15 giây cuối của clip thì coi như câu bị cắt và review trượt với lý do đó.
- Nhãn giao diện "Thời lượng mục tiêu" giữ nguyên chữ; thêm chú thích rằng video có lời có thể dài hoặc ngắn hơn mục tiêu.

Hệ quả cần biết: với Muse, mục tiêu 60 giây cho ra 39,6 giây (lookbook), 52,2 giây (fashion) và 82,3 giây (review 16 cảnh đều có lời). MaiStudio v2 sẽ cho kết quả cùng kiểu.

## 6. Kiểm thử

- Kiểm thử đơn vị cho module khuôn mẫu: với dữ liệu đầu vào dựng lại từ ba dự án Muse, prompt sinh ra phải trùng từng dòng với prompt thật của Muse (lấy vài cảnh mỗi kiểu làm fixture; fixture chứa prompt Muse nằm trong `tests/fixtures/`).
- Kiểm thử `finishAffiliatePlan`: kế hoạch v2 hợp lệ được gắn dấu; cảnh `insert` có lời ở chế độ người dẫn được chấp nhận; kiểu `asmr`/`pov` không được gắn dấu.
- Kiểm thử `clipWindow`: v2 cắt theo lời; không có dấu thì kết quả y như hiện tại.
- Kiểm thử hồi quy: toàn bộ kiểm thử Video Aff hiện có phải giữ nguyên và vẫn đạt, vì chúng mô tả đường cũ.
- `make build`, `make test`, `make lint`, `node scripts/check-docs.js`, hai vòng stress desktop và mobile theo quy định của repo.
- Chạy thật trên Muse (tốn hạn mức tài khoản) chỉ làm khi anh cho phép riêng.

## 7. Tài liệu

Cập nhật `SYSTEM_DOCUMENTATION.md` (hành vi Video Aff v2), `CHANGELOG.md`, và `docs/reports/parity.md` (ghi rõ phần nào là nguyên văn Muse, phần nào suy rộng). Bản thiết kế này vào `docs/specs/`.

## 8. Phần để người làm tự quyết

- Tách hàm trong module khuôn mẫu thế nào, đặt tên nội bộ.
- Câu chữ cụ thể của prompt kế hoạch mới, miễn đủ các yêu cầu ở 5.3 và trong giới hạn 32.768 byte.
- Chọn cảnh nào của Muse làm fixture.

## 9. Rủi ro

- Khuôn `lookbook` có ảnh bộ đồ là suy rộng, vì mẫu thật của Muse không có ảnh.
- Bật lồng tiếng cùng kịch bản v2: câu 8–12 chữ có thể không vừa khe thời lượng kế hoạch và báo lỗi "Voice fit" nhiều hơn trước.

- Sáu kiểu có lời ngoài `review` dùng khuôn suy rộng; chất lượng thật chỉ biết sau khi chạy.
- Hai con số 0,12 và 0,30 giây có thể cắt sát quá hoặc lỏng quá.
- Câu chữ prompt nằm trong khoá cache: dự án v2 mới không ảnh hưởng dự án cũ, nhưng mỗi lần sửa khuôn về sau sẽ làm mất cache của dự án v2 đang có.
- Video có lời có thể dài hơn mục tiêu đáng kể, như Muse.

## Phụ lục A. Khuôn prompt của Muse (nguyên văn)

Ký hiệu: `{style}` phong cách hình, `{scene}` → `shot.prompt`, `{motion}` → `shot.action`, `{line}` → `shot.dialogue`, `{emotion}` → `shot.acting`, `{place}` mô tả địa điểm, `{host}` tên người dẫn, `{host.look}`, `{host.voice}`, `{product.title}`, `{product_look}`, `{look.name}` và `{look.look}` tên và mô tả bộ đồ (lookbook). Mỗi dòng là một dòng của prompt, theo đúng thứ tự.

### A.1 Ảnh chân dung người dẫn

```
Photorealistic portrait photo of a real person — {host}, the presenter of a short product video: {host.look}
Waist-up, facing the camera, friendly natural expression, mouth closed, plain light background, soft natural light, true-to-life skin texture. Only this one person. No text, no letters, no watermark.
```

Với `fashion` và `lookbook`: thay `the presenter` bằng `the model`, và nối vào cuối dòng hai: ` For this reference photo only, the model wears a plain, simple, solid neutral-colored fitted top — the face and hair are what matter here (the outfit in the video comes from the product photos).`

### A.2 Ảnh cảnh, nhóm có lời

Dòng chung, theo thứ tự:

```
Vertical 9:16 frame from a short social-media product video. Look: {style}.
Scene: {scene}
Spoken meaning (context only, NEVER render these words as text): "{line}". The opening frame must visibly establish this line's concrete subject/event, using the planned pose, expression, prop or detail; do not substitute a generic sales pose.
Action to prepare in this FIRST FRAME: {motion} Show a plausible starting pose with the relevant hands/objects visible; the clip will develop this same event.
Expression and body language: {emotion}; match the line, without forcing a smile.
Place: {place}
```

Hai dòng `Spoken meaning` và `Expression and body language` chỉ có khi cảnh có lời.

Cảnh người dẫn (`single`) thêm:

```
PRESENTER = the person in the attached presenter photo ({host}): draw exactly this same person — same face shape, eyes, eyebrows, nose, lips, skin tone, hairstyle and outfit (the same person, not a look-alike).
Presenter {host}: {host.look}
Framing: {host} faces the camera in medium or waist-up framing as needed for the action, face and mouth clearly visible and in focus, mouth closed and relaxed (about to speak). Keep the scene's relevant posture, hands or objects in frame and its line-matching expression; do not force a smile or a product-holding pose.
```

Cảnh sản phẩm (`insert`) thêm:

```
Framing: follow the scene's product/hands/body detail, with no recognizable human face. If hands or body are shown, they belong to the same host with the same sleeves, outfit and skin tone; crop all faces out, no new person and no background people.
```

Khối sản phẩm (khi sản phẩm có mặt trong cảnh):

```
PRODUCT: {product.title} — {product_look}. It must look EXACTLY like the product in the attached product photo(s): same packaging, shape, proportions, colors and label design, at a realistic size. Use the photos only for the product itself (ignore their background, banners and text). Do not redesign it and do not invent new text or logos on it.
PRODUCT SHAPE LOCK: copy the product's silhouette, proportions, parts, material finish, colors and its OWN printed brand name / logo from the attached product photos — the photos decide what it looks like, NOT its name or category words (a gadget shaped like a gun, an animal or a fruit stays exactly that gadget from the photos, never a real one). The product photos are attached FIRST, before any person photo.
```

Khi sản phẩm vắng mặt trong cảnh, thay khối trên bằng: `The product is absent from this shot; preserve that absence so the planned event stays clear.`

Riêng cảnh mở đầu thêm: `This is the opening hook frame: make it eye-catching and dynamic, and keep the top fifth of the frame as plain, calm background (wall / sky / soft blur) with no face or product there.`

Dòng kết:

```
Bright, clean, believable natural lighting; realistic proportions; true-to-life colors.
Keep it tasteful and suitable for all audiences.
Do not add any captions, subtitles, price tags, stickers, watermarks or extra logos (the product's OWN printed brand name / logo from the photos stays exactly as printed).
```

Khi cảnh không có sản phẩm, dòng cuối rút thành: `Do not add any captions, subtitles, price tags, stickers, watermarks or extra logos.`

### A.3 Clip, nhóm có lời

Người dẫn nói (`single` có lời):

```
Create ONE continuous 10-second vertical 9:16 video from the attached image, using it as the exact first frame. Keep {host}'s face, hair, outfit, the place and the lighting exactly as in the image. If the PRODUCT is visible, match its initial placement, scale, packaging, shape, colors and label, then allow only its planned movement in the action below; never teleport or redesign it, and keep its exact shape and printed brand name from the first frame (never turn it into a real object of the same kind). If absent, do not add it. Real-time speed, no slow motion, no cuts; natural smartphone-video feel.
IDENTITY LOCK: {host} stays exactly the same person as in the first frame for the whole clip — same face shape, eyes, eyebrows, nose, lips, skin tone and hairstyle while talking and moving; no morphing, no face change.
Camera: LOCKED-OFF tripod shot — the camera does not move at all (no push-in, no zoom, no pan, no tilt); the framing stays exactly as in the first frame for the whole clip.
0–0.5 s: {host} looks into the camera, mouth closed, matching the product's initial placement in the image before the planned action.
0.5–5 s: ONLY {host} speaks, directly to the viewer. {host} says this exact line ONCE in Vietnamese, clearly and completely, with accurate lip-sync on {host}'s mouth: "{line}"
Delivery: {emotion} — brisk and clear, no long pauses; follow the specified emotion without forcing a cheerful mood, every word clear.
During the spoken words, {host} performs this gentle line-matching action: {motion} Keep the planned posture/expression visible while speaking, face and mouth clear; no swallowing, drinking or covering the mouth during speech. Do not postpone the action until after the line.
5–10 s: {host} stops talking and settles naturally in the same scene; nobody speaks.
VOICE LOCK — standard Northern Vietnamese (Hà Nội) accent. {host}'s voice (host_v1): {host.voice}. The same voice in every clip of this video.
Sound: the voice is clear and in front; only very quiet room tone. No background music, no singing, no other voices. No subtitles, no text, no logos, no watermark, no new people.
VISUAL MEANING: preserve this opening scene and the SAME place throughout: {scene}. During the spoken line (if any), visibly develop the planned event, pose, reaction or object detail that expresses its meaning. Keep the first-frame identity, outfit, product appearance and lighting; do not introduce another person, scene, medical graphic or unsupported result.
```

Khi sản phẩm vắng mặt: dòng `0–0.5 s` rút thành `0–0.5 s: {host} looks into the camera, mouth closed.` và nối vào cuối dòng `VISUAL MEANING`: ` The product is absent from this shot; do not add it.`

Cảnh sản phẩm, giọng ngoài hình (`insert` có lời):

```
Create ONE continuous 10-second vertical 9:16 video from the attached image, using it as the exact first frame. Keep the place, lighting and identities in the image the same. If the PRODUCT is visible, match its initial placement, scale, packaging, shape, colors and label, then allow only its planned movement in the action below; never teleport or redesign it, and keep its exact shape and printed brand name from the first frame (never turn it into a real object of the same kind). If absent, do not add it. Never add text. Real-time speed, no cuts.
Camera: <một trong ba dòng máy quay ở A.6>
Action: {motion} Anyone visible in the image does NOT talk (mouth closed).
0.5–5 s: an off-screen voice (nobody visible speaks) says this exact line ONCE in Vietnamese, clearly and completely, at a brisk clear pace with no long pauses; match the meaning without forcing cheerfulness: "{line}"
VOICE LOCK — standard Northern Vietnamese (Hà Nội) accent. Voice: the same voice as presenter {host} (host_v1): {host.voice}. The same voice in every clip of this video.
Sound: the voice is clear and in front; only very quiet ambient sound. No background music, no singing, no other voices. No subtitles, no text, no logos, no watermark.
VISUAL MEANING: preserve this opening scene and the SAME place throughout: {scene}. During the spoken line (if any), visibly develop the planned event, pose, reaction or object detail that expresses its meaning. Keep the first-frame identity, outfit, product appearance and lighting; do not introduce another person, scene, medical graphic or unsupported result. Keep faces outside the frame; any visible hands/body retain the established host's sleeves, outfit and skin tone. No new or background people.
Delivery emotion: {emotion}; match the spoken meaning.
```

Cảnh sản phẩm không lời (quan sát ở `fashion`): dòng đầu như trên nhưng bỏ `Never add text.`; rồi `Camera: …`, `Action: {motion}`, và `Nobody speaks. Sound: only quiet natural ambient sound. No music, no voices, no subtitles, no text, no logos, no watermark.`, rồi dòng `VISUAL MEANING` của cảnh sản phẩm.

### A.4 `fashion`

Ảnh cảnh người mẫu: các dòng chung của A.2 (`Vertical…`, `Scene`, `Spoken meaning` và `Expression` nếu có lời, `Action to prepare`, `Place`), rồi:

```
MODEL = the person in the attached presenter photo ({host}): draw exactly this same person — same face shape, eyes, eyebrows, nose, lips, skin tone and hairstyle (the same person, not a look-alike). Take ONLY the face and hair from that photo — the clothes come from the product photo(s), never from the presenter photo.
Presenter {host}: {host.look}
Framing: {host} is the model, mid-dance in a natural pose, facing the camera, full-body or knees-up so the WHOLE outfit is visible (top, bottom, shoes if in frame), face clear and in focus, confident playful expression. The outfit is the product — never hold it in the hands.
PRODUCT: {product.title} — {product_look}. {host} WEARS this outfit — it must look EXACTLY like the garment(s) in the attached product photo(s): same cut, length, fit, neckline, colors, fabric texture, pattern and details, worn naturally on the body at a realistic size. Use the photos only for the garment itself (ignore their background, mannequin, banners and text); do not redesign it.
```

rồi ba dòng kết của A.2. Ảnh cảnh cận sản phẩm của `fashion` dùng đúng khuôn cảnh sản phẩm ở A.2.

Clip người mẫu nhảy:

```
Create ONE continuous 10-second vertical 9:16 video from the attached image, using it as the exact first frame. Keep {host}'s face, hair, makeup, the outfit, the place and the lighting exactly as in the image. Real-time speed, natural smartphone-video feel, no slow motion, no cuts.
IDENTITY LOCK: {host} stays exactly the same person for the whole clip — same face shape, eyes, eyebrows, nose, lips, skin tone and hairstyle; no morphing, no face change.
OUTFIT LOCK: {host} wears exactly the same outfit for the whole clip — same garments, cut, length, fit, colors, pattern and details; no costume change, nothing added or removed.
Camera: LOCKED-OFF tripod shot — the camera does not move at all (no push-in, no zoom, no pan, no tilt); the framing stays exactly as in the first frame for the whole clip.
DANCE: {host} shows off the outfit with a short, catchy TikTok-style fashion dance on the spot, energetic but light and graceful, in rhythm with an upbeat 4/4 beat: {motion} Small rhythmic moves — swaying hips, shoulder bounces, light steps, arm waves, cute hand gestures (heart hands, framing the face) — and one playful half-turn to show the side or back of the outfit, then back to the camera with a confident smile and eye contact. Keep the whole outfit (head to at least the knees) inside the frame the entire time.
```

Không lời thì thêm: `Sound: only quiet room tone (the dance music is added later in editing): no music, no singing, no voices.`

Có lời thì thêm: `Nobody visible speaks — {host} keeps the mouth closed or smiling while dancing. From 0.5 to 4 s an off-screen voice — the same voice as model {host} (host_v1): {host.voice} — says this exact line ONCE in Vietnamese, upbeat and clear: "{line}". VOICE LOCK — standard Northern Vietnamese (Hà Nội) accent. Under the voice only quiet room tone (the music is added later): no music, no singing, no other voices.`

Kết bằng `No subtitles, no text, no logos, no watermark, no new people.` và dòng `VISUAL MEANING` của cảnh người dẫn (A.3).

### A.5 `lookbook`

Ảnh cảnh: các dòng chung của A.2, rồi:

```
MODEL = the person in the attached presenter photo ({host}): draw exactly this same person — same face shape, eyes, eyebrows, nose, lips, skin tone and hairstyle (the same person, not a look-alike). Take ONLY the face and hair from that photo — never copy its clothes; the clothes of this shot are described below.
Presenter {host}: {host.look}
```

rồi theo `beat`:

- `hanger` — `Framing: {host} stands in the home dressing area facing the camera, waist-up or knees-up, holding ONE wooden hanger with the outfit in front of the body so the whole garment is visible and in focus; face clear, delighted playful smile. {host} wears a plain heather-gray soft cotton loungewear set (short-sleeve top and shorts) with no pattern and no logo — never the product.` và `PRODUCT: {product.title} — {product_look}. LOOK 1 — {look.name}: {look.look}. The garment hangs on a wooden hanger held by {host} — shown, not worn, at a realistic size, the whole piece visible. Show it realistically, with no invented text or logo. Show only this one look — never mix it with another look.`
- `wear` — `Framing: {host} is the model, in a confident natural pose in the outing place, facing the camera, full-body or knees-up so the WHOLE outfit is visible (top, bottom, shoes if in frame), face clear and in focus. The outfit is worn, never held in the hands.` và `PRODUCT: {product.title} — {product_look}. LOOK 1 — {look.name}: {look.look}. {host} WEARS this outfit, worn naturally on the body at a realistic size. Show it realistically, with no invented text or logo. Show only this one look — never mix it with another look.`
- `detail` — dòng `Framing` của cảnh sản phẩm (A.2), không có hai dòng `MODEL`/`Presenter`, và `PRODUCT: {product.title} — {product_look}. LOOK 1 — {look.name}: {look.look}. Close-up of this outfit worn on the body (fabric, neckline, waist, lace, buttons or hem) at a realistic scale, no face in the frame. Show it realistically, with no invented text or logo. Show only this one look — never mix it with another look.`
- `final` — `Framing: {host} relaxes in the outing place in the outfit (for example seated at a table with a drink), facing the camera, face clear and in focus, warm smile; the outfit clearly visible.` và dòng `PRODUCT … WEARS this outfit` của `wear`.

`LOOK 1` đổi theo số thứ tự bộ đồ (`outfitIndex + 1`). Kết bằng hai dòng `Bright, clean…`, `Keep it tasteful…` và `Do not add any captions, subtitles, price tags, stickers, watermarks or extra logos.`

Clip, dòng đầu chung: `Create ONE continuous 10-second vertical 9:16 video from the attached image, using it as the exact first frame. Keep the people, the clothes, the place and the lighting exactly as in the image. Real-time speed, natural smartphone-video feel, no slow motion, no cuts.` Rồi theo `beat`:

- `hanger` — `IDENTITY LOCK` (bản của A.4); `OUTFIT LOCK: {host} wears the same plain base outfit for the whole clip and is never dressed in the garment on the hanger; the garment on the hanger stays exactly the same piece (same cut, colors, pattern and details) — it is shown, never put on, never swapped. The outfit is LOOK 1 ({look.name}): {look.look}.`; máy đẩy nhẹ 10%; `ACTION: {host} holds the wooden hanger with the outfit in front of the body and proudly shows it to the camera with a delighted, playful smile — lifts it slightly, sways it gently to the rhythm so the fabric moves, glances at it and back at the camera; the whole garment stays visible and in focus. Planned moment: {motion}`
- `wear` — `IDENTITY LOCK`; `OUTFIT LOCK: {host} wears exactly the same outfit for the whole clip — same garments, cut, length, fit, colors, pattern and details; no costume change, nothing added or removed. The outfit is LOOK 1 ({look.name}): {look.look}.`; máy cố định; `ACTION: {host} shows off the outfit with confident model energy: a few graceful steps toward the camera, then a playful twirl that makes the skirt / hem flare, a look over the shoulder, and a confident smile with eye contact; keep the whole outfit (head to at least the knees) inside the frame. Planned moment: {motion}`
- `detail` — `IDENTITY LOCK: no face is visible — keep the frame on the outfit worn on the body; the same skin tone, arms and body for the whole clip; no new person.`; `OUTFIT LOCK: the outfit keeps exactly the same fabric, colors, pattern and details for the whole clip; nothing added or removed. The outfit is LOOK 1 ({look.name}): {look.look}.`; `Camera: slow arc shot — the camera travels smoothly about 30 degrees around the outfit, keeping the outfit centered, in focus and in the frame; the background slides sideways behind. No zoom.`; `ACTION: a slow, gentle movement that shows the fabric texture, the fit and the details of the outfit on the body (a hand lightly brushing the fabric, a small turn of the waist so the hem moves); keep the face outside the frame. Planned moment: {motion}`
- `final` — `IDENTITY LOCK`; `OUTFIT LOCK` của `wear`; máy đẩy nhẹ 10%; `ACTION: {host} relaxes naturally in the place in the outfit (for example sits at the table with a drink, takes a small sip, tilts the head), then smiles warmly at the camera; the outfit stays clearly visible. Planned moment: {motion}`

Không lời: `Sound: only quiet room tone (the music is added later in editing): no music, no singing, no voices.` Có lời: `Nobody visible speaks — {host} keeps the mouth closed or smiling. From 0.5 to 3 s an off-screen voice — the same voice as model {host} (host_v1): {host.voice} — says this exact line ONCE in Vietnamese, upbeat and clear: "{line}". VOICE LOCK — standard Northern Vietnamese (Hà Nội) accent. Under the voice only quiet room tone (the music is added later): no music, no singing, no other voices.`

Kết bằng `No subtitles, no text, no logos, no watermark, no new people.` và dòng `VISUAL MEANING` (bản người dẫn cho `hanger`, `wear`, `final`; bản sản phẩm cho `detail`).

### A.6 Ba dòng máy quay

```
Camera: LOCKED-OFF tripod shot — the camera does not move at all (no push-in, no zoom, no pan, no tilt); the framing stays exactly as in the first frame for the whole clip.
Camera: very subtle, very slow push-in — the camera glides forward only slightly, so the framing tightens by only about 10% over the whole clip; no other camera movement.
Camera: slow arc shot — the camera travels smoothly about 30 degrees around the product, keeping the product centered, in focus and in the frame; the background slides sideways behind. No zoom.
```

## Phụ lục B. Mẫu kịch bản thật của Muse (review, người dẫn, rút gọn)

Bốn cảnh đầu và ba cảnh cuối của dự án 16 cảnh, ghi theo trường của MaiStudio.

| beat | shotType | caption | dialogue | acting | prompt | action |
|---|---|---|---|---|---|---|
| hook | insert | Đế nâng 3cm tôn dáng | Đế nâng 3cm, tôn dáng ngay khi xỏ vào! | Bright, punchy, confident from first second | Vertical 9:16 close-up in the bright entryway, subject in upper-middle, bottom quarter calm and uncluttered; cropped lower legs in dark beige trousers wearing the white sục, one foot raised showing the thick sole side profile, face out of frame. | Takes two steps forward, then lifts one foot slightly to reveal the elevated sole. |
| intro | single | Giày sục Hải Anh Shoes | Đây là giày sục Hải Anh Shoes, kiểu xỏ tiện lợi. | Friendly, welcoming, clear | Vertical 9:16 medium shot in same entryway, subject in upper-middle, bottom quarter calm and uncluttered; Minh faces camera, face and mouth clearly visible, mouth closed about to speak, holding one white sục near the lens. | Raises the shoe slightly toward camera, then turns it to show the rounded toe. |
| intro | single | Đơn giản, tinh tế | Thiết kế đơn giản, tinh tế, phù hợp nhiều phong cách. | Natural, trustworthy, upbeat | Vertical 9:16 waist-up shot in same entryway by the shoe cabinet, subject in upper-middle, bottom quarter calm and uncluttered; Minh faces camera, face and mouth clearly visible, mouth closed about to speak, empty hands gesturing openly. | Gestures lightly with both hands while speaking, then gives a small approving nod. |
| benefit | insert | Đế độn khoảng 3cm | Đế độn khoảng 3cm giúp tôn dáng người đi. | Informative, clear, factual | Vertical 9:16 side detail on the shoe cabinet top, subject in upper-middle, bottom quarter calm and uncluttered; white sục in side profile, Minh's hand in sage green sleeve points along the thick sole, face out of frame. | Runs fingertip along the thick sole edge from heel to toe once. |
| proof | single | 4.7/5 - 3925 đánh giá | Shop đạt 4.7 trên 5 từ 3925 lượt đánh giá. | Trustworthy, straightforward, pleased | Vertical 9:16 waist-up shot in same entryway, subject in upper-middle, bottom quarter calm and uncluttered; Minh faces camera, face and mouth clearly visible, mouth closed about to speak, empty hands, plant and cabinet softly behind. | Counts lightly on his fingers for emphasis, then nods once to camera. |
| offer | single | Giá 69.990₫ - 93.000₫ | Giá trên shop từ 69.990 đồng đến 93.000 đồng. | Upbeat, honest, value-focused | Vertical 9:16 medium shot in same entryway, subject in upper-middle, bottom quarter calm and uncluttered; Minh faces camera, face and mouth clearly visible, mouth closed about to speak, holding the white sục at chest height. | Presents the shoe steadily to camera and gives a small inviting nod. |
| cta | single | Chạm link để mua | Chạm link sản phẩm trong giỏ hàng để mua nhé! | Friendly, inviting, energetic closing | Vertical 9:16 medium close-up in same entryway, subject in upper-middle, bottom quarter calm and uncluttered; Minh faces camera, face and mouth clearly visible, mouth closed about to speak, white sục held beside him, free hand ready to point down. | Points down toward the product link area, then smiles and nods to finish. |

Trình tự nhịp đầy đủ của dự án này: hook, intro ×2, benefit, demo, benefit, demo ×2, benefit ×2, demo, benefit, proof ×2, offer, cta.

## Ghi chú sau thực thi (20/11/2026)

Thân tài liệu ở trên giữ nguyên bản đã duyệt. Code khác thiết kế ở các điểm sau:

1. **v2 bắt buộc khi lập kế hoạch (5.1).** Như thiết kế, lập kế hoạch (lần đầu hoặc lập lại) cho chín kiểu luôn kiểm theo luật v2; câu trả lời thiếu hoặc sai yêu cầu v2 là lỗi lập kế hoạch, đi qua đúng một lượt sửa có sẵn rồi dừng. Bốn test quy trình Video Aff cũ ("Affiliate planning uploads…", "Run all plans…", "a failed Affiliate script is repaired once…", "ambiguous Affiliate provider admission…") trước đây đưa vào câu trả lời kiểu cũ cho `review`; theo chỉ đạo của anh ngày 20/11/2026, câu trả lời giả lập trong bốn test này được đổi sang dạng v2, các điều chúng kiểm giữ nguyên.
2. **Tham số `planning`.** `parsePlan(value, project, planning = false)` và `finishAffiliatePlan(project, data, raw, planning = false)` thêm cờ để phân biệt lập kế hoạch mới với kiểm lại kế hoạch đã sửa tay; hai chỗ gọi khi lập kế hoạch trong `src/core/studio.ts` truyền `true`. Khi kiểm lại, `productLook`/`outfitLooks`/`narratorVoice` lấy từ `project.data` bên trong `finishAffiliatePlan`, nên JSON dựng lại cho dự án cũ không đổi.
3. **Luật kiểm v2 bổ sung.** Nhóm có lời có tiếng (không `keepScript`) bắt buộc mỗi cảnh có lời; không kiểm số chữ 8–12 (chỉ nằm trong prompt). Khi một kế hoạch được lưu qua `parsePlan` theo đường cũ, bốn trường v2 bị xóa; đường chỉ-kiểm-lại không lưu kế hoạch nên không xóa chúng.
4. **Prompt review (5.3).** Ngoài tiêu chí structure, với v2 câu "lời và hành động phải xong trong số giây của cảnh" đổi thành "hành động đơn giản, mỗi lời một câu ngắn", vì thời lượng v2 chỉ là danh nghĩa; cảnh gửi review có thêm `shotType`, `productVisible`.
5. **Thời điểm lời nói trong clip (5.5).** Dữ liệu Muse cho thấy với nhóm có lời, mốc kết thúc lời trong prompt clip là `round(1,6 + 0,3 × số chữ)` giây của câu được đưa vào, không cố định 5 giây; fashion 4 giây, lookbook 3 giây như thiết kế.
6. **Đọc số thành chữ (trước đây ngoài phạm vi, mục 2).** Repo đã có bộ đọc số tiếng Việt trong `src/core/acoustics.ts` dùng để so transcript; nay xuất ra thành `spokenVietnamese`. Với v2 tiếng Việt, lời trong prompt clip được đọc thành chữ (khớp năm cặp thật của Muse); prompt ảnh và `dialogue` (phụ đề, review lời) giữ chữ viết gốc.
7. **Giới hạn mô tả sản phẩm.** Riêng v2, mô tả sản phẩm trong planning input cắt ở 4000 ký tự để request có dư ít nhất 4 KB với sản phẩm Shopee lớn; dữ liệu lưu trữ và input của đường cũ không đổi.
8. **Thứ tự ảnh tham chiếu (5.4).** Cảnh sản phẩm có `productVisible: false` không kèm ảnh sản phẩm (bảng thiết kế không có trường hợp này). Câu tư thế chỉ nối khi cảnh có kèm ảnh người dẫn.
9. **Dựng và sửa lỗi.** Câu bị cụt khi dựng dùng cùng điều kiện dừng với lỗi tràn cũ (`render`, hoặc khi tự kiểm tắt). Dựng một phần cảnh của dự án v2 dừng với thông báo phải dựng toàn bộ video. Prompt sửa lỗi v2 (không lồng tiếng) không nêu thời lượng kế hoạch. Ảnh người dẫn v2 có fingerprint riêng nên ảnh kiểu cũ không bị dùng lại.
10. **Một điều kiện v2 duy nhất.** `affiliateV2(project)` (`src/shared/affiliate.ts`) đúng khi có dấu **và** kiểu có nhóm khuôn; prompt, thời lượng, dựng một phần, sửa lỗi, review sản phẩm vắng mặt và ảnh người dẫn đều dùng nó.
11. **Sau review độc lập.** Mốc kết thúc lời clip nhóm `talk` chặn ở 9 giây; cảnh người dẫn không lời có biến thể clip riêng (suy rộng); `productVisible: false` chỉ áp cho nhóm `talk`, và review ảnh lẫn review video của những cảnh đó báo sản phẩm cố ý vắng mặt và chấp nhận `not_applicable` (sản phẩm ở ảnh, identity ở video); độ dài đo câu cụt là `min(container, audio giải mã)` ở cả dựng và review; fingerprint ảnh người dẫn có nhóm khuôn; ghi chú thời lượng trên giao diện chỉ hiện khi kiểu có nhóm khuôn và không lồng tiếng.
