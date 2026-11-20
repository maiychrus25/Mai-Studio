## Affiliate timing and repair evidence — 20/11/2026

**Trạng thái: DEV VERIFIED433/433; đã cài và mở artifact Mac ARM64 theo chấp thuận hiện có.** Native Affiliate thiếu edit deadline trong prompt và cảnh không thoại nhận cả voice direction; feedback speech fail chỉ đọc checks nên mất reason/expected/heard. Các ca RED→GREEN kiểm deadline3.333s, im lặng không chứa Stable voice/host-speaks/final-spoken-word/requested-dialogue, overflow, lời tự thêm, sai transcript/giọng và mọi visual failure còn được giữ khi reason đầu quá dài. Deadline chỉ áp explicit Affiliate; prompt tham chiếu và nhịp native Film giữ nguyên. Planning/review bổ sung tính tương thích sản phẩm/hành động và anchor/framing, không tự sửa kịch bản đã lưu hoặc bỏ product QC.

Source cuối: make build kết thúc Build succeeded; make test433pass/0fail/0cancel/0skip; lint exit0, docs-check OK; reviewer không còn blocker cụ thể. Hai vòng1000task desktop/mobile × light/dark đạt: round1 980succeeded/20cancelled,5048ms; round2 881succeeded/68lỗi429 fixture chủ đích/51cancelled,10525ms; peak2, bốn screenshots/vòng, reopen không resubmit. Thư mục fixture/screenshot tự dọn. Replay read-only chính job thật kiểm shot2 deadline3.334s/overflow và shot3 bỏ voice direction/lời tự thêm, không thay data. Không thêm dependency, IPC hoặc schema.

Job gốc đã hết hai vòng sửa và đang waiting_input; bản sửa không reset budget hay tự gửi provider mới. Clip/file cũ vẫn giữ, prompt mới có thể làm fingerprint output cũ không còn khớp; cần kế hoạch/lượt tạo phù hợp để nghiệm thu video mới. Chưa có live generation theo bản sửa này, chưa có MP4 tổng đạt QC, chưa chạy lại native Kubuntu hoặc xác minh bằng Muse.

Artifact sau áp dụng: codesign deep/strict đạt,63file trong ASAR khớp dist, native isolated startup với mockKeychain trả đúng version0.2.0-dev.4 và0project/0task. Installed ASAR byte-match staging và SHA256 `f3fc52e117c272eeb979835d51e44d4b907f85cd3871ad6222c5c947b89f650c`. App đã thoát sạch trước thay gói và mở lại bình thường không debug flags; private snapshot quick_check OK. Sau cài đối chiếu toàn bộ ID và production maps với snapshot: giữ2project/2account/7task/157asset,157file đều tồn tại, job gốc waiting_input/round2, không job mới chạy. Thư mục đóng gói tạm đã dọn; giữ một snapshot riêng tư để khôi phục dữ liệu khi cần. Không thêm dependency; dùng pipeline/quality module và IPC hiện có.

## Quality-review resume dev0.2.0-dev.4 — 20/11/2026

**Trạng thái: đã cài artifact Mac ARM64 dev.4 theo chấp thuận mới; job gốc đã tiếp tục chạy.** Tái hiện bằng fixture thật: fresh explicit review đã pass nhưng Resume job autoChecks phát lại unknown từ checkpoint. RED trên source trước sửa; sau sửa giữ review ảnh/video/ASR mới hơn từ task khác, đúng asset/fingerprint, không mua thêm lượt tạo/review khi Resume dùng được kết quả đó. Review mới vẫn unknown/fail hoặc asset khác vẫn chặn, không đánh dấu đạt thay người dùng. Thêm timestamp/provenance để checkpoint response mới hơn thắng assessment cũ sau crash.

**Ghi chú sau áp dụng:** bằng chứng chuẩn bị/hoãn cài bên dưới là lịch sử, đã được chấp thuận mới thay thế. Source cuối5ca7157 đạt build, full426/426, lint/docs, hai vòng1000task desktop/mobile × light/dark (980/20 và882/67lỗi429 chủ đích/51hủy), reviewer không còn blocker turn-binding. Artifact cài `/Applications/MaiStudio.app`,63 file khớp dist, codesign deep/strict và ASAR byte-match đạt; SHA256 ASAR `bc6df51f57d1507e613acef0337131eabc1ad520b0e5df3b3de3978b4e60db8d`. Giữ2project/2account/60asset ban đầu,9ảnh/9clip; task review mới bổ sung vào lịch sử, không xóa task cũ. Native app.getVersion xác nhận0.2.0-dev.4.

Lượt review đầu sau cài lộ lỗi adapter lấy phản hồi video cũ cho review ảnh và request mới không có ảnh. Sau sửa binding và mở tài khoản chờ trang sẵn sàng, review riêng shot1 `108615fd-e748-433d-bc74-29270ff54717` nhận đủ7ảnh; image/video đều lưu đúng replyMessageId và hoàn tất. Verdict thật fail: động tác ảnh khác kế hoạch, tất thay hình/màu/hoa văn trong clip, lời vượt slot; không đổi thành pass. Resume auto job `ff5e7eea-50bd-442c-8100-f42c03f3d664` xác nhận running, round0, qualityRetries2 và đã nhận assessment shot1 từ task mới. Đây là bằng chứng luồng review/resume thật, chưa phải video hoàn tất hoặc chất lượng ngang Muse. Không tự giải phóng pending admission, tăng budget, sửa kịch bản hoặc cắt lời. Bản dev.4 chưa phát hành public và chưa chạy native Kubuntu trong lượt này.

Review độc lập phát hiện best-take có thể khôi phục image pass cũ khi hai video dùng chung ảnh vừa bị đánh fail. Regression hai take RED rồi GREEN; cập nhật từng category cùng asset/fingerprint và score, kiểm cả Resume/Retry không phát sinh request/generation hoặc tăng take. Các guard giữ: source media, tối đa hai vòng sửa, không gửi lại remote admission chưa rõ, selected review không thay cảnh ngoài phạm vi, chỉnh input trong lúc HTTP không áp kết quả cũ, audio/ASR/cohort/voice-fit và bảo toàn output.

```text
make build: Build succeeded
make test: 422 tests, 422 pass, 0 fail, 0 cancelled, 0 skipped
focused quality/review: 31 pass, 0 fail
make lint: exit 0, zero warnings
node scripts/check-docs.js: docs-check: OK
```

UI Electron thật với provider loopback: tám lượt qua hai vòng desktop1440/mobile390 × light/dark, EN vòng1/VI vòng2. Nút đánh giá lại chỉ gửi cảnh fail/unknown trong selection job; cảnh đã pass và cảnh lỗi ngoài selection không được gửi. Hủy dialog không tạo task/request; xác nhận tạo đúng một task review với image+video request, không tạo lại media hoặc chạy job gốc. Job gốc giữ waiting_input, không tràn ngang/lỗi renderer. Harness cuối đợi trạng thái task thực qua IPC, không suy ra hoàn tất từ event/promise sớm.

Stress nguyên script: round1 980succeeded/20cancelled,7805ms; round2 880succeeded/69lỗi429 fixture chủ đích/51cancelled,14759ms. Mỗi vòng1000task, peak2,4ảnh desktop/mobile × light/dark, không lỗi renderer/tràn ngang, reopen không gửi lại. Test/stress/UI data và screenshots dùng thư mục tạm tự dọn.

MacARM prebuilt app: `/var/folders/l0/vg14kkpx6gq1q2cnfg86476w0000gn/T/mai-studio-qc-artifact-rmjsfbgc/mac-arm64/MaiStudio.app`. Native electron-builder26.8.1/Electron41.5.1, app/package/app.getVersion đều0.2.0-dev.4;63 compiled files trong ASAR khớp dist, codesign deep/strict đạt, khởi động với userData riêng/mockKeychain trả bridge/state0project0task và không lỗi renderer. Artifact được giữ riêng để áp dụng sau, không ghi đè app/installer hoặc dữ liệu đang dùng. Không kiểm native Keychain/Gatekeeper/notarization/Kubuntu runtime. Phát hiện sẵn có ngoài phạm vi: nhãn state.version vẫn hardcode0.2.0-dev.1 trong source trước sửa; ghi nhận riêng, không dùng nhãn đó để kết luận version artifact và không sửa lẫn nhiệm vụ này.

Read-only live cho thấy hai task chờ: auto job ở QC và render job dừng do lời thoại shot1 vượt slot. Bản sửa không tự chỉnh checkpoint/media của hai task đó; speech overflow vẫn bị chặn để không cắt mất lời. Anh đã dặn hoãn cài/restart khi có job nên chưa áp dụng, chưa gửi review/generation thật hoặc tuyên bố video đã đạt. Lượt provider mới cần xác nhận qua thao tác đã hiển thị phí.

## Shopee page gallery Release 0.2.0-dev.3 — 20/11/2026

**Trạng thái: đã kiểm source cuối và phát hành pre-release; chưa cài trên máy anh.** Capture anh gửi cho92509213/27621749954 có bốn ảnh Muse nhưng Mai chọn một ảnh JSON-LD khác. Regression tái hiện trước sửa; shared reader nay ưu tiên gallery rõ ràng và giữ facts/cache-only. Review phát hiện thêm hai regression ở candidate đầu: hero chung đè bộ structured đầy đủ và gallery placeholder rơi sang ảnh gợi ý. Hai bài kiểm mới RED2/2 trước sửa, GREEN2/2 sau sửa; focused suite cuối23/23, gồm generated bookmarklet chạy trong Chromium desktop1440/mobile390 và parse đúng bốn URL anh cung cấp. Không gọi đó là kiểm DOM Shopee live: không có tab sản phẩm khớp trong Chrome để đọc.

Build succeeded; lint exit0/zero warnings, docs-check OK, actionlint sạch. Full suite trước hai guard cuối413/413; source cuối local415/415 và CI415/415, không fail/cancel/skip. Các kiểm hồi quy Shopee gồm legacy Muse/page/get_pc/API, giá cache -1, chín ảnh và thứ tự, URL/MIME/byte limits, partial/cancel/retry/checkpoint, giữ output và chỉnh sửa đồng thời. Không đổi dependency, schema/IPC hay dữ liệu của anh.

Hai vòng stress source cuối đạt với Electron thật/provider loopback: round1 980succeeded/20cancelled, queue5482ms; round2 879succeeded/70lỗi429 có chủ đích/51cancelled, queue10393ms; peak2, bốn tổ hợp desktop/mobile × light/dark mỗi vòng, không tràn ngang/renderer error, reopen không resubmit. Lượt trước chạy cùng full suite bị screenshot timeout và không được tính là đạt; chạy riêng lại giữ nguyên script/assertion và đạt cả hai vòng. Không suy ra nguyên nhân chắc chắn của timeout từ một lần tái hiện.

Hộp hướng dẫn thật kiểm tám lượt qua hai vòng desktop/mobile × light/dark: lời nhắc thay URL dấu trang hiện, mã copy khớp generator, đóng được modal, không tràn ngang trang/modal hoặc lỗi renderer. Hai lần probe đầu dùng sai locator trong harness (picker Affiliate bị ẩn trên desktop, Close có hai nút) đã được sửa theo DOM hiện hữu; không đổi app để phục vụ test. Dữ liệu thử/stress và ảnh chụp dùng thư mục tạm tự dọn. Bản cài cũ/dấu trang đã lưu chưa tự đổi; người dùng cần cài bản mới và thay URL dấu trang. Native runtime Kubuntu và layout Shopee thực vẫn chưa nghiệm thu.

[Release v0.2.0-dev.3](https://github.com/maiychrus25/Mai-Studio/releases/tag/v0.2.0-dev.3) public lúc2026-11-20T00:53:22Z, ID452130111, source3618cc0e54f4d0101226970c9de57dd9f5a19ffe, [Build44648246603](https://github.com/maiychrus25/Mai-Studio/actions/runs/44648246603) thành công7/7job. Chín installer Mac ARM64/x64, Linux ARM64/x64, Windowsx64 và SHA256SUMS.txt khớp toàn bộ asset digest trước/sau public; tag đúng source, public page HTTP200, tải anonymous8byte đầu ARM64 DEB trả206 và header Debian hợp lệ. PR#1 đã merge, tree merge khớp hoàn toàn source build; bản cũ giữ nguyên. Báo cáo sau phát hành chỉ đổi docs, không đổi application source.

Nhập lại JSON Muse bốn URL anh cung cấp qua StudioService cô lập, tải/giải mã CDN công khai thật: succeeded4/4JPEG, giá15.000₫; không coi đây là lượt scrape Shopee mới hoặc xác nhận giá hiện tại. Không dùng provider tạo sinh, tài khoản hay profile cá nhân. Anh dặn đang chạy job nên chưa cài: không thay bộ cài đang dùng, restart app, đổi task/checkpoint hoặc cấu hình tài khoản. Truy vấn giải thích thông báo review dùng SQLite mode=ro; không sửa job hay đánh dấu unknown thành pass.

```text
make build: Build succeeded
make test: 415 tests, 415 pass, 0 fail, 0 cancelled, 0 skipped
make lint: exit 0, zero warnings
node scripts/check-docs.js: docs-check: OK
actionlint: exit 0
stress: two rounds PASS; desktop/mobile x light/dark
```

## 0.2.0-dev.2 native Release — 19/11/2026

**Trạng thái: đã phát hành pre-release và xác minh digest.** [Release v0.2.0-dev.2](https://github.com/maiychrus25/Mai-Studio/releases/tag/v0.2.0-dev.2), source d6e179c33207d1d1a740fc6f3d18816b6d96bceb, [Build44501164595](https://github.com/maiychrus25/Mai-Studio/actions/runs/44501164595). Bảy job verify/năm native package/draft đều thành công; verify giữ đầy đủ build/lint/docs/subtitle guard/make test. Đã công khai lúc2026-11-19T10:05:44Z với chín installer và SHA256SUMS.txt. Đối chiếu chín hash trong notes do CI tạo với asset digest và hash manifest cả trước/sau public; tag đúng source, trang public HTTP200 và Release0.2.0-dev.1 không đổi.

App thay đổi thêm duy nhất MAX_SHOPEE_IMAGES=9 cùng version2, giữ bản sửa giá -1. Hai test mới đã RED ở8ảnh trước thay đổi và GREEN ở9ảnh sau; focused19/19, local make test411pass/0fail/0skip/0cancelled, Build succeeded, lint/docs/actionlint qua. Hai vòng1.000task Electron: round1 980succeeded/20cancelled; round2 876succeeded/73 lỗi429 fixture có chủ đích/51cancelled; peak2, đủ desktop/mobile × light/dark, không lỗi renderer/tràn ngang và reopen không gửi lại.

Thử riêng gallery công khai của sản phẩm anh gửi: nhập9/9ảnh thật, price53.000₫, không có cảnh báo cắt gallery; dùng thư mục dữ liệu cô lập đã tự dọn. Lượt411test và stress không dùng credential/tính phí. CI mới bỏ APT bị kẹt, dùng Chrome/DejaVu đã có và FFprobe upstream có SHA256 pin; draft upload nội bộ Actions sau các gate. Run44496775307 có5package success nhưng verify bị kẹt nên không dùng để phát hành. Các lượt tải artifact cũ về máy bị reset đã được kết thúc và dọn thư mục staging. Không ghi thêm bộ cài vào Downloads, không restart app/ngắt task của người dùng trong lượt phát hành.

Giới hạn: đây là chứng cứ source/native packaging và local/CI integration; chưa chạy installer mới trực tiếp trên bare-metal Kubuntu ARM64, Intel Mac hoặc Windows. macOS vẫn ad-hoc/chưa notarized, Windows chưa ký chứng chỉ tin cậy; không bật auto-update/feed/deploy và chưa công nhận toàn bộ tính năng bằng Muse.

## Shopee unavailable cached price — 19/11/2026

**Trạng thái: sửa và kiểm chứng local; bộ cài Release trước đó chưa cập nhật.** Capture sản phẩm anh cung cấp có range_min/range_max=-1 nhưng single_value=5300000000; parser cũ dừng với Invalid Shopee product numeric fact. Hai regression test tái hiện lỗi trước sửa, sau sửa lấy giá 53.000₫ trước item.price_min=5900000000, giữ giá model, không bịa giá thiếu bằng 0 và vẫn chặn số âm khác/rating âm/giá API âm/đơn vị cache không nguyên.

make build đạt Build succeeded; make test 409 pass/0 fail/0 cancelled/0 skipped; make lint exit0 và docs-check OK. Shopee focused suite 17/17 bao gồm page/cached/API, image guards, cancel/retry/checkpoint, bảo toàn output và chống ghi đè chỉnh sửa đồng thời. Hai vòng Electron fixture 1.000 task/vòng đạt: round1 980 thành công/20 hủy; round2 886 thành công/63 lỗi429 có chủ đích/51 hủy, peak concurrency2. Mỗi vòng có desktop/mobile × light/dark, không lỗi renderer/tràn ngang và reopen không gửi lại.

Replay các field sản phẩm được parser sử dụng từ JSON anh gửi trong StudioService cô lập, tải ảnh thật từ CDN công khai: nhập thành công giá 53.000₫, 24 models, 2 attributes, 8/9 ảnh theo giới hạn sẵn có. Không dùng credential/provider tạo sinh, không thay dữ liệu người dùng; không kiểm chứng lại giá đang bán ngoài capture hoặc mọi layout Shopee. Thư mục dữ liệu/log/screenshot của các lượt kiểm tra mới tự dọn sau khi kết thúc. Không đổi dependency, IPC/schema, version hay phát hành lại installer trong nhiệm vụ này.

## Native CI installer build — 17/11/2026

**Trạng thái: native CI build đạt — verify và 5/5 package job thành công.** Anh yêu cầu CI build tương tự automation-marketing. Dùng verify của MaiStudio và năm runner native, ký ad-hoc macOS, artifact chỉ installer/update files trong14ngày, không tạo tag/Release/deploy. Theo yêu cầu có kết quả sớm, dev package chạy song song verify; chỉ công nhận đạt khi cả hai nhánh qua. Run44045714228 của69275b4 trước đó dừng ở pixel subtitle (peak143), với cùng hash FFmpeg/font như run trước đã qua; log lỗi vẫn giữ riêng.

Follow-up chỉ thêm cpu-independent=1 vào nhánh libx264 cuối của MediaTools, không vào FFV1 trung gian; dùng quyết định canonical theo contract x264. Tham số chất lượng/format/audio và assertion gốc giữ nguyên. Review tĩnh không thấy blocker, nhưng không thay kết quả native CI. Build/lint/docs/actionlint qua, focused subtitle render và full407/407 trên macOS ARM64 qua sau sửa. Log full suite ở `/private/tmp/mai-studio-ci-packaging-20261117/cpu-independent-test.log`; stress và hosted/native package evidence được ghi riêng theo kết quả thực.

Hai vòng stress sau đổi encoder dùng script được ship: round1 980 thành công/20 hủy; round2 877 thành công/72 lỗi429 fixture có chủ đích/51 hủy, mỗi vòng1000 task, peak2. Desktop/mobile và light/dark đủ bốn tổ hợp mỗi vòng, không tràn ngang/lỗi renderer, reopen không gửi lại. Kết quả và ảnh ở `/private/tmp/mai-studio-ci-packaging-20261117/cpu-independent-stress/`. Đây là kiểm local, chưa phải xác nhận installer/runtime của năm OS/architecture.

Kết quả hosted cuối: [Build44049704483](https://github.com/maiychrus25/Mai-Studio/actions/runs/44049704483) của commit35f8d82 đạt build/lint/docs, subtitle guard gốc và full407pass/0fail/0skip/0cancel; năm job native đều success. Có đủ artifact macOS ARM64/x64 (DMG+ZIP), Linux ARM64/x64 (AppImage+DEB), Windows x64 (NSIS EXE), cùng metadata/blockmap được tạo. Build không xuất bản GitHub Release và không đổi tài khoản/proxy/provider hoặc triển khai production.

Mac ARM64 tải từ CI: DMG hdiutil verify VALID, codesign deep/strict exit0, app/FFmpeg là Mach-O ARM64;63 file compiled trong ASAR khớp dist đã test, version/main/dependencies đúng. App startup cô lập với mock keychain đạt, bridge trả state,0project/0task, desktop1440 không tràn ngang và0renderer errors. Linux AppImage headers lần lượt AArch64 vàx86-64; chưa chạy installer/runtime Windows, Intel Mac hay bare-metal Linux trong lượt này. Gói tải về ở Downloads/MaiStudio-CI-35f8d82; report/ảnh/log ở `/private/tmp/mai-studio-ci-packaging-20261117/`. Bản cài vẫn dev/ad-hoc, chưa có chứng nhận Apple/Windows; chưa công nhận full Muse parity.

## Repository checkpoint và publication — 17/11/2026

**Trạng thái: checkpoint sản phẩm đã lưu và push; cấu trúc/quy trình repo đã kiểm dev.** Anh đã chỉ định repo GitHub Mai-Studio, nhánh main và yêu cầu push. Remote main xác nhận đúng source checkpoint `bdbdf3f`; kết quả CI của các commit tiếp theo theo dõi trong GitHub Actions, không suy ra từ kiểm local. Các báo cáo nghiệm thu trước đây vẫn là lịch sử; publication mã nguồn không phải phát hành hoặc chứng nhận full parity.

Review read-only snapshot 43 file trước checkpoint không thấy Critical/P1 chặn bảo toàn bản dev. Có một P2 từ đường dữ liệu chưa tái hiện UI trong lượt review: khi bật Affiliate dub, `QualityResults` so speech.assetId với raw production.videos, trong khi core đánh giá asset đã lồng tiếng. UI có thể báo nhầm review vừa chạy là của clip trước. Ghi nhận để sửa trong nhiệm vụ chất lượng/UI; bước chuẩn hóa repo không đổi logic sản phẩm hoặc tuyên bố nhánh dub đã nghiệm thu đầy đủ.

Thay đổi repo dùng lại cấu trúc hiện có, thêm hướng dẫn đóng góp/changelog/mẫu PR/editorconfig, bảo vệ file dữ liệu/secret bằng ignore, CI verify push main/PR và đóng gói thủ công opt-in. Stress runner macOS chỉ đổi sang mock keychain trong userData thử nghiệm, giữ assert desktop/mobile, light/dark, queue/cancel/reopen. Không thêm dependency hoặc đổi IPC/schema.

```text
make build: Build succeeded
make test (macOS ARM64): 407 pass, 0 fail/cancelled/skipped
make lint: exit 0, zero warnings
docs-check: OK
actionlint: exit 0
Stress 1: PASS; 1000 tasks = 980 succeeded + 20 cancelled; peak 2
Stress 2: PASS; 1000 tasks = 883 succeeded + 66 intentional fixture 429 failures + 51 cancelled; peak 2
Each round: desktop/mobile, light/dark, 4 screenshots, 0 renderer errors, reopen without resubmission
```

Logs/ảnh mới ở `/private/tmp/mai-studio-interface/repository-stress/` và `repository-check-test.log` cùng thư mục cha; kiểm trực quan ảnh desktop/mobile của cả hai vòng. Vòng mới này là macOS ARM64, không ghi là chạy lại Linux/provider live. Kiểm ignore bằng 10 đường dẫn dữ liệu/secret/generated và source/tests hợp lệ, actionlint cho workflow, và rà mẫu credential trên lịch sử/source trước publication không ghi nhận mẫu khớp. Đây không thay thế audit bảo mật toàn diện.

Lượt GitHub CI Linux x64 đầu tiên [44029368637](https://github.com/maiychrus25/Mai-Studio/actions/runs/44029368637) build/lint qua, full suite đạt 406/407: test slideshow 101 ảnh fail ở pixel chữ trắng của caption 160×120, không phải assertion thời lượng/chuyển động. Tái hiện có kiểm soát trên Linux ARM64: môi trường DejaVu cũ qua; cài Liberation khiến Arial chọn Liberation Sans và cùng assertion fail; ưu tiên DejaVu Sans bằng Fontconfig thì cùng test qua. CI bổ sung `fonts-dejavu-core`, `tools/ci-fonts.conf` và kiểm fc-match. Không sửa/bỏ assertion, không đổi font ứng dụng hay dependency runtime. Log RED/GREEN giữ riêng `ci-font-liberation-red.log`/`ci-font-dejavu-green.log` trong scratch trên; lần full suite hosted tiếp theo phải đọc kết quả thực trong Actions, không lấy lượt local thay thế.

Run tiếp theo [44031873818](https://github.com/maiychrus25/Mai-Studio/actions/runs/44031873818) của commit `f6553bc` không khởi động runner: job có 0 step, nguyên nhân điều kiện tài khoản/runner được ghi trong annotation của GitHub. Vì chưa chạy test nên không coi lượt này là xác nhận hoặc phủ định bản sửa font. Full CI Linux x64 sau sửa vẫn chưa nghiệm thu; cần khôi phục khả năng cấp runner rồi chạy lại. Local build/lint/docs/actionlint và test pixel RED→GREEN giữ kết quả đã ghi, source/assertions không đổi.

## Giao diện kiểu Muse, âm thanh Affiliate và tài khoản — 17/11/2026

**Trạng thái: UI/âm thanh đã triển khai và kiểm dev; spoken live, native comparison mới và full parity còn mở.** Ưu tiên vẫn Affiliate → Film → SRT. Screenshot UI nguồn là Muse 1.13.12; options/project/scene metadata và kiểm tài khoản là Muse 1.13.18, không gộp hai phiên bản làm một bằng chứng.

MaiStudio có điều hướng ngang, danh sách dự án Affiliate với trạng thái/số cảnh thật, bốn tab Sản phẩm/Thiết lập/Shot/Output. Script/cast/voice/raw config giữ trong Công cụ nâng cao; đóng nhóm khi đang ở tab phụ quay về Thiết lập. Lưới bốn cảnh desktop có ảnh/preview clip và tạo lại riêng từng cảnh; khung chạy lựa chọn chỉ hiện sau khi chọn shot. Giữ xác nhận, queue/force, merge field vào state mới nhất, source thiếu ảnh tự mở và nút bỏ reference không còn khả dụng. Review fail/unknown/stale và lỗi task vẫn có đường xem; history phân trang 40, hủy vẫn thấy Retry. Bảy visual preset do Mai viết prompt độc lập và custom không đổi legacy styles.

Nhạc none/file/auto, musicVolume/ducking và voiceVolume hiện trực tiếp. Optional `affiliateDub` dùng IntegrationClient/TTS sẵn có (OpenAI-compatible hoặc VoiceTube ở host đã hỗ trợ), voice ID, speed 0,8–1,25 và fitted audio cache; speech QC đọc audio thay thế. Thiếu provider/voice dừng trước generation; render/check cache không gọi TTS. Silent/ASMR/slideshow không nhận dub. Chưa có credential hoặc lượt VoiceTube thật, không chứng nhận khẩu hình hay automatic voice matching.

Lượt live có lời: plan + review nguồn đạt, một MP3 15,05 giây/361.787 bytes và một ảnh cảnh đã tạo. Custom waveform không có URL DOM; menu More options → Download được tái hiện và phục hồi **cùng task** thành công, không gửi lại prompt nhạc. Bổ sung bind reply/prompt/DOM order, CDP Page download progress theo GUID để cancel quá 256 MiB, deadline, file/URL/probe guard và cancel handle đến muộn hoặc bị từ chối. Progress có độ trễ; kiểm kích thước trước import vẫn giữ. API Page events deprecated được kiểm trên Chrome157/Playwright1.62 đã pin, chưa bảo đảm bản trình duyệt tương lai. Provider trả lời từ chối video theo quốc gia/khu vực; lượt all sở hữu được hủy, giữ admission và media. Guard mới trả NeedsInput sớm cho refusal mới với “your account”, “this account” hoặc một nhãn ASCII như “your MaiStudio account”; ba ca browser RED→GREEN bảo đảm admitted retry không gửi lại. Không auto-resubmit. **Không có clip có lời mới từ lượt này.**

Mẫu `evidence/affiliate-fashion-music.mp4` là dựng cục bộ **bốn clip Mai Fashion cũ đã tạo**, gắn MP3 thật vừa tải, host silent, nhạc 100%; không tạo clip/lời hoặc model review mới. Video15s1080×1920/30fps H.264 + AAC, xuất TXT riêng; decode đầy đủ, mean−24,9dB/peak−7,7dB, preview bản đóng gói seek đúng1/7/14giây; số liệu âm thanh lưu trong evidence. Probe clone đầu tiên bị chặn đúng vì cache scoped theo project ID cũ; sửa dữ liệu QA bằng lựa chọn clip/ảnh Library rõ ràng rồi dựng, không đổi engine hoặc bỏ guard. Video Fashion cũ và mọi asset giữ nguyên.

Theo yêu cầu mới của anh, native Muse refresh quota/cookie của cả sáu account đang bật lúc00:35–00:39: Tour/số6 tuần100%, top-up0; số7/9/10/11 tuần0%, số8 tuần28%, mỗi account mới còn2tỷ top-up. Cả sáu cookie check hiện tại ok. 1–5 vẫn tắt, quota cũ không được gọi là vừa kiểm.

Kiểm quyền video thực tế01:14–01:28: dùng đúng profile và proxy sẵn có của native Muse, gửi **một** yêu cầu clip ngắn vào side-chat sở hữu ở số7/9/10/11. Số8 hiển thị đúng lượt Mai spoken Fashion trước đó cùng refusal, không gửi lại. **Cả năm đều được provider trả thông báo không có video generation theo quốc gia/khu vực, không có clip mới.** Không suy ra còn token là tạo video được, không coi lời model là một chẩn đoán entitlement/backend độc lập. Bằng chứng từng account và thread ID ở `evidence/muse-video-account-probes.json`, PNG tương ứng. Không bật lại1–5, không đổi enabled/proxy/concurrency, không retry cùng lượt hoặc fallback ảnh. Đã thả hold7–11, kiểm lại giao diện01:32 không còn Chrome/busy hold, đóng RDP; không có credential/cookie/proxy-secret được chuyển.


Kiểm hồi quy: toàn bộ407 test trên macOS ARM64 và407 trên Linux ARM64, không fail/cancel/skip. Bao gồm intake/parser/HTTP ảnh, planning/director, product-aware QC/repair, cached stage/render, voice fitting/volume, SRT timing/ASR, Film/Series, cancel/retry/admission/no-duplicate, media decode/mix/ranges, Store/protocol/security/update. Các provider chưa cấu hình vẫn không được ghi là đã chạy live. Bộ browser mới có năm ca RED→GREEN cho in-flight declared/chunked bound, late abort, rejected extension/URL; fresh menu và legacy resume vẫn qua. UI phát hiện và sửa nhãn slider, nút speech khi bật dub, source lỗi bị giấu, tab phụ mất điều hướng và khung chọn0shot chiếm chỗ.

Hai vòng UI **mỗi OS**, mỗi vòng1.000 draft, 11style×3host form matrix, đầy đủ pipeline qua HTTP kiểm soát → 4ảnh/4clip/8assessment → MP4+TXT/FFmpeg thật. Kiểm desktop1440×900/mobile390×844, VI/EN và light/dark, điều hướng cả12 trang, không tràn ngang; xem screenshot thực. Chọn shot khác vẫn tạo riêng đúng cảnh, hủy/thử lại tái dùng media, caption/post edit+review giữ clip, unknown hiện lý do, reopen không resubmit, legacy15refs render không ép save, source missing sửa không cần JSON. Chỉ form/fixture coverage, không gọi là33 tổ hợp live. Bản mac đóng gói còn mở dự án thật và chụp bốn viewport/theme với ảnh thực.

Linux QA lần đầu thiếu mount `scripts/check-docs.js` (404pass/1 môi trường lỗi); gắn đúng file, kiểm riêng rồi chạy lại toàn bộ405/405; sau bổ sung hai wording refusal, full suite cuối đạt407/407. GUI container64MiB `/dev/shm` từng crash khi đổi trang; hai vòng lặp lại với512MiB qua, giữ log lỗi và không sửa sản phẩm để né test. Đây là coverage Xvfb/container, chưa phải bare-metal/Wayland. macOS dùng userData QA/`--use-mock-keychain`, chưa chứng nhận ACL/keystore thật.

Artifact dev ở `Downloads/MaiStudio-interface-dev-20261116/`: mac-arm64/MaiStudio.app (ad-hoc), Linux ARM64 unpacked + tar.gz. Đối chiếu63 file core/electron/UI và các trường package name/version/main/dependencies với dist; electron-builder chuẩn hóa package.json nên không so byte thô toàn file metadata. Reviewer UI không còn P1/P2 ở phạm vi đọc; hai P2 download được sửa và kiểm browser thật. Parent đã đọc actual diff và kiểm nguồn đóng băng. Reuse Store/Queue, stage toolbar, status/field/modal, VoiceTools, IntegrationClient, FFmpeg và Playwright; **không thêm dependency**, không refactor ngoài scope, không push/deploy/migrate/release.

```text
make build: Build succeeded
make test (macOS ARM64): 407 pass, 0 fail/cancelled/skipped
Linux ARM64 full suite: 407 pass, 0 fail/cancelled/skipped
make lint: exit 0, zero warnings
docs-check: OK
UI: 2 rounds macOS + 2 rounds packaged Linux ARM64
```

Còn mở: clip mới có lời và so cùng brief với Muse bằng account đủ quyền; VoiceTube live/auto-match voice, sửa mô tả cảnh bằng instruction AI như native, native transition/adaptive timing, mọi kiểu/host/ngôn ngữ/ngành hàng live, macOS Intel/Linux x64 và bare-metal/installer/notarization. Không dùng số test, preset hoặc nhạc thành công để tuyên bố “tốt bằng Muse”.

# Nghiệm thu bản dev MaiStudio 0.1.0

## Affiliate sau nhập Shopee — dev 16/11/2026

Đã nối luồng riêng cho dự án bật `data.affiliate`: 11 kiểu review/story/problem/unbox/howto/top3/fashion/snack/lookbook/asmr/pov, ba host modes presenter/voiceover/silent, ngân sách 15/30/45/60 giây, 16 ngôn ngữ và các lựa chọn hook/tư thế/tuổi/giới/giọng vùng. Hỗ trợ ảnh người mẫu/bối cảnh, 1–4 outfit cho lookbook, sửa caption/chuyển cảnh/copy; lập kịch bản theo từng kiểu, review facts/structure/host độc lập, tạo ảnh có nguồn sản phẩm, I2V một anchor, review sản phẩm/nhân vật và chuyển động, sửa cảnh fail trong giới hạn, dựng caption/giá/CTA/nhãn/endcard và xuất MP4 + TXT. Tái dùng Store/Queue, browser admission/checkpoint, native narration, FFmpeg, card renderer và UI hiện có; không thêm dependency.

Đối chiếu đọc-only gồm Affiliate source Muse 1.13.12 và options/project/video-scene metadata Muse 1.13.18 trên VPS. Có 11 kiểu/ba host, cách đếm cảnh, settings và trường review/caption/outfit/beat thực; recipe prompt remote chưa thu được. Prompt Mai được viết độc lập. Lượt này không có video Muse mới cùng brief/sản phẩm để so trực tiếp, không xem coverage lựa chọn là chứng minh chất lượng ngang Muse.

**Lượt provider thật:** dự án `b973c9f6-6f91-41af-aa86-4eecc3d041a4`, Fashion/silent, nam trẻ mặc áo đen, 15 giây, từ product/ảnh Shopee đã nhập mới. Một plan và review độc lập pass; tạo một người mẫu, bốn ảnh cảnh và bốn clip; cả bốn image review (gồm product) và bốn sampled-video review pass ở take đầu. Đã xem ảnh/khung hình thực: đi tới, xoay nửa người, kéo nhẹ tay áo/chất vải, trở lại toàn thân; giữ áo đen/họa tiết/logo nguồn. Không nhạc vì Library không có audio, nên beatSync ghi unchanged, không giả nhận đã căn beat. Silent đúng brief, không audio stream. Không kết luận toàn bộ video từ bốn frame đánh giá mô hình.

Kiểm trực quan lần đầu phát hiện caption chồng lên endcard và libass `Alignment=8` thực là giữa theo SSA. Hai regression probes RED→GREEN kiểm mốc caption dừng ở giây 13 và vị trí chữ trong frame RGB thật; Sau khi kiểm preview mobile thật, tiếp tục chuyển caption xuống vùng dưới thân người, giữ vùng riêng cho phụ đề lời và footer compact 14%, tránh che mặt/ngực áo; kiểm RGB/alpha thật cho cả ba vùng, gồm footer đủ năm tỷ lệ ở kích thước nhỏ; footer tự giảm padding/font theo kích thước, card legacy giữ nguyên. Caption dừng trước endcard, card dùng tiêu đề ngắn đã review. Dựng lại bằng đúng bốn clip, không mua thêm media/provider. File cuối `Downloads/MaiStudio-affiliate-dev-20261116/evidence/affiliate-fashion-15s.mp4`: H.264 1080×1920, 30fps, 450 frames/15 giây; decode toàn file exit 0. Copy đăng bài có nguồn giá/ngày, CTA/link/hashtags và nhãn đã chọn, không tự đăng.

Review code độc lập phát hiện hai lỗi biên; đã tái hiện rồi sửa: caption ASMR/POV đang chỉnh phải ưu tiên hơn caption plan cũ, và tổng 15 reference phải tính cả người mẫu tự tạo trước lưu/nhận job. Test kiểm 15 ảnh + auto host bị chặn trước queue, 14 ảnh hợp lệ, presenter đã chọn được deduplicate; giữ render thủ công provider-free. UI không save thừa khi dựng dự án chưa chỉnh, nên dự án cũ vượt giới hạn generation mới vẫn dựng từ output được; thêm ca UI legacy 15 ảnh chạy thật, không gọi provider. Các test và stress mới cũng giữ sửa caption/post đã lưu qua review-only, không viết lại hoặc tạo media trùng.

Hai vòng UI trên macOS và hai vòng trên **artifact Linux ARM64** trong container có Electron/Chromium sandbox, Xvfb: mỗi vòng 1.000 draft, đủ lựa chọn 11×3, thực hiện queue→plan/source review→bốn ảnh→bốn clip→tám media assessments→FFmpeg MP4/TXT với provider HTTP kiểm soát. Kiểm cancel/retry/cache, edit/review giữ media, unknown dừng, đóng/mở không resubmit; desktop 1440×900/mobile 390×844 × Việt/Anh × light/dark, không overflow hay lỗi renderer. Đây là kiểm engine/UI với fixture, tách khỏi lượt live trên.

Bản mac đóng gói còn kiểm preview video thật tại bốn viewport/theme, giữ năm profile và project Shopee gốc 7/7 ảnh. Hồi quy tự động kiểm Shopee parser/capture/CSV/JSON, API signing fixtures, browser admission/cancel, phim/series/SRT/Dub cũ, narration/acoustic/ASR/quality repair, media/security/store/queue/license/update. Không coi test fixture cho các provider là nghiệm thu live.

Artifact dev: `Downloads/MaiStudio-affiliate-dev-20261116/mac-arm64/MaiStudio.app` và `linux-arm64-unpacked/`. Bằng chứng `live-run.json` (all-stage), `live-render.json` (render-only/preview), `fashion-contact-sheet.jpg`, `affiliate-caption.txt`, REA bundle, QA logs và UI reports/screenshots lưu cạnh artifact. Không push/release/triển khai production, không sửa dữ liệu sản phẩm gốc hoặc xóa output cũ.

```text
make build: Build succeeded
make test: 388 tests, 388 pass, 0 fail/cancelled/skipped
make lint: exit 0, zero warnings
node scripts/check-docs.js: docs-check: OK
Linux ARM64 Affiliate core/integration: 38 tests, 38 pass, 0 fail/cancelled/skipped
Linux ARM64 text safe-area regressions: 3 tests, 3 pass
macOS UI stress: rounds 1/2 PASS; 1000 drafts per round; desktop/mobile, vi/en, light/dark
Packaged Linux ARM64 UI stress: rounds 1/2 PASS; same checks
Packaged macOS actual video: 4 viewport/theme playbacks, no renderer errors
macOS/Linux ASAR modules: match current compiled source; mac codesign verify: exit 0
Final MP4 decode: 450 frames, 15s, 1080x1920, 30fps, exit 0
```

Giới hạn: live mới có Fashion/silent và một sản phẩm áo; chưa nghiệm thu live đủ kiểu/host, lời nói/16 ngôn ngữ, ngành hàng, nhạc auto, mọi model/provider hoặc so sánh mới cùng Muse. Linux ARM64 kiểm artifact trong container, chưa bare-metal/keyring người dùng hoặc Linux x64; mac ad-hoc chưa notarize. Film/SRT giữ hoạt động cũ, chưa mở thêm phạm vi trong lượt này.

## Shopee Affiliate intake dev — 16/11/2026

Anh đã chạy bookmarklet trong Chrome thường trên trang sản phẩm và nhập qua bản MaiStudio đóng gói. Task `b0120e79-d0c4-4653-96d0-ecd7cff7535d` succeeded một lần, tải và giải mã 7/7 ảnh gallery thật vào Library. Shop/item khớp link `https://shopee.vn/product/261487657/44102644150`; giữ tên/mô tả, giá nguồn `112.686₫ – 120.000₫`, 9 thuộc tính, 8 tổ hợp model thuộc 2 nhóm màu/size, rating và shop. capturedAt `2026-11-16T09:47:36.686Z` tách khỏi importedAt. Nguồn lần này không cung cấp sold, UI đánh dấu thiếu; không lấy số 0 từ mẫu lịch sử để thay vào.

Đối chiếu contract Muse: đã đọc source bookmarklet bản 1.13.12 và metadata/options đang chạy 1.13.18 trên VPS. Hai đường API chính thức/capture Chrome được nối vào MaiStudio; parser nhận cả envelope capture cũ. Một kiểm tra riêng dùng metadata Muse cũ tải/giải mã 8/8 ảnh CDN hiện tại, giữ timestamp cũ và được ghi rõ là historical, không gán cho lượt đọc trang mới. Dữ liệu và ảnh từ lần nhập mới nằm trong `Downloads/MaiStudio-shopee-dev-20261116/evidence/fresh-import.json`, `fresh-page-capture.json`; kiểm tra historical/CDN nằm riêng `cdn-import.json`.

Kiểm hồi quy bao gồm CSV/JSON batch, raw API Shopee/chữ ký, cancel/retry/checkpoint, các pipeline cũ, review/sửa chất lượng, render/media/protocol, browser admission và bảo vệ sửa dự án trong lúc import. 15 ca Shopee kiểm parser/link/giới hạn/tải ảnh thật qua HTTP có kiểm soát và decode FFmpeg, mất/một phần ảnh, hủy/tiếp tục không tải trùng và không ghi đè thay đổi mới; hai ca chạy Chrome thật trên trang kiểm soát để kiểm cache-only/product-only, loại sản phẩm gợi ý và fallback giá hiển thị gần tên. Cache miss không gửi mới authenticated product request.

Hai vòng stress, mỗi vòng 1.000 draft tasks: mở link/copy mã, nhập thật qua queue/Store/FFmpeg với HTTP kiểm soát, báo ảnh lỗi, hủy giữ product cũ, retry tái dùng checkpoint ảnh, đóng mở không resubmit. Mỗi vòng kiểm desktop 1440×900/mobile 390×844, light/dark, không tràn ngang, không lỗi renderer. Kịch bản kiểm tra đã xác nhận cả hộp thoại Retry; lỗi selector/synchronization trong script QA trước đó được sửa, không bỏ assertion hay bỏ xác nhận của sản phẩm.

Bản dev riêng: `Downloads/MaiStudio-shopee-dev-20261116/mac-arm64/MaiStudio.app`; dùng lại userData QA và giữ 5 profile anh đã đăng nhập. Không thay bản phát hành hay cấu hình VPS. Reuse Store/Queue/parser/UI/desktop actions/FFmpeg và Node URL/fetch/fs, không thêm dependency. Chỉ bổ sung module intake và các điểm nối cần thiết; không sửa engine video cũ để làm chức năng này.

```text
make build: Build succeeded
make test: 347 tests, 347 pass, 0 fail/cancelled/skipped
make lint: exit 0, zero warnings
node scripts/check-docs.js: docs-check: OK
Shopee Linux ARM64 core/container: 13 tests, 13 pass, 0 fail/cancelled/skipped
Shopee UI stress rounds 1/2: PASS; 1000 drafts each; desktop/mobile, light/dark
Fresh operator capture: 7/7 images imported; all 7 stored images decoded again in renderer
```

Giới hạn nghiệm thu: đã có một sản phẩm Shopee VN mới qua cache đang mở; chưa phải mọi ngành hàng/link rút gọn hay mọi layout Shopee. API chính thức mới kiểm chữ ký/contract bằng HTTP fixture, chưa có entitlement live. Linux ARM64 kiểm core trong container, chưa chạy UI/Chrome/Keychain Linux thật; bản mac ad-hoc chưa notarize. Chưa nghiệm thu đủ 11 kiểu Affiliate/3 host modes; thứ tự tiếp theo vẫn Affiliate → Film → SRT.

## Quality workflow dev — 16/11/2026

Đã tạo video AI mới bằng luồng MaiStudio có review/sửa thật: ba ảnh cảnh, ba clip ban đầu, review ảnh và bốn frame/clip trong đúng khoảng dùng khi dựng. Cảnh 2 fail vì có vai/tay áo người thứ hai ngoài bố cục đã yêu cầu. Một vòng sửa tạo lại riêng ảnh cảnh 2 và clip phụ thuộc; cảnh 1/3 giữ nguyên, review không đổi được tái sử dụng. Sau đó cả ba image/video review pass, render 1920×1080/30fps dài 13,266667 giây, không âm theo brief; giải mã toàn bộ exit 0. Take theo cảnh là 1/2/1, không sửa kịch bản/timecode và giữ media cũ. Đây là bằng chứng luồng hoạt động, không phải chứng nhận mọi đánh giá mô hình đều chính xác.

Cặp A/B trong MaiStudio: cùng tài khoản mới, cùng một ảnh nguồn Muse đã xác minh, cùng tỷ lệ; một clip dùng prompt gốc đã quan sát, một clip dùng prompt Mai mới. Không tạo lại chọn mẫu cho cặp thử. Đã xuất hai raw clip và bản ghép 4,375 giây, prompt gốc trái/Mai phải, bỏ âm để xem chuyển động. Một cặp ngẫu nhiên và model identity không lộ không chứng minh nguyên nhân hay chất lượng tổng thể ngang Muse.

Tài khoản QA cũ trả thông báo hết usage; anh đăng nhập lại, tạo plan bằng TK 02 thành công. Hai stage chưa gửi remote đã dừng do kiểm composer quá sớm sau mở profile; retry đúng task khi ô nhập hiện đã chạy được. Đã sửa readiness chung cho plan/media: chờ tối đa 15 giây, hủy trước admission không gửi request. Ca tái hiện trang hydrate 600ms RED→GREEN, cả plan và image; hủy trong lúc chờ cũng được kiểm. Editor merge field đã sửa vào state mới nhất để không mất production/review vừa tạo.

Kiểm lại Muse trên VPS thấy phiên bản 1.13.18 (khác audit cũ 1.13.12), sáu tài khoản đang bật do anh cấu hình. Dự án thử riêng MaiStudioQuality-TeaStory-20261116 nhận plan một lần rồi báo không có khung chat sau 60 giây; browser tài khoản 6 hiển thị Something went wrong. Chưa có ảnh/clip mới từ lần này. Đã thả hold account 6 do phiên kiểm tra tạo; không thay enabled/proxy/concurrency của anh. Các video Muse cũ giữ nguyên, không gán kết quả cũ cho bản mới.

```text
make build: Build succeeded
make test: 332 tests, 332 pass, 0 fail/cancelled/skipped
make lint: exit 0, zero warnings
Linux ARM64 (Node 24.22.3, container): 77 tests, 77 pass, 0 fail/cancelled/skipped
Quality UI stress rounds 1/2: 1000 draft tasks each; real sampled frame bytes through controlled vision HTTP
Each round: desktop1440x900/mobile390x844, light/dark, no horizontal overflow, 0 renderer errors
Existing UI regression rounds 1/2: plan, selected/force images, review-only, stale association, music, preview, CPU render, WAV, CSV, product refs, local model cancel
Actual packaged new live video: 4 viewport/theme playback checks, 12 seeks, 0 renderer errors
node scripts/check-docs.js: docs-check: OK
```

Nguồn/bằng chứng: `/private/tmp/mai-studio-quality-upgrade/` (logs và stress), Downloads/MaiStudio-quality-comparison-20261116 (run.json, quality-report.json, raw A/B clips và mai-quality-tea-story.mp4), Downloads/MaiStudio-quality-dev-20261116 (app ARM64 và verification.json). Tái sử dụng Queue/Store/BrowserManager, MediaTools/FFmpeg, provider vision, React components/tokens; không thêm dependency. Bản dev riêng, không push/release/deploy. Linux mới chỉ kiểm nhóm core chất lượng; chưa đóng gói/GUI nghiệm thu lại với thay đổi này. macOS Intel và keystore/notarization thực chưa kiểm lại.


## Bổ sung ngày 16/11/2026 — đối chiếu live và preview

Anh đã chấp nhận chất lượng bản dựng 40 giây dùng tư liệu Muse và cho phép bài thử live trà quán 3 cảnh trên cả hai app. Tài khoản MaiStudio đăng nhập riêng; không chép cookie/profile hoặc thay cấu hình bản gốc. MaiStudio đã hoàn tất plan, 2 ảnh nhân vật, 3 ảnh cảnh, 3 clip mới 10 giây và render 1920×1080/30fps dài 13,266667 giây. Bốn cue Unicode/mốc phân số giữ nguyên; giải mã toàn bộ video qua. Đây là tạo AI mới, khác các probe render từ source media cũ. Review ảnh/clip cho thấy cùng nhân vật/trang phục/bối cảnh; continuity đạo cụ và ý nghĩa âm thanh còn cần nghe/xem đối chiếu, chưa kết luận chất lượng bằng Muse.

Muse project riêng MaiStudioCompare-TeaStory đã xong plan/2 refs/3 ảnh và bắt đầu clips một lần. Sau đó RDP ngắt; kết nối lại và TCP3389 đều timeout, chưa lấy được kết quả cuối. Không gửi lại job hoặc ghi nhận ảnh desktop lưu cũ là tiến độ mới.

Các probe khác: SRT ảnh/clip, film có thẻ đầu/cuối, fashion dựng 16 clip áo, series có 2 output và project con riêng, reopen không tự submit, thiếu media không tạo output. Đây là kiểm chức năng kỹ thuật, chưa phải chứng nhận toàn quy trình AI từng kiểu. Bài SRT cùng 4 cue cho thấy Muse gom 3 cảnh/13,25 giây, Mai mặc định giữ 4 cue/12,75 giây; groupNarration hiện có khớp chính xác khi chuẩn bị thủ công, UI import mặc định vẫn khác. Bảy clip source giày có cùng hash và hình mascot được loại khỏi dữ liệu chất lượng thành công. QC bật với clip sai cần waiting_input, không tạo output.

Preview thật phát hiện tua 1/7,5/11,5 giây đều về 0 dù buffer đủ file; seekable chỉ [0,0]. Electron file fetch đọc đúng phần byte nhưng trả 200 và thiếu Content-Length/Content-Range. Sửa duy nhất handler media dùng Node stream/metadata đúng; giữ URI/GET/Store validation/CSP. Test byte range đóng/mở/suffix/clamp, sai range, abort và directory qua; gói app mới chạy 12 lượt tua trên bốn viewport/theme không lỗi renderer/tràn ngang. Kết quả smoke ngắn trước đây không chứng nhận được hành vi tua trên video thật này.

Bằng chứng nằm ở Downloads/MaiStudio-parallel-tests-20261116 (comparison.json, mai-results.json, quality-guard.json, outputs/live/player-report.json và video mai-tea-story.mp4); gói sửa preview riêng Downloads/MaiStudio-player-dev-20261116. App cũ của anh không thay thế. Chỉ gói dev ARM64 ký ad-hoc, không notarized; Linux chưa đóng gói lại với composer/range fixes. Bốn compiled module trong ASAR khớp dist, codesign verify qua. Không thêm dependency.

```text
make build: Build succeeded
make test: 303 tests, 303 pass, 0 fail/cancelled/skipped
make lint: exit 0, zero warnings
node scripts/check-docs.js: docs-check: OK
Stress1: 1000 tasks = 980 succeeded + 20 cancelled; peak2; queue6436ms
Stress2: 1000 tasks = 874 succeeded + 75 intentional429 failed + 51 cancelled; peak2; queue10923ms
Each stress round: desktop1440x900/mobile390x844, light/dark, no renderer errors or horizontal overflow; reopen/no resubmit checked
Packaged live-video player: 4 viewport/theme checks, 12 seeks passed
```

Regression suite kiểm queue/admission/retry/cancel, persistence, composer/ref/download, real FFmpeg gap/trim/fade/subtitle/music/cards, series và quality guards; probe thực tế kiểm SRT/fashion/film/series như trên. Các bài fixture không thay thế native keystore, mọi provider/OS hoặc chất lượng Muse live.

## Mốc lịch sử 14/11/2026

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

## Bổ sung runtime VPS và sửa composer — 15–16/11/2026

Phạm vi mới do anh cho phép: quan sát Muse Studio 1.13.12 đang chạy trên VPS Windows và lấy video/clip nguồn của dự án affiliate. Báo cáo parity ghi rõ phạm vi GUI/DOM đã quan sát; không mở rộng thành chứng nhận Windows của MaiStudio hoặc provider live. Không đọc/chuyển profile, credential/cookie, không gửi job AI. Đã thả account 1 khỏi phiên Treo trình duyệt do em mở, giữ nguyên account 4 đang tắt, đóng PowerShell/DevTools của đợt kiểm và disconnect RDP; không restart Muse hay dịch vụ của anh.

Hai lỗi tương thích tái hiện được: mặc định chỉ tìm contenteditable trong khi live dùng textarea; `completeText` đòi nút Send trước khi điền prompt, nhưng live chỉ hiện Send khi có nội dung. Sửa tại Store/default settings đọc và prefill gate của BrowserManager, giữ custom selectors, không migrate schema hoặc ghi vào database của Muse. Bảy kiểm tra chọn lọc RED→GREEN; sáu ca mới tăng suite từ 296 lên 302. Kiểm lại các hành vi đang có: upload/ref readiness, Unicode, reply mới hoàn tất, resume không submit trùng, admission trước click, cancel/navigation/stream, response/checkpoint limits, media/download và custom selectors. Toàn bộ suite còn bao gồm persistence/queue/media/ASR/planning/series/dub/update/security; không dùng đó để suy rộng sang provider thật.

```text
make build: Build succeeded
make test: 302 tests, 302 pass, 0 fail, 0 cancelled, 0 skipped
make lint: exit 0, zero warnings
node scripts/check-docs.js: docs-check: OK
selected RED: 0 pass / 7 fail; selected GREEN: 7 pass / 0 fail
```

Rà diff độc lập không thấy lỗi code khác trong phạm vi; phát hiện một docs-check marker dạng chuỗi không được checker hỗ trợ, đã bỏ marker sai và chạy checker sạch. Tái dùng Store/BrowserManager và fixture có sẵn, không thêm dependency vào sản phẩm; thay đổi runtime chỉ 8 dòng thêm/3 dòng bỏ, không thêm abstraction hoặc UI.

| Vòng | Batch | Thành công | Lỗi cố ý 429 | Hủy | Đỉnh concurrency | Queue ms | RSS mẫu cuối |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1.000 | 980 | 0 | 20 | 2 | 5.434 | 296.697.856 bytes |
| 2 | 1.000 | 877 | 72 | 51 | 2 | 10.435 | 277.790.720 bytes |

Hai vòng Electron thật dùng provider loopback fixture, gồm hủy một request đang chạy, desktop 1440×900/mobile 390×844, light/dark, cả 12 màn hình điều hướng, primary Create & run và episode form. Không tràn ngang/renderer error; reopen giữ đủ task/asset và không thêm request. Đã xem bốn ảnh đại diện của cả hai vòng và cả hai viewport/theme. Không gọi số failed chủ đích là task thành công, RSS không phải peak.

Video original `MuseStudio-affiliate-reference-20261115/muse-original.mp4`: 39,646 giây, 1080×1920/24 fps, bytes/SHA-256 khớp Windows. 16 clip tên chuẩn + nhạc + ảnh host đối chiếu 18/18 hashes/sizes. Bản thử `MaiStudio-affiliate-rebuild-20261116/lookbook-comparison.mp4` dùng queue `studio.run(stage=render)` và `dub` thực của MaiStudio để dựng 16×2,5 giây, caption thủ công và nhạc nguồn giảm 6 dB/fade, H.264/AAC 1080×1920/24 fps, 40 giây; full decode qua, mean −19,6 dB / peak −4,9 dB. Đây là thử phần dựng bằng clip do Muse tạo, không phải video mới tự động từ đầu của MaiStudio; không chứng nhận lựa chọn clip/nhịp dựng giống original, host/product continuity hoặc chất lượng ngang Muse. Giữ kết quả demo ảnh tĩnh trước đó là QUALITY_REJECTED.

Player bản dựng kiểm tám lượt (hai vòng desktop/mobile sáng/tối), 40 lần seek rồi play và đọc pixel canvas xác nhận frame có hình, không chỉ metadata/seeked; không lỗi JS/overflow. HTTP video fixture hỗ trợ Range/206 và CORS cho kiểm pixel; không coi đó là xác minh byte-range của custom studio-media protocol.

macOS ARM64 đã đóng gói lại dev 0.2.0-dev.1 ở `MaiStudio-composer-dev-20261116/MaiStudio.app`. Module `store.js` và `browser.js` trong ASAR khớp SHA compiled source, codesign ad-hoc verify qua. Gói thật chạy với userData riêng và mock Keychain: đọc đúng textarea/default, account.check ready, submit ảnh fixture đúng một lần và tải PNG qua queue, admission checkpoint, legacy default sau reopen, không submit thêm; bốn viewport/theme không tràn ngang hoặc renderer error. Không sửa app đang mở/userData của anh. Chưa kiểm native Keychain/Gatekeeper/notarization/update; không đóng gói lại Linux hoặc macOS Intel cho bản sửa này.

Log/checkpoint/screenshot: `/private/tmp/mai-studio-vps-audit/`. Dự án thử riêng và `render-report.json` đi cùng video trong Downloads; `verification.json`/SHA ASAR đi cùng app mới. Artefact cũ vẫn giữ nguyên. Bộ kiểm chứng không phải chứng nhận full quality parity hoặc lượt tạo ảnh/video thật bằng provider Muse.
