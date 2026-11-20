# P1 — MuseStudio reconstruction and functional parity gaps

## Shopee product intake — 2026-11-16

The first Affiliate dependency now has a verified fresh operator run: the normal-Chrome capture bookmark was used on the loaded Shopee Vietnam product, then the packaged MaiStudio UI imported matching product identity, source price/description, 9 attributes, 8 SKU combinations in 2 variation groups and 7/7 decoded gallery images into Library. Missing sold remains unavailable. Saved native metadata was used only for a separately labelled historical/CDN check; it is not the fresh source. Official API and legacy capture envelopes remain compatible. Cancellable image checkpoints, partial-source warnings and concurrent-edit protection are covered in core and two desktop/mobile light/dark stress rounds.

This closes the demonstrated one-product browser-capture/import path, not universal scraping or Affiliate video parity. Official API live credentials, other Shopee layouts/categories and Linux desktop acceptance remain unverified. All 11 Affiliate styles and 3 host modes still precede Film and SRT work. Exact reports/artifact/source-time limits are recorded in acceptance.md and SYSTEM_DOCUMENTATION.md.

## Quality workflow runtime — 2026-11-16

Mai now uses independently assembled visual/action/acting/camera/environment prompts and one scene anchor for pipeline I2V. New AI plans enable review with one bounded repair by default (max two); explicit old opt-outs survive. Four decoded frames from the edited interval are reviewed with retained reasons/assets, unknown pauses, failed generated scenes may repair, unchanged reviews are reused and exhausted tasks retain the best assessed take. Render-only remains provider-free; legacy prompt-only shots retain their action. No provider recipe source was copied.

Live same-account/same-image prompt A/B completed without regeneration selection. Full three-shot live Mai workflow caught an extra-person image error, repaired only shot2 and its video, reused shot1/3 reviews, then passed all recorded image/video checks and rendered 13.266667s1080p30. This establishes bounded repair and actual frame review, not an overall artistic parity guarantee. Evidence and 332 macOS/77 Linux ARM64 test results are in acceptance and Downloads/MaiStudio-quality-comparison-20261116.

VPS native app was upgraded by the operator to Muse Studio1.13.18. Its new owned SRT project plan failed waiting60s for the composer; held account6 showed the provider error page, then the owned hold was released. No new native image/video from that attempt; prior1.13.12 evidence is historical. Enabled accounts/proxies/concurrency were preserved. Latest native full-workflow comparison remains unresolved.


## Runtime checkpoint — 2026-11-16

Accepted baseline: operator approved the 40s edit using Muse source footage, not overall parity. Authorized live tea-house comparison: Mai completed planning, 2 character refs, 3 scene images, 3 new clips and a 13.266667s 1080p30 render with original four cue clocks. Muse completed planning/refs/images and started clips once; RDP disconnected and reconnect/TCP3389 timed out, so final original result remains unobserved. New AI content is explicitly separate from imported-media render probes.

Default SRT import still differs: Muse groups four cues into three visual shots lasting13.25s; Mai retains four cue slots lasting12.75s. Existing groupNarration matches the original groups when manually prepared; this does not certify the default UI workflow. Film/cards, fashion imported-clips, two-episode series, missing media, reopen and quality-guard probes establish technical behavior only. Wrong-product mascot clips are not quality-success fixtures. Prop/audio semantics and other live style comparisons remain open.

Actual packaged Mai video seeking failed at1/7.5/11.5s despite full buffering. Root cause observed in Electron file fetch: partial body with status200 and no range metadata. The shared protocol now streams with206/Content-Range/length or416 for invalid single ranges, preserving Store/URI/GET guards and CSP. Unit range cases and12 actual packaged seeks at desktop/mobile light/dark pass; earlier short player smoke did not establish this behavior. New macOS ARM64 dev artifact is separate; existing Linux artifacts do not contain these composer/media corrections.

## Historical static checkpoint

Date: 2026-11-14. Status: static source-contract extraction; **not a functional parity pass**.

Authorized scope: inspect original artifacts and the port; write this report and scratch evidence only. No EXE/app execution, provider calls, downloads, implementation, test edits, commit or deployment. Parent implementation is concurrent: port gaps below describe the initial inspection at HEAD `f041899baad82b109ed8001132fc6677818fb196`, when only the existing plan was dirty. Later parent edits are not assessed or reverted.

## Evidence and deliverables

### Runtime bổ sung — 15–16/11/2026, sau khi anh cấp VPS

Phạm vi đọc runtime mới được anh cho phép sau báo cáo tĩnh này. RDP quan sát Muse Studio 1.13.12 đang chạy trên Windows; phiên trình duyệt mở tạm bằng điều khiển Treo/Thả của ứng dụng gốc. Không chuyển credential/profile/cookie, không chạy job AI, không đổi proxy/concurrency, không restart ứng dụng hoặc service. Sau khảo sát đã thả trình duyệt tài khoản 1, đóng PowerShell/DevTools do em mở và disconnect; tài khoản 4 vẫn tắt như ban đầu. Đây là quan sát GUI/DOM qua RDP và Chrome DevTools; không mô tả công cụ REA là đã tự điều khiển Windows.

- Đã thấy dự án affiliate lookbook báo 16 cảnh, 16 ảnh, 16 clip. Video hoàn chỉnh gốc tải về có 33.962.693 bytes, SHA-256 `8f4415de4dcfa28e593531c633d55c67291fc1e79a91c94efcb227dc1cb511ae`, khớp Get-FileHash trên Windows; 39,646 giây, H.264 1080×1920/24 fps, AAC. Decode đầy đủ qua. Video gốc là sản phẩm của Muse; không gán cho MaiStudio. SRT bên cạnh chỉ có một cue ngắn, không chứng minh narration/khẩu hình đầy đủ.
- 16 clip tên chuẩn của cùng dự án (mỗi clip 10 giây), nhạc MP3 và ảnh host đã được sao chép; cả 18 file đối chiếu bytes/SHA-256 nguồn. Thư mục còn các biến thể clip/ảnh; bộ tên chuẩn không được chứng nhận là đúng toàn bộ biến thể mà video hoàn chỉnh gốc đã sử dụng.
- Probe chỉ lấy metadata DOM, không lấy nội dung hội thoại: trong `data-hatch-composer-root` là textarea, không có contenteditable=true; action slot rỗng khi chưa nhập. Một draft tự viết, không gửi, làm xuất hiện nút Send và được xóa trong finally. Đây là bằng chứng trực tiếp cho lỗi selector cũ và kiểm nút Send quá sớm của MaiStudio.
- Bản sửa dev giới hạn ở defaults/settings đọc và `completeText` prefill gate, giữ custom selectors và checkpoint trước click. Bảy ca tái hiện RED→GREEN, full suite 302/302, hai vòng stress được ghi trong acceptance. Chưa gửi prompt live từ MaiStudio sang provider, chưa kiểm completion marker/Stop bằng một lượt tính phí thật.
- Đối chiếu frontend gốc `web/app.js:4707–4725`: affiliate có host presenter/voiceover/silent, style riêng, lookbook có người mẫu dù host là voiceover, nhịp shot dựa trên giây và style. `src/core/planning.ts` hiện còn prompt film chung, phút mặc định 2 và tỷ lệ 16:9 khi không đặt. Bản sửa browser không khép khoảng cách lập kế hoạch/director, nhịp nhạc hoặc kiểm đồng nhất người mẫu/sản phẩm.

Bằng chứng riêng: `/private/tmp/mai-studio-vps-audit/transfer/{dom,fields,draft,media-manifest}.json`, log RED/GREEN/build/test/lint/docs và stress. Video/media gốc ở `/Users/maiychrus/Downloads/MuseStudio-affiliate-reference-20261115/`. Các giới hạn tĩnh/remote recipes bên dưới vẫn giữ nguyên; runtime này chỉ bổ sung phần đã quan sát.

Original root: `/Users/maiychrus/Downloads/MuseStudio-analysis-1.13.12/artifacts/`.
`P/` below means `PYZ.pyz/musestudio/`; `W/` means `musestudio/web/`. Python line numbers are recovered `co_firstlineno`/instruction positions in original filenames, **not lines in decompiled source**. JSON references preserve module/function and constant indices; instruction JSON adds bytecode offsets.

Scratch root: `/private/tmp/mai-studio-parity/`.

| File | Use |
| --- | --- |
| `planner-contract.json` | 21 observed recipe call contracts, caller field sets, exact authored defaults, retry/music prompt literals, story timing. Start here for parent planner/parser. |
| `asr-contract.json` | Offline ASR model identity, download/hash contract, tensors, QA fields, phrase alignment and separate speaker model. |
| `authored-literals.json` | Statically reconstructed literal assignments: SRT/film/series defaults and timing/limit dictionaries. |
| `<module>.constants.json` | Recursively recovered strings, original function/source/line, names; original artifact SHA-256. |
| `<module>.instructions.json` | Disassembly indexed by function, source line and offset. |
| `<module>.dis.txt` | Full `dis` text for the first nine surveyed modules. |
| `native-inventory.json` | All 12 shipped application `.pyd` paths, sizes, SHA-256 and selected native symbol strings. |
| `source-manifest.json` | Source identity and inspection scope, including the port baseline. |
| `verification.json` | Both static rounds, counts and explicit runtime exclusions. |

Used the supplied CPython 3.14.9 with `-I`, `marshal.loads(raw[16:])`, recursive code-object inspection and `dis`. No recovered code object was imported, called or executed. Literal reconstruction interprets only literal/container-building instructions; it does not invoke application functions. No dependency was installed. Configured global file-creation checklist was absent; the repo AGENTS records the same absence. Only the requested report is added to the repo.

## 1. Critical boundary: exact full planner prompts/schema are remote

**Observed:** `P/recipes.pyc`, module docstring and `_local_ref:117`, `_run_remote:194`, `call_many:240` explicitly move planner prompts and director rules to License Hub `/v1/recipe` from version 1.9.8. Frozen builds do not load local `recipes_ref`; no `recipes_ref` file exists in the supplied artifact tree. This is a bounded artifact finding, not proof about the vendor's source repository.

Transport is observable: request keys `product="musestudio"`, `device_id`, `app_version`, `auth`, `calls`; each call has `fn,args`. Response has `results`, each item consumed through `ok,value,error`. Batch size 40, timeout 45 seconds, response bound 32 MiB, 3 network attempts; connection retries wait `1.5*(attempt+1)` seconds and rate-limit retries 20 seconds. Results must match request count. None of this was called live.

**Unknown:** the full text of `srt.*`, `film.*`, `series.*` prompts; formal JSON Schema required/optional rules; server budgeting, coercion, synthetic fallback values and director algorithms. The client reveals producer/consumer field contracts, not the entire remote validator. These are recoverable interfaces to independently reimplement, not grounds to invent an “original schema”. Credentials alone do not put the missing implementation into the EXE.

Two exact prompt strings do remain locally:

- `P/srtvideo.pyc`, module `RETRY_TURN`: `Your previous answer was not valid. Reply again with ONLY the JSON object as requested, nothing else, no image.`
- `P/filmstudio.pyc`, module `MUSIC_NUDGE:120`: `Please go ahead now and create the instrumental background music as an MP3 audio file (no vocals). Do not ask questions.`

### Authored JSON example, without invented planner content

The following is an **excerpt of actual authored SRT settings defaults**, statically recovered from `P/srtvideo.pyc:65–83`. It is not a fictional AI response or a complete planner JSON Schema. The complete literal objects are in `authored-literals.json` and `planner-contract.json` (`DEFAULTS`:39 keys, `FILM_DEFAULTS`:57, `SERIES_DEFAULTS`:62).

```json
{
  "ratio": "16:9",
  "shot_sec": 3.2,
  "mode": "slide",
  "source": "srt",
  "plan_threads": 3,
  "max_refs": 3,
  "lang": "vi",
  "story_text": "",
  "story_voice": "",
  "narrator_voice": "",
  "narrator_speed": 1.0
}
```

No complete original planner response example/schema was present in the inspected constants. `planner-contract.json` deliberately labels its field sets as partial static contracts. `src/core/codex.ts:11` has a port-authored `PLAN_SCHEMA`; it is not evidence of Muse film/SRT schema.

## 2. Planner stages and exact observed boundaries

### SRT / idea / story

`P/srtvideo.pyc`, class **SrtStudio** (there is no supplied `srtstudio.pyc`):

| Source function/line | Observed contract |
| --- | --- |
| `write_script:1111` | For `minutes<=6`, `srt.script_turn(settings)` → prompt → Muse object with `lines` array and optional `title`. Keep string lines. Reject fewer than 3 resulting cues. |
| `write_script:1131–1145` | Longer stories: parts=`max(2,min(8,minutes//5))`; `srt.outline_turn(settings,parts)` → `title,parts`; for each part `srt.part_turn(settings,k,n,plan)` with one-based k, plan truncated to 600 chars, JSON key `lines`, `tries=2`. This path is distinct from story TTS. |
| `_ask_json:1100` | `_ask`, then `_json_objects`; accept dict only when the requested key is a list. Retry with exact `RETRY_TURN` within caller budget; return `None` if exhausted. |
| `plan:1163` | Join all cue texts into script; `srt.bible_turn(style,script)` → Muse candidate dict with truthy `characters`; `srt.clean_bible(raw,style)` supplies normalized bible. If no candidate after retries, clean `{}` and warn; existing character refs are retained by lowercased name. |
| `plan:1220–1224` | Index bible character/location IDs. Process only shots without `scene`; 25 shots per turn; threads clamp to 1–4 and batch count. Fresh Muse thread every 4 turns. |
| `plan.<locals>.run_batch:1237` | `srt.shots_turn(bible,items)`, where client literally builds each item with `id,start,end,text`; parse by ID; request only remaining IDs on the next of 2 attempts. |
| `aparse_shots_reply:267` | `reply_items(text)` → `srt.parse_shots(items)` → `recipes.int_keys`, converting JSON string keys to numeric shot IDs. Full server update/coercion rules are unknown. |
| `plan.<locals>.worker:1251` | After each batch, retain only known character IDs (first 3) and known location ID (else empty); save progress/shots. |
| `plan.<locals>.fallback:1230` | Missing shot gets `scene="A moment from the story: "+text`, guessed characters, empty location and `fallback=true`. Failures are visible warnings, not proof of a successful AI plan. |

`plan.<locals>.ask:1179` waits for composer (60,000 ms), records assistant count before sending, and waits for a new text reply with `TURN_TIMEOUT=600`. `_json_objects` is imported from native Muse code, so its exact extraction algorithm remains unknown.

`start:668` maps `all` to optional `script` (idea without cues) or `voice` (story without cues), then `plan → refs → images → [clips if mode=film] → render`. Individual `script/voice/plan/refs/images/clips/render/fix/fixclip` actions exist. In base SrtStudio, `continue` selects media stages; FilmStudio adds its own incomplete-script guard.

### Film

Current caller flow is **budget/bible → one scene turn at a time → review/verify → lint → media**. The opening docstring's “12 scenes per turn / one clip per scene” is historical; current `write_script` uses bible scenes with inclusive shot ranges `a..b`. Do not encode fixed batches of 12 from that comment.

| Recipe | Exact argument keys observed at call site | Consumed result |
| --- | --- | --- |
| `film.plan_turn` (`write_script:1161`) | `settings,style`; `own` only when nonempty; `series` only with series context | `budget.n,text`; optional `own` entries with `photo,src` |
| `film.plan_bible` (`:1179`) | `raw,settings,style`; optional `own` | `bible`; optional `pmap,recast`; bible requires truthy characters, accesses `title,characters,locations,scenes` |
| `film.scene_turn` (`:1210`) | `bible,k,settings,title,shots`; optional `script` | `text,in_scene,sides`; accumulated `shots` projected to `id,lines` |
| `film.parse_scenes` (`:1222`) | `items,bible,narrator` | Numeric-ID shot mapping, filtered to requested scene range |
| `film.missing_turn` (`:1228`) | `ids,k` | Prompt to fill missing IDs; empty parse uses `RETRY_TURN` instead |
| `film.scene_shots` (`:1231`) | `got,bible,scene,in_scene,pmap` | Shot list appended and **saved after each scene** |
| `film.scene_sides` (`:1239`) | `bible,shots` (`scene_ref,lines` projection) | Updated scene array |
| `film.review_turn` (`_review_script:1475`) | `bible,shots,lang` | Review prompt; `review_view:126` projects `id,type,scene_ref,lines,face,scene` |
| `film.review_apply` (`:1493`) | `obj,shots,bible,lang`; first pass also `hook=true` | `shots,issues,fixed`, optional `hook` |
| `film.verify_turn` (`:1508`) | `bible,shots,lang` | Follow-up review prompt; up to 2 verification rounds with outstanding issues/fixes |
| `film.cameras` (`write_script:1245`) | `shots` projection `type,camera,camera_manual` | Camera array zipped to shots; preserve manual camera |
| `film.lint` (`:1267`) | `bible,names,shots` projection `id,type,scene_ref,lines,characters` | Warnings, persisted under bible `lint` |

Sanitized `own` entries sent to recipes contain authored keys `kind,name,role,gender,age,note` plus **boolean** `photo`; actual uploaded photos are selected by returned `src` index and attached via `_ask_files:1429`. They are not arbitrary renderer paths.

Local normalization remains recoverable: `char_index:131`, `_who:142`, `clean_lines:154`, `fill_listeners:180` resolve names/aliases/IDs and narrator aliases. `clean_lines` accepts string lines or objects; text aliases `text/line/dialogue`, speaker aliases `speaker/character/name`, listener aliases `to/listener`, emotion aliases `emotion/delivery`. Output keys are `speaker,to,text`, optional `emotion`; text max 220 chars, emotion max 120. Invalid speaker falls back to a known character/narrator; self/narrator listener is cleared. **MAX_LINES=2 does not enforce 2 here:** loop breaks at `MAX_LINES+1` and returns up to 3 normalized lines. Server `film.parse_scenes` may impose other rules; those are unknown.

`use_script` preserves supplied dialogue using `split_script:562`, stored `script_parts`, `_keep_script_lines:1534`, `trim_vocatives:247` and `drop_new_lines:529`. Invented dialogue is removed; narrator preservation depends on `story_mode`. This is materially more than splitting paragraphs.

### Series

`P/seriesstudio.pyc`, `write_script:250`: preserve user-authored outlines (`src=user`, projected `n,title,summary,hook`); call `series.plan_turn(settings,style,given)` → `total,text`, then `series.plan_bible(raw,settings,style,given)` → `bible`, optional `recast`. Accessed bible fields include `title,characters,locations,episodes,dub_cast`. Existing refs match normalized names; `film_id` is retained by episode number and `dub_cast` survives replanning. Replanning after any child already has a script is guarded by `start:184`.

`start:184`: `all` adds script if not planned, then `refs → music → episodes`; `continue` runs media. `ensure_episode:310` reuses an existing film or creates a child film and persists `series_id,episode,film_id`; `run_episodes:365` runs sequentially, skips completed valid child outputs unless specifically selected, waits across child retries, and stops later episodes when one is incomplete.

Continuity is explicit: `episode_ctx:414` includes `episode,total,title,logline,question,summary,hook,previously,next,cast,places,props,address`; previous actual film summaries override outline summaries. `merge_cast:443` reuses look/voice/gender/age/side, valid refs, outfit refs, places, props and narrator voice; `cast_for:493` reuses VoiceTube choices across episodes.

`render_extras:523` and `_recap:551` implement episode cards, recap from eligible previous clips, next-episode teaser or final end card, shared music. Recap uses last up to 3 eligible shots with valid image/clip and matching QA speech metadata, max normal excerpt 4.5 seconds (dub path may extend), fade-in/out 0.3/0.4 seconds. These are functioning code paths in bytecode, not just feature names; runtime success remains unverified.

## 3. Story timing and real local speech contracts

`P/storyvoice.pyc` is pure Python algorithm code, not an opaque native engine. Module constants: `PIECE_MAX=220`, `PIECE_MIN=2`, `LEAD_IN=0.25`, `GAP_SENTENCE=0.35`, `GAP_CLAUSE=0.15`, `SNAP=0.5`, `MIN_CUE=0.6`.

- `split_story:40`: remove scene/chapter headers and bracketed stage directions; split sentence boundaries and then long clauses/word boundaries, skip tiny fragments. Recovered regex strings are preserved verbatim in constants JSON.
- `cues_from_durations:75`: use measured duration, minimum 0.3 seconds; start at 0.25; add sentence/clause gaps; round timing to milliseconds; cue text truncated to 300 chars; return `(cues, offsets, total)` with 0.4 seconds tail after accumulated clock.
- `SrtStudio._story_from_script:959`: select/rank real VoiceTube voice, check credit requirement, cache per-sentence WAV, bound concurrency, retain completed sentences on failure, measure actual WAV durations, build a single track at calculated offsets. Failure asks to retry missing sentences without paying again for cached ones. `voicetube.cache_key:451` includes voice, rounded speed, cleaned text and language suffix (non-vi); exact key string is in instructions.
- `_story_from_voice:1028`: FFmpeg → mono → `dubaudio.find_lines:64`; optional supplied script; for Vietnamese try local ASR per speech segment. Supplied script can align without recognized text; no supplied script plus no recognized text is an explicit error. It does not synthesize a transcript as success.
- `align_script:123`: proportional speech-clock allocation weighted by token count (fallback character count), optional ASR token matching with `difflib.SequenceMatcher(autojunk=False)`, interpolate unmatched sentences, snap boundaries within 0.5 seconds, keep monotonic cues with minimum 0.6 seconds.
- `_story_done:946` passes cues into `srt.group_shots:80`, stores combined voice metadata, resets bible, persists `scripted`. Existing media guard prevents silently replacing the narration/cues of a project that already generated images.

`P/srt.pyc`, `group_shots:80` groups cues by target duration (clamp 2–20 seconds; hard max target×1.6), sentence boundary, 1.2-second gap or closer-to-target next boundary; merges a short final group below target×0.4. Output has `id,cue_from,cue_to,start,text,end`, first shot starts at 0, next shot starts define previous ends, final end is last cue end+0.5. **One cue is not necessarily one shot.** Module prose “~5.4 seconds” is not the current settings default 3.2.

### ASR model: no invented remote voice checker

`P/speechcheck.pyc:29–39` defines:

- Model `sherpa-onnx-zipformer-vi-int8-2025-04-20` under `DATA_DIR/models/<model-name>`.
- Authored URL: `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-zipformer-vi-int8-2025-04-20.tar.bz2`; constant archive bytes 60,181,038. Docstring estimate “~77 MB” differs; do not use prose as exact size.
- Encoder `encoder-epoch-12-avg-8.int8.onnx`, decoder `decoder-epoch-12-avg-8.onnx`, joiner `joiner-epoch-12-avg-8.int8.onnx`, `tokens.txt`; exact authored per-file SHA-256 values are in `asr-contract.json`.
- `ensure_model:94`: lock, `.part` archive, copy only expected regular-file basenames into `.tmp`, SHA-256 verify before replace, check model readiness, remove temporary archive. Default timeout 60 seconds. No model was downloaded here.
- `_Recognizer:323`, `transcribe:344`: ONNX Runtime `CPUExecutionProvider`, NumPy fbank, 16 kHz mono normalized PCM, 0.3-second tail padding, greedy transducer with blank ID 0 and initial context `[0,0]`. Encoder inputs `x,x_lens`, decoder `y`, joiner `encoder_out,decoder_out`. Token output is **text**, not timing.
- `check_clip:447`: acoustic VAD/periodicity plus optional text recognition; observed result keys `engine,heard,match,extra,voiced,speech,f0,dur,issue,ok`, optional `parts,sv,stutter`. `MATCH_OK=.6`, `EXTRA_MAX=.8`, minimum voiced seconds `.6`; issues include `no_speech,wrong_text,extra,stutter,voice,partial`. VAD fallback cannot certify recognized text or speaker identity and still requires usable NumPy/FFmpeg.

`P/dubalign.pyc` is local phrase alignment, **not a model downloader/ASR backend**. `tts_phrases:99` derives real speech breaks near punctuation; `align:154` matches up to 8 phrases/side using duration cost with merge/drop penalties; output `src,at,tempo`. Authored limits: `TEMPO_MIN=.85`, `TEMPO_MAX=1.15`, `PAUSE_MIN=.07`, `MERGE_COST=.12`, `DROP_COST=.6`. Target mouth/speech parts come from `qa.parts`; VoiceTube word timestamps are explicitly rejected as evenly estimated. `render:195` assembles phrase-aligned audio.

Speaker identity is separate: `P/voicematch.pyc:33–51`, `ensure_voice_model:68`, `embed:117`, `voice_report:144`: WeSpeaker `wespeaker_en_voxceleb_resnet34.onnx`, 26,534,365 bytes, under `DATA_DIR/models/voice-id`; authored SHA-256 `5ef208a9da1453335308a6b6f4e6dfbd7e183a38b604de0a57664f45d257fe94`. URL and thresholds are in `asr-contract.json`; original URL spelling `speaker-recongition-models` is preserved. This is not gender-by-pitch alone. Model availability, numeric equivalence and recognition accuracy remain untested.

`FilmStudio.film_timeline:2478` uses probed real clip duration, cached speech metadata with version `SPEECH_VER=2` or acoustic recomputation, dialogue spans/phrase alignment, pace (`flow/drama/tight/full`) dependent lead/hold, and scene boundaries. It can retain native Muse dialogue, optionally replace with VoiceTube dub, polish audio and remap timing for speed. A fixed-duration generic image/video/TTS loop does not reproduce this.

## 4. Partial results, failure and resume

| Evidence | Behavior to retain or consciously improve |
| --- | --- |
| `srtvideo.reply_items:247`, `_salvage_shots:227` | Accept first nonempty `{<key>:[...]}` or top-level array yielded by native `_json_objects`; if unavailable, scan the requested array and `JSONDecoder.raw_decode` complete objects until truncated/invalid input. Preserve finished objects; do not reject the entire response for one cut-off tail. Full native `_json_objects` semantics remain unknown. |
| `SrtStudio.plan` nested workers | Persist each processed batch; only replan missing scenes. `MuseError` warns and uses explicit text fallback; `QuotaError` is distinguished and can propagate if every pending result is fallback. |
| `FilmStudio.script_gap:883`, `script_unfinished:897`, `start:1080`, `_run:1112` | Count available shots against maximum planned scene `b`; unfinished script must return to script before automatic images/clips/render; direct render/dub is rejected. |
| `FilmStudio._finish_script:1289` | Detect scenes missing shot IDs; retain original bible/cast, existing shots and media. Regenerate missing scene content, filter fresh IDs against existing IDs, merge/sort/save after each scene. Review a copied view but apply changes only to new IDs; preserve old scene sides/manual cameras. Persist partial progress and raise if still incomplete. Do not recreate the film from its initial idea or replace all shots. |
| `FilmStudio._review_script:1471` | JSON missing/review error can mark review skipped while retaining original script. Some recipe errors propagate (not blanket swallow). Verification rounds are bounded; warnings/fix count persist. |
| `SrtStudio._run:777` | Persist remaining `auto_plan.steps` before each automatic stage. Distinguish cancel/license/quota/general errors. Missing images may schedule retries; small residual image gap can explicitly borrow neighbor image after retries; missing clips can fall back to stills with warning. Broken clips are checked before render. These are disclosed degraded outputs, not full generation success. |
| `_schedule_retry:718`, module constants | 3 automatic retries, delays 120/600/1800 seconds; persist `retry_at`, remaining steps and message; stop cancels scheduled continuation. Render belongs to `NO_RETRY_STEPS`. |
| `resume:2075`, `_resume_auto:2150`, `_resume:2180` | On reopen, use saved auto plan (5-second restart delay if auto-continue enabled); collect completed linked task outputs first, wait queued/running linked IDs, then run remaining stages. Recover refs via `ref_task`, images via `task_id`, clips via `clip_task_id`; verify expected output extension/status. Do not duplicate already completed work. Native Engine's remote-admission guarantees are still unknown. |
| `SeriesStudio.run_episodes:365` | Wait through child retries, stop at first unfinished episode, keep done episodes and linked film IDs; continuation does not rebuild completed episodes. |

Port safeguards against unknown paid admission should remain: the original native Engine's internal duplicate-submit behavior was not reconstructed, so its automatic retries are not a reason to remove the port's safety checkpoint.

## 5. Frontend payload corroboration

Readable `W/app.js` independently corroborates backend-facing actions (static call sites, not proof of endpoint reachability):

- Lines 2948–2956: story create `POST /api/srt/story`, `{name,settings}`; settings carry `style,ratio,shot_sec,subtitle_style,mode,lang,story_text,story_voice,story_voice_name`. Lines 3028, 3075, 3113–3143: SRT import and `{action,only}` scoped regeneration/fix/clip actions. Lines 3137–3138 restore `scene_orig`.
- `fmCreateSettings:3426`: `idea,genre/genre_text,minutes,lang,style,style_text,ratio,music_mode,narrator,subtitles,auto_fix,accent,dub,story_mode,pace,use_script,own`. `fmCreate:3479` sends `{name,settings}` then optional `{action:"all"}`. Own photos upload to refs; own entries carry name/role/gender/age/note/photo (6 characters/3 props UI bounds).
- Lines 4162–4192, 4379–4399: settings, per-shot dialogue `lines`, `face,camera,type,scene,motion`, cast and selected actions are editable/scoped. The original editor is not just one prompt per shot.
- `srCreateSettings:4536`, `srOutlines:4541`, `srCreate:4549`: create `{name,settings,outlines}`; `outlines` has positional blank objects or `title,summary`; flags `recap,teaser,ep_cards,shared_music`, episode count 2–30. Lines 4635–4643 support `{action,only}` and open child film `{n}`.

Original raw file paths/HTTP IDs need not become the port's public contract; preserve behavior through existing asset capabilities/IPC validation.

## 6. Twelve native modules — role classification, not “all opaque”

Native internals were not decompiled in this pass. Classification is based on retained native symbol strings **and** imports/call sites in recovered bytecode; symbol existence does not certify runtime behavior.

| Group | Exact `.cp314-win_amd64.pyd` module stems | Evidence |
| --- | --- | --- |
| Business execution/integration (2) | `engine`, `muse` | Native strings expose `musestudio.engine.Engine.start/submit/fire/shutdown` and `musestudio.muse.MusePage`, `_json_objects`; Srt/Film bytecode calls browser, automation and task services through them. Detailed Engine scheduling and Muse reply/DOM implementation remain native unknowns. |
| Local security infrastructure (2) | `local_auth`, `security` | `LocalAuthMiddleware.__call__`, bounded receive/secure send; `protect_text`, with authored string “Per-user protection for local credentials (never a license authority).” These are not film/story planning modules. |
| Licensing (8) | `licensing/clock`, `codec`, `device`, `manager`, `offline_trial`, `offline_trial_keys`, `storage`, `trial_lifecycle` | Native init symbols and `LicenseManager.require/recipe_credentials/status`, `LicenseStore.load/save`; corroborated by recipe credential use. This pass does not assert exact algorithms for each helper. |

`storyvoice`, `filmstudio`, `srtvideo`, `seriesstudio`, `speechcheck`, `dubalign`, `dubaudio`, `voicematch` are present as inspectable Python bytecode. Planner prompt/director opacity is also **remote service opacity**, distinct from native business code. Both boundaries must appear in the plan.

## 7. Ranked gaps in the inspected port baseline

These are implementation gaps visible before parent changes, **not merely missing live-provider credentials**. Existing SQLite persistence, generic child checkpoints, generation adapters, ASR transport, timed SRT/media and admission guards should be reused.

| Priority | Missing behavior and consequence | Concrete port evidence |
| --- | --- | --- |
| P0 | Real AI planning and normalized narrative contracts: no idea→bible→budgeted scene shots, missing-ID completion, director review/verify/lint, cast/location/prop extraction. Generic provider `plan` alone does not connect these steps. | `src/core/studio.ts:270` `plan()` calls local `buildShots`; `src/core/pipelines.ts:28` splits paragraphs into 5-second prompts or one shot per SRT cue; `src/core/integrations.ts:263` `plan()` returns plain completion text. |
| P0 | Script-first completion before media and partial planner resume: cannot preserve a half-written film's planned scene ranges/media while completing missing shots. | `StudioService.plan` overwrites/rebuilds `data.shots` for prompt/subtitle/product input; `executePipeline` checkpoints media `steps`, not a planner stage ledger. `src/core/queue.ts` safely marks running tasks interrupted, but that does not reconstruct missing script stages. |
| P0 | Story audio-first timing: no per-sentence measured narration→cues→grouped shots, uploaded-voice alignment, speech-clock matching/cache/retry path equivalent to storyvoice. | `buildShots` uses generic 5-second paragraph shots; `pipelineSteps` emits image/video/optional speech from predetermined durations. SRT timestamps already work and must not regress. |
| P1 | Rich shot/cast semantics: multiple dialogue lines/listeners/emotion, shot type/camera/face/motion, outfits/props/master refs, script-preservation and narrator policy. | `src/shared/studio.ts` `Shot/Character`; `pipelines.ts` `buildShots`, `validateCharacters`, `pipelineSteps`; `src/ui/AdvancedStudio.tsx` `ShotEditor` has one dialogue/speaker/voice. Rich JSON data may persist, but is not proof it is consumed by generation. |
| P1 | Acoustic QA + regeneration and dynamic editing: offline Vietnamese ASR, speech/no-speech/text mismatch/stutter checks, real phrase alignment, speaker embeddings, pace-aware cuts. | `integrations.ts` remote ASR/TTS transport and `studio.ts` generic sequential image/video/speech loop do not implement recovered local speechcheck/dubalign/voicematch flow. Do not label pitch alone as identity verification. |
| P1 | Series AI outline/continuity: authored outline preservation, global bible/address/props, previous actual summary and next hook, shared cast voices, recap/teaser/shared music. | `validateEpisodes` expects manually provided `id,name,script`; `pipelineSteps` loops supplied episodes; `studio.ts` makes child films/outputs but lacks recovered series planning/context/extras. Child media resume is useful existing behavior, not full series parity. |
| P1 | Explicit stage controls and scoped repair/continuation: original per-step run, selected shot fix/redraw, media-preserving original prompt restore, degraded-output disclosure. | `AdvancedStudio` offers generic plan/run and task cancel; `studio.run` creates whole pipeline task. Generic task retry/cancel is present and should be retained. |

Parent plan dependency: implement explicit, independently authored provider-neutral planner contracts with provenance for inferred fields; reuse recovered local algorithms/limits where appropriate, then wire planner stages/checkpoints to existing execution. Do not promise identical remote prompts or copy a made-up “original schema”. Parent owns implementation choices; no new approval is requested here.

## 8. Verification and remaining unknowns

Two **static verification rounds**, not application stress tests:

1. Verify original bytecode identities and hashes; decode with matching CPython; independently check exact authored timing/defaults, recipe call sites, native count/classification, and corroborate frontend payloads. Preserve all errors/unknowns as limits; no EXE or recovered functions run.
2. Reparse exported JSON, check cited functions/lines/constant values and model hash lengths, report whitespace, docs checker and final repo change scope. Evidence output is recorded with the handoff. Parent's concurrent files are not attributed to this pass.

Observed command output:

```text
Round 1: PASS_STATIC_ONLY — 15 modules, 1356 code objects, 12 native files; defaults 39/57/62 keys
Round 2: PASS_STATIC_ONLY — 33 JSON files parsed, 21 recipe callsites checked, 4 authored ASR hashes checked
Authored settings example: matches original literal keys/values; report whitespace: clean
node scripts/check-docs.js: docs-check: OK (phiên bản, hằng số, đường dẫn khớp code)
git diff --check: exit 0
```

Not run: build/test/lint pipelines, desktop/mobile stress, original Windows runtime, provider jobs, model downloads or accuracy tests. The explicit P1 read-only scope permits only this report in the repo; these runs could generate artifacts or launch work beyond that scope. No application completion/regression/runtime parity claim is made. New implementation must run the repo's full checks and two desktop/mobile stress rounds later.

Unresolved by supplied artifacts: full remote planner/schema/director internals; native Engine/Muse algorithms and admission guarantees; live endpoint behavior/entitlements; exact generated-media quality and recognition accuracy on target OSes. These do not justify omitting recoverable local behavior or calling the current port “tốt bằng”.

## 9. Follow-up: source-like storyvoice handoff for TypeScript

The operator reports a working MuseStudio account and a Windows VPS; connection details are pending, with no password in chat. This follow-up did not connect or execute anything remotely. Parent owns implementation, including an independently authored bounded planner JSON schema; the recovered remote recipe schema is still unknown.

`/private/tmp/mai-studio-parity/storyvoice-contract.json` is the immediate handoff: exact original regex strings and constants, TypeScript RegExp construction variants, source-like pseudocode and explicitly derived examples. The following algorithms reconstruct client bytecode, not original source text and not live-observed behavior.

Exact regex constants (JSON escaping; HEADER alone uses Python IGNORECASE):

```json
{
  "_HEADER": {
    "pattern": "^\\s*(?:#+|cảnh\\s*\\d+|canh\\s*\\d+|scene\\s*\\d+|int\\.|ext\\.|phần\\s*\\d+\\s*[:.\\-–]?\\s*$|chương\\s*\\d+\\s*[:.\\-–]?\\s*$)",
    "flags": "IGNORECASE"
  },
  "_STAGE": {
    "pattern": "\\[[^\\]\\n]{0,120}\\]|\\((?:[^()\\n]{0,80})\\)",
    "flags": ""
  },
  "_SPLIT_SENT": {
    "pattern": "(?<=[.!?…])[\\\"”’)\\]]*\\s+",
    "flags": ""
  },
  "_SPLIT_CLAUSE": {
    "pattern": "(?<=[,;:–—])\\s+",
    "flags": ""
  },
  "SENTENCE_END": {
    "pattern": "[.!?…:;。！？\"”’)\\]]\\s*$",
    "flags": ""
  }
}
```

Pseudocode uses Python string/number semantics. `R3(x)` means Python `round(x,3)`, not a proposed JavaScript rounding helper. `len_codepoints`, `slice_codepoints` and `rfind_codepoint` describe Python Unicode indexing, not new abstractions required in the codebase.

```text
function clean(text):
    # Python str(text or ""); input contract for the port should be a string.
    value = STAGE.sub(" ", str(text or ""))   # replace ALL nonoverlapping matches
    value = re.sub(r"\s+", " ", value)       # collapse ALL Python Unicode whitespace
    return value.strip().strip('"“”').strip()
```

```text
function split_story(text):
    out = []
    for raw in str(text or "").replace("\r", "\n").split("\n"):
        line = raw.strip()
        if not line or HEADER.match(line):
            continue
        line = clean(line)
        if len_codepoints(line) < 2:
            continue
        for sent in SPLIT_SENT.split(line):
            sent = sent.strip()
            if len_codepoints(sent) < 2:
                continue
            if len_codepoints(sent) <= 220:
                out.append(sent)
                continue
            cur = ""
            for part in SPLIT_CLAUSE.split(sent):
                if cur and len_codepoints(cur) + 1 + len_codepoints(part) > 220:
                    out.append(cur)
                    cur = part
                else:
                    cur = (cur + " " + part).strip()
                while len_codepoints(cur) > 220 * 1.5:
                    cut = rfind_codepoint(cur, " ", 0, 220)  # end EXCLUSIVE
                    cut = cut if cut > 220 // 2 else 220
                    out.append(slice_codepoints(cur, 0, cut).strip())
                    cur = slice_codepoints(cur, cut).strip()
            if cur:
                out.append(cur)
    return out
```

```text
function cues_from_durations(lines, durations):
    cues = []
    at = []
    t = 0.25
    for text, dur in zip(lines, durations):   # shortest sequence wins, no length check here
        dur = max(0.3, float(dur or 0))
        at.append(R3(t))
        cues.append({
            "i": len(cues) + 1,
            "start": R3(t),
            "end": R3(t + dur),
            "text": slice_codepoints(text, 0, 300)
        })
        t += dur + (0.35 if SENTENCE_END.search(text) else 0.15)
        # Do NOT round accumulated t; sentence test uses ORIGINAL, untruncated text.
    return (cues, at, R3(t + 0.4))
```

```text
function group_shots(cues, target=5.0):
    if not cues:
        return []
    target = max(2.0, min(20.0, float(target or 5.0)))
    hard_max = target * 1.6
    groups = []
    cur = []
    for n, c in enumerate(cues):
        cur.append(c)
        dur = c["end"] - cur[0]["start"]
        nxt = cues[n + 1] if n + 1 < len(cues) else None
        gap = nxt["start"] - c["end"] if nxt else 0
        nxt_dur = nxt["end"] - cur[0]["start"] if nxt else 0
        close = (
            nxt is None
            or dur >= hard_max
            or gap >= 1.2
            or (dur >= target * 0.75 and SENTENCE_END.search(c["text"]))
            or (dur >= target * 0.6 and abs(dur - target) <= abs(nxt_dur - target))
        )
        if close:
            groups.append(cur)
            cur = []
    if len(groups) > 1 and groups[-1][-1]["end"] - groups[-1][0]["start"] < target * 0.4:
        # Exactly one final merge, even if a prior gap/hard_max closed that group.
        groups[-2].extend(groups.pop())
    shots = []
    for k, g in enumerate(groups):
        start = 0.0 if k == 0 else g[0]["start"]
        shots.append({
            "id": k + 1,
            "cue_from": g[0]["i"],
            "cue_to": g[-1]["i"],
            "start": R3(start),
            "text": " / ".join(c["text"] for c in g)
        })
    for k, shot in enumerate(shots):
        shot["end"] = shots[k + 1]["start"] if k + 1 < len(shots) else R3(cues[-1]["end"] + 0.5)
    return shots
```

Port-sensitive behavior confirmed by branch inspection:

- `split_story` checks the HEADER before cleaning; a line starting `CẢNH 2` is skipped in full, including text after that header. CR becomes LF (so CRLF creates a blank line, then gets skipped). Cleaning replaces stage directions with spaces, collapses whitespace, strips surrounding whitespace, strips the character set `"“”`, then trims again.
- 220 is a soft split threshold. Long clauses are flushed at clause boundaries; hard slicing is a **while loop** only while the current remainder exceeds 330 codepoints. The final remainder can exceed 220. There is no post-filter to remove tiny clause remainders.
- Sentence splitting recognizes `. ! ? …` followed by optional closing punctuation and whitespace; the end-of-sentence test is broader (including `: ;` and CJK punctuation/closing quotes). A colon can select the 0.35-second gap without splitting that sentence.
- Narration uses minimum duration **0.3**, not `MIN_CUE=0.6` (the latter belongs to script/voice alignment). It silently follows the shorter zip length. Port validation for bad/mismatched durations must be labeled independently authored behavior, not an original check.
- Clock `t` remains unrounded between lines; emitted cue/offset values round to milliseconds. Punctuation is tested on full original text before the cue display is truncated to 300 codepoints. Empty input returns `([],[],0.65)` at helper level; the studio caller rejects an empty completed narration.
- `group_shots` has a function default 5.0 seconds; the normal SRT settings default passed by callers is 3.2. Grouping is a cue partition, not a change to cue timestamps. A final short group merges back once even across an earlier gap/hard-max cut. A single long cue/tail merge can exceed the nominal hard max.
- Visual output starts at zero and covers gaps using the preceding shot. Last visual end is `lastCue.end+0.5`; narration track total adds the last sentence/clause gap then 0.4. Do not equate these two endpoints.
- JS UTF-16 lengths/slicing can split emoji; Python counts Unicode codepoints. JS `\s`/trim differ from Python whitespace; exported TypeScript regexes expand the Python whitespace set and Unicode decimal digits. Python IGNORECASE has extra dotted/dotless-I behavior; the exported TypeScript HEADER expands its `int` token to `[iIİı]nt` for that edge. Avoid global state on `SENTENCE_END.test`.
- Python rounding is not `Math.round`: exactly representable `round(0.0625,3)=0.062`. The binary-double rounding contract matters for exact millisecond comparison; no epsilon-based approximation is presented as equivalent.

Derived example (not an original runtime fixture): lines `["Xin chào.","Mời anh"]`, measured durations `[1.25,0.5]` produce cue intervals `[0.25,1.5]` and `[1.85,2.35]`, offsets `[0.25,1.85]`, narration total `2.9`. Grouping at target `3.2` produces one visual shot `[0,2.85]`, text `Xin chào. / Mời anh`, cue range 1–2. A single unbroken 331-codepoint sentence splits into lengths 220 and 111.

### Portable ASR implementation boundary

The engine is known: CPU ONNX Runtime with the recovered Zipformer model/tensors, NumPy-style filterbank and greedy transducer decoder, not remote ASR. `asr-contract.json` now includes exact feature-frontend constants/formulas recovered from `_mel_banks:290` and `fbank:304`: 16 kHz, 80 mel bins, 160-sample shift, 400-sample window, 512 FFT, low=20 Hz/high=Nyquist−400 Hz, reflected frame indexing, per-frame mean removal, preemphasis .97, Povey window power .85, log-power mel and float32 output. The authored model/hash/tensor contract remains unchanged.

A portable native worker is a builder implementation option; merely loading the ONNX files with another default mel frontend does not establish parity. Numeric feature/tensor comparisons, Vietnamese fixtures, acoustic timing, cancellation and OS/architecture tests remain necessary. No model/native dependency or voice checker was added in this pass.

Follow-up verification (static only):

```text
Round 1: 5 TypeScript RegExp constructions compiled; focused regex probes passed
Round 2: 5 raw regexes matched original constants; 4 pseudocode blocks matched report
Derived timing/rounding arithmetic checked; 34 JSON files parsed
Updated HEADER: ASCII/dotted/dotless I and Unicode decimal-digit probes passed
docs-check: OK; git diff --check: exit 0
```

No build/runtime stress or original function execution; this verifies the reconstruction handoff, not full parity or ASR quality.


## Implementation checkpoint — 0.2.0-dev.1

The gap tables above describe the inspected baseline and recovered source contract. The new development implementation now connects staged AI/director planning, measured narration, native offline speech, current-asset QC, product vision, voice-fit Dub and cached series recap. It does not recover the remote recipe text or certify equivalence of native business modules. See the latest checkpoint in acceptance.md and SYSTEM_DOCUMENTATION.md for current test/platform evidence and remaining work; the historical evidence and native/remote unknowns above remain unchanged.


## Affiliate workflow checkpoint — 2026-11-16

The explicit Affiliate dev workflow now implements the observed eleven styles/three host modes, native scene-count budgets, source/model/background/outfit references, independently assessed script, product-aware image QC, sampled clip review and bounded repair, actual onset alignment, scene captions, CTA/price/disclosure/endcard, MP4 and post-copy export. Legacy projects without affiliate settings retain their preceding behavior. Shipped 1.13.12 source and read-only 1.13.18 options/successful historical video metadata establish the recovered contract; remote prompt recipes remain unknown and Mai prompts are independently authored.

A current Mai live Fashion/silent 15-second black-shirt case completed one host/four images/four clips/eight assessments and a full decoded 1080x1920/30fps MP4. A render-only correction fixed caption/card layering without generating new media. Two macOS and two packaged Linux ARM64 desktop/mobile bilingual/light-dark fixture UI rounds exercise persistence, cancellation/retry, independent review, media generation, real FFmpeg export and reopening without resubmission. These are distinct evidence classes. Detailed artifacts, review fixes, regression results and coverage are in acceptance.md. No new native Muse video with the same brief was produced in this pass; artistic equivalence, all style/voice/language/category live combinations and bare-metal Linux/x64 remain unverified.


## UI / Affiliate audio checkpoint — 2026-11-17

Observed native UI screenshots are 1.13.12; options/project/scene metadata are from 1.13.18. Mai now follows the top navigation/project list/scene-card organization, retaining advanced tools and original actions. Seven native visual-style choices are represented by independently authored preset directions and custom style. Optional dubbing now connects the existing TTS adapter, selected voice, 0.8–1.25 speed, cached fitting, real replacement audio QC, and direct voice/music volume/ducking controls. Provider waveform-menu audio capture was reproduced live and added with admission/freshness/download guards; the existing accepted music task recovered a real 15-second MP3 without resubmission.

Evidence remains bounded: current live spoken Fashion plan and source review passed, music and one scene image were generated, but the account explicitly refused video generation by country/region. No new spoken clip or matching native comparison was produced. Optional VoiceTube live, automatic voice matching, instruction-driven AI scene-description revision, native transition fidelity/adaptive timing and all style/host/language/category combinations remain unverified or unimplemented as specified in acceptance.md. The existing automatic QC repair and manual scene editing are separate from native AI fix. No full parity claim.


### Muse account refresh — 2026-11-17, 00:35–00:39 ICT

At the operator’s request, native Muse Studio 1.13.18 refreshed quota and login checks for all six enabled accounts, preserving disabled accounts 1–5, enabled switches, proxies and concurrency. Native `check_quota` reports account 6/Tour exhausted (weekly 100%, top-up 0); accounts 7/9/10/11 weekly 0%, account 8 weekly 28%, each with 2,000,000,000 top-up tokens. All six enabled accounts returned current `cookie_status=ok`; account 7 was also opened through the native hold control and showed the authenticated Muse Connected page. No video job was submitted; quota/login are not proof of video entitlement, region eligibility or clip quality. Disabled-account quota values remain historical.

The owned account-7 hold was released, owned DevTools/PowerShell closed, only this audit’s Windows Temp directory removed and RDP disconnected. Evidence: `Downloads/MaiStudio-interface-dev-20261116/evidence/muse-accounts-20261117.json` and screenshot. No cookies, passwords, auth headers or proxy credentials were extracted or moved. Local Mai’s earlier region refusal remains unresolved; available native quota does not establish the local account’s video rights.


### Native-profile video capability probes — 2026-11-17, 01:14–01:32 ICT

Follow-up to the earlier quota-only check: accounts7/9/10/11 each received one owner-authorized short-video request in a new owned side-chat, with their existing native profile/proxy. Account8 displayed the exact prior owned spoken Fashion prompt and regional refusal, so it was not resubmitted. All five provider replies reported video generation unavailable by country/region; no playable video or still fallback was produced. This establishes failed observed requests, not an independent diagnosis of platform entitlements, country or proxy location. Available top-up tokens did not establish video access.

Captured variants include “for your account”, “for this account”, and “for your MaiStudio account”. Mai’s fresh-reply guard now recognizes these bounded forms; a real-browser test per variant proves prompt refusal and admitted retries without a second submission. The last two variants reproduced failures before the one-line matcher extension. Final core suite407/407 on both macOS ARM64 and Linux ARM64; UI source remains unchanged.

Native switches/proxies/concurrency remain as found, accounts1–5 remain disabled/unprobed, account6 remains quota-exhausted. Owned holds7–11 were released and a fresh reconnect at01:32 verified all native rows back to Treo trình duyệt with no held Chrome. RDP disconnected. Evidence: `Downloads/MaiStudio-interface-dev-20261116/evidence/muse-video-account-probes.json`, account7–11 screenshots and `muse-accounts-restored.png`. No new native Affiliate output was created; matching live parity remains blocked.

## Affiliate Muse templates (v2) — 2026-11-20

Source: three complete Muse 1.13.18 Video Aff projects in the operator's database (lookbook/voiceover, fashion/presenter, review/presenter). Design: `docs/specs/2026-11-20-affiliate-muse-parity.md`; code: `src/core/affiliate-prompts.ts`, wired in `src/core/pipelines.ts` only for projects with `affiliatePlanVersion: 2`.

**Verbatim Muse wording.** The image, clip and host-portrait lines of spec Appendix A, the three camera lines, the product/garment locks, the opening-hook line and the closing lines. `tests/fixtures/muse-affiliate-prompts.json` holds 97 first-attempt Muse prompts (talk, fashion, lookbook; image, clip and host portrait) that the module reproduces line for line. Where the appendix and a real prompt disagreed, the real prompt won. Observed timing: the talk clip's speech window ends at `round(1.6 + 0.3 × words)` seconds of the line it is given; fashion is fixed at 4 s and lookbook at 3 s. Muse speaks numbers as words in the clip line (`3cm` → `ba xăng-ti-mét`, `69.990 đồng` → `sáu mươi chín nghìn chín trăm chín mươi đồng`) while the image prompt keeps the digits; MaiStudio reproduces the five observed pairs with the existing transcript number reader.

**Extrapolated (no Muse sample).** Ratio words other than `Vertical 9:16`; spoken-language names other than Vietnamese; the Southern and Central accent phrases and dropping the accent phrase for other languages; talk `silent` (uses the fashion product "Nobody speaks" block); voiceover without a host (`narrator_v1` voice line); lookbook with outfit photos (garment lock replaces "Show it realistically…"); the background and pose sentences (MaiStudio's existing lines appended to the image prompt); the camera rotation for product shots (arc on even, push on odd), which Muse chooses server-side; the reference order for lookbook (outfit photo, then presenter, inferred from Muse code) and for a product shot whose product is absent (no product photos). Six talk styles besides `review` use the `review` template unchanged. A talk-group presenter shot without a line (possible only with `keepScript`) uses a MaiStudio variant with the presenter opening line, IDENTITY LOCK, a locked camera, the cleaned action and "Nobody speaks"; Muse has no such sample. The talk speech-window end `round(1.6 + 0.3 × words)` is capped at 9 s so a long line keeps the closing `9–10 s` segment; observed Muse lines never reached the cap.

**Unexplained `cleanMotion` cases.** The observed rule (drop camera clauses and a leading `-ing` clause, split on `while`/`as`) matches 60 of 63 observed shots (figure from the implementation plan). Two of the three misses are review shot 10 and fashion shot 8, where Muse dropped the motion line entirely; both are excluded from the fixture. The third miss is not identified in this report.

**Planner.** Muse's script prompt (`aff.script_turn`) is typed into chat and never stored, so MaiStudio's v2 planner prompt is authored to produce Muse-shaped data; only its outputs are evidence. Planning a v2 style always validates the reply against the v2 shape; a reply that misses it goes through the existing single repair attempt.

**Not verified.** No live provider run of a v2 project; speech-window margins (0.12 s / 0.30 s) were tested only on synthetic sine clips.
