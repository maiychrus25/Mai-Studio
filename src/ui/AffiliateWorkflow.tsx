import { useEffect, useState } from 'react';
import {
  AFFILIATE_STYLES, AFFILIATE_HOSTS, AFFILIATE_HOOKS, AFFILIATE_POSES, AFFILIATE_LANGUAGES,
  AFFILIATE_AGES, AFFILIATE_GENDERS, AFFILIATE_ACCENTS,
  readAffiliateSettings, affiliateSceneCount, affiliateMode,
  MAX_AFFILIATE_REFERENCES, type AffiliateSettings,
} from '../shared/affiliate';
import type { Project, StudioStage } from '../shared/studio';
import { Button, Field, Result, Status, useStudio } from './components';
import { shotGroups } from './Production';

const visualStyles = [
  { id: 'smartphone', vi: 'Người thật · quay điện thoại', en: 'Real people · smartphone', prompt: 'Photorealistic smartphone product video with real Vietnamese people, natural skin, everyday places, soft daylight, faithful product materials and true-to-life colors.' },
  { id: 'ancient-anime', vi: 'Cổ trang · anime', en: 'Ancient costume · anime', prompt: 'Ancient Chinese costume drama in refined anime and manhwa illustration, expressive faces, detailed traditional clothing and architecture, soft shading and cinematic light.' },
  { id: 'modern-anime', vi: 'Hiện đại · anime drama', en: 'Modern anime drama', prompt: 'Modern anime and webtoon drama with clean line art, expressive characters, contemporary clothing and detailed everyday settings under cinematic lighting.' },
  { id: 'stick-figure', vi: 'Người que vui nhộn', en: 'Playful stick figures', prompt: 'Simple hand-drawn black marker stick figures on white, readable expressions, minimal props and a playful product explainer style.' },
  { id: 'watercolor', vi: 'Tranh màu nước truyện cổ tích', en: 'Storybook watercolor', prompt: 'Storybook watercolor with delicate ink outlines, soft washes, warm pastels and a whimsical fairy-tale atmosphere.' },
  { id: '3d-animation', vi: 'Hoạt hình 3D', en: '3D animation', prompt: 'Stylized 3D animated film with expressive characters, soft global illumination, detailed materials and cinematic depth of field.' },
  { id: 'cinematic', vi: 'Ảnh điện ảnh chân thực', en: 'Photorealistic cinema', prompt: 'Photorealistic cinematic footage with natural skin and product textures, realistic lighting, shallow depth of field and a 35mm film look.' },
];

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const stringValue = (value: unknown) => typeof value === 'string' ? value : '';
const stringIds = (value: unknown): string[] => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

export function AffiliateWorkflow({ project, data, onChange, onRun }: {
  project: Project;
  data: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  onRun: (stage: StudioStage) => void;
}) {
  const { state, t, busy, invoke, act } = useStudio();
  const [invalidFields, setInvalidFields] = useState<Record<string, string>>({});
  const [visualChoice, setVisualChoice] = useState(visualStyles.find(item => item.prompt === data.style)?.id || 'custom');
  useEffect(() => setVisualChoice(visualStyles.find(item => item.prompt === data.style)?.id || 'custom'), [project.id, data.style]);
  useEffect(() => setInvalidFields({}), [project.id]);
  let settings: ReturnType<typeof readAffiliateSettings>;
  try { settings = readAffiliateSettings(data.affiliate === undefined ? {} : data.affiliate); }
  catch (cause) {
    return <section className="editor-card" aria-label={t('Thiết lập Affiliate', 'Affiliate setup')}>
      <h2>{t('Cấu hình Affiliate cần được sửa', 'Affiliate settings need attention')}</h2>
      <p className="task-error" role="alert">{cause instanceof Error ? cause.message : String(cause)}</p>
      <p className="inline-note">{t('Dữ liệu gốc được giữ nguyên. Sửa trường affiliate trong tab Nâng cao rồi quay lại đây.', 'The original settings are retained. Correct the affiliate field in Advanced, then return here.')}</p>
      <Result value={data.affiliate}/>
    </section>;
  }
  const configured = data.affiliate !== undefined;
  const tasks = state.tasks.filter(task => task.projectId === project.id).sort((a, b) => b.createdAt - a.createdAt);
  const working = busy || tasks.some(task => task.status === 'queued' || task.status === 'running');
  const disabled = working || !configured;
  const product = record(data.product), source = record(data.productSource);
  const productName = stringValue(product.name) || stringValue(product.title);
  const images = state.assets.filter(asset => asset.mime.startsWith('image/'));
  const productIds = stringIds(data.productAssetIds);
  const selectedImages = images.filter(asset => productIds.includes(asset.id));
  const missingImages = productIds.filter(id => !selectedImages.some(asset => asset.id === id));
  const missingFields = stringIds(source.missingFields);
  const warnings = stringIds(source.warnings);
  const sourceUrl = stringValue(source.url) || stringValue(product.url);
  const sourceLabel = source.method === 'api' ? t('Shopee API', 'Shopee API')
    : source.method === 'cached' || source.method === 'page' ? t('Trang Shopee đã mở', 'Captured Shopee page')
    : t('Thông tin nhập thủ công', 'Manual product facts');
  const mode = affiliateMode(settings);
  const targetScenes = affiliateSceneCount(settings);
  const style = AFFILIATE_STYLES.find(option => option.id === settings.contentStyle);
  const montage = ['lookbook', 'asmr', 'pov'].includes(settings.contentStyle);
  const persistentCaption = ['asmr', 'pov'].includes(settings.contentStyle);
  const recommendation = settings.contentStyle === 'fashion' ? 'presenter' : settings.contentStyle === 'snack' ? 'voiceover' : montage ? 'silent' : undefined;
  const recommendedHost = AFFILIATE_HOSTS.find(option => option.id === recommendation);
  const recommended = recommendation && (settings.hostMode !== recommendation || montage && settings.seconds !== 15);
  const patch = (changes: Record<string, unknown>) => {
    const next = { ...settings, ...record(data.affiliate), ...changes };
    onChange({ affiliate: next, ...((next.hostMode === 'silent' || next.contentStyle === 'asmr') && data.affiliateDub === true ? { affiliateDub: false } : {}) });
  };
  const textField = (field: 'notes' | 'caption' | 'cta' | 'affiliateUrl', label: string, rows?: number, hint?: string) => <AffiliateTextField
    projectId={project.id} settings={settings} field={field} label={label} rows={rows} hint={hint} disabled={disabled}
    value={typeof record(data.affiliate)[field] === 'string' ? stringValue(record(data.affiliate)[field]) : settings[field]}
    onChange={value => patch({ [field]: value })} onValidation={error => setInvalidFields(previous => previous[field] === error ? previous : { ...previous, [field]: error })}
  />;
  const options = (values: readonly { id: string; vi: string; en: string }[]) => values.map(value => <option key={value.id} value={value.id}>{t(value.vi, value.en)}</option>);
  const assetField = (label: string, value: string, change: (id: string) => void, active = true) => {
    const selected = images.find(asset => asset.id === value);
    return <div>
      <Field label={label} hint={!active ? t('Không dùng trong chế độ hiện tại; lựa chọn được giữ nguyên.', 'Unused in the current mode; your selection is retained.') : value && !selected ? t('Ảnh đã chọn không còn trong Thư viện. Chọn ảnh khác hoặc bỏ lựa chọn.', 'The selected image is missing from Library. Choose another image or clear the selection.') : undefined}>
        <select value={value} disabled={disabled || !active} onChange={event => change(event.target.value)}>
          <option value="">{t('Chưa chọn', 'None selected')}</option>
          {value && !selected && <option value={value}>{t('Ảnh không còn khả dụng', 'Unavailable image')}: {value}</option>}
          {images.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
        </select>
      </Field>
      {selected && <div className="product-photo-list"><div className="check-row"><img loading="lazy" src={window.studio?.mediaUrl(selected.id)} alt=""/>{selected.name}</div></div>}
    </div>;
  };
  const shots = shotGroups(project, data).flatMap(group => group.shots);
  const production = record(data.production);
  const count = (field: string, mime: string) => new Set(Object.values(record(production[field])).filter((id): id is string => typeof id === 'string' && state.assets.some(asset => asset.id === id && asset.mime.startsWith(mime)))).size;
  const generatedImages = count('images', 'image/'), generatedVideos = count('videos', 'video/');
  const missingReferences = [mode.model ? settings.presenterAssetId : '', settings.backgroundAssetId, ...(settings.contentStyle === 'lookbook' ? settings.outfitAssetIds : [])].filter(id => id && !images.some(asset => asset.id === id));
  const missingOutfits = settings.contentStyle === 'lookbook' && !settings.outfitAssetIds.length;
  const referenceCount = new Set([...productIds, mode.model ? settings.presenterAssetId : '', settings.backgroundAssetId, ...(settings.contentStyle === 'lookbook' ? settings.outfitAssetIds : [])].filter(Boolean)).size;
  const canRun = referenceCount <= MAX_AFFILIATE_REFERENCES && !disabled && !Object.values(invalidFields).some(Boolean) && !!productName.trim() && selectedImages.length > 0 && missingReferences.length === 0 && missingImages.length === 0 && !missingOutfits;
  const review = record(data.affiliateReview);
  const latestPlanTask = tasks.find(task => task.kind === 'plan' || task.kind === 'pipeline' && ['plan', 'all'].includes(String(task.input.stage)));
  const latestReview = record(latestPlanTask?.checkpoint.affiliateReview);
  const showTaskReview = !!latestPlanTask && latestPlanTask.id !== review.taskId && latestPlanTask.createdAt >= (typeof review.at === 'number' ? review.at : 0)
    && (!!latestPlanTask.error || Object.keys(latestReview).length > 0 || typeof latestPlanTask.checkpoint.affiliatePlanError === 'string');
  const post = record(data.affiliatePost);
  const price = typeof product.price === 'string' || typeof product.price === 'number' ? String(product.price)
    : typeof product.priceMin === 'number' ? `${product.priceMin}${typeof product.priceMax === 'number' && product.priceMax !== product.priceMin ? ` – ${product.priceMax}` : ''}` : '';
  const dateLabel = (value: unknown) => {
    const at = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(at) && !Number.isNaN(new Date(at).getTime()) ? new Date(at).toLocaleString(state.settings.language) : '';
  };
  const sourceNames: Record<string, string> = {
    description: t('mô tả', 'description'), price: t('giá', 'price'), attributes: t('thuộc tính', 'attributes'),
    variations: t('phân loại', 'variations'), sold: t('số đã bán', 'sold count'), rating: t('đánh giá', 'rating'), shopName: t('cửa hàng', 'shop'),
  };
  const linkSummary = [stringValue(data.ratio) || '9:16', stringValue(data.style), stringValue(data.styleText)].filter(Boolean).join(' · ');

  return <section className="affiliate-setup" aria-label={t('Thiết lập Affiliate', 'Affiliate setup')}>
    <details className="editor-card affiliate-source" open={!configured || !productName || !selectedImages.length || missingImages.length > 0 || Array.isArray(source.imageErrors) && source.imageErrors.length > 0 ? true : undefined}><summary><strong>{productName || t('Thông tin sản phẩm', 'Product information')}</strong><span className="count-chip">{selectedImages.length} {t('ảnh', 'photos')}</span>{missingFields.length > 0 && <span className="muted">{missingFields.length} {t('trường chưa có', 'missing fields')}</span>}</summary><div className="disclosure-body">
      <div className="section-heading"><div><div className="eyebrow">AFFILIATE</div><h2>{t('Từ sản phẩm đến video', 'From product to video')}</h2></div><span className="count-chip">{AFFILIATE_STYLES.length} {t('kiểu', 'styles')}</span></div>
      <p className="inline-note">{t('Chọn cách kể, duyệt kịch bản, tạo ảnh và video, kiểm tra rồi dựng bản hoàn chỉnh.', 'Choose the approach, review the script, generate images and video, assess the results and render the final edit.')}</p>
      {!configured && <><p className="inline-note">{t('Đây là bản xem trước thiết lập mặc định. Bật quy trình để áp dụng; dự án cũ được giữ nguyên đến khi anh chọn bật.', 'These are preview defaults. Activate the workflow to apply them; existing project settings are retained until you opt in.')}</p><Button primary disabled={working} onClick={() => onChange({ affiliate: settings, ratio: data.ratio || '9:16', autoChecks: data.autoChecks ?? true, videoReview: data.videoReview ?? true, qualityRetries: data.qualityRetries ?? 2, style: data.style || visualStyles[0].prompt })}>{t('Dùng quy trình Affiliate', 'Use Affiliate workflow')}</Button></>}
      {configured && <p className="inline-note">{t('Thiết lập sẽ được lưu khi lưu dự án hoặc chạy một bước.', 'Settings are saved when you save the project or run a stage.')}</p>}
      <div className="inspection-row"><span>{t('Sản phẩm', 'Product')}</span><div className="grow"><h3>{productName || t('Chưa có tên sản phẩm', 'Product name missing')}</h3></div></div>
      <div className="inspection-row"><span>{t('Nguồn thông tin', 'Product source')}</span><strong>{sourceLabel}</strong></div>
      {price && <div className="inspection-row"><span>{t('Giá từ nguồn', 'Sourced price')}</span><div className="grow"><p>{price}</p></div></div>}
      {dateLabel(source.capturedAt) ? <p className="inline-note">{t('Thời điểm lấy thông tin và giá', 'Product and price captured')}: {dateLabel(source.capturedAt)}. {t('Giá có thể thay đổi sau thời điểm này.', 'The price may change after this time.')}</p>
        : <p className="inline-note">{t('Nguồn chưa cung cấp thời điểm xác minh giá.', 'The source has not supplied a price verification date.')}</p>}
      {dateLabel(source.importedAt) && <p className="inline-note">{t('Lần nhập vào dự án', 'Imported into this project')}: {dateLabel(source.importedAt)}</p>}
      {sourceUrl && <details className="details-block"><summary>{t('Liên kết nguồn', 'Source link')}</summary><Result value={sourceUrl}/></details>}
      <div className="inspection-row"><span>{t('Ảnh sản phẩm đã chọn', 'Selected product images')}</span><strong>{selectedImages.length}</strong></div>
      {selectedImages.length > 0 && <div className="product-photo-list">{selectedImages.map(asset => <div className="check-row" key={asset.id}><img loading="lazy" src={window.studio?.mediaUrl(asset.id)} alt=""/>{asset.name}</div>)}</div>}
      {(!productName.trim() || !selectedImages.length) && <p className="task-error">{t('Thêm tên sản phẩm và chọn ít nhất một ảnh trong tab Sản phẩm. Có thể dùng thông tin thủ công, không bắt buộc liên kết Shopee.', 'Add a product name and select at least one image in Product. Manual facts are supported; a Shopee link is optional.')}</p>}
      {missingImages.length > 0 && <><Button disabled={working} onClick={() => onChange({ productAssetIds: productIds.filter(id => images.some(asset => asset.id === id)) })}>{t('Bỏ ảnh không còn khả dụng', 'Remove unavailable photos')}</Button><p className="task-error" role="alert">{t(`${missingImages.length} ảnh sản phẩm đã chọn không còn khả dụng. Chọn lại trong tab Sản phẩm.`, `${missingImages.length} selected product images are unavailable. Reselect them in Product.`)}</p></>}
      {Array.isArray(source.imageErrors) && source.imageErrors.length > 0 && <p className="task-error" role="alert">{t('Có ảnh sản phẩm chưa nhập được. Xem lỗi tải ảnh trong tab Sản phẩm.', 'Some product images were not imported. Review the image download errors in Product.')}</p>}
      {missingFields.length > 0 && <p className="inline-note">{t('Nguồn chưa cung cấp', 'Not supplied by the source')}: {missingFields.map(field => sourceNames[field] || field).join(', ')}. {t('Không tự điền số liệu còn thiếu; anh có thể bổ sung thông tin có nguồn ở tab Sản phẩm.', 'Missing facts are not invented. You can add sourced facts in Product.')}</p>}
      {warnings.length > 0 && <details className="details-block"><summary>{t('Lưu ý từ nguồn sản phẩm', 'Product source notes')}</summary><Result value={warnings}/></details>}
    </div></details>

    {Object.keys(record(record(project.data.production).affiliateBeatSync)).length > 0 && <p className="inline-note" role="status">{t('Căn nhịp nhạc', 'Music beat alignment')}: {String(record(record(project.data.production).affiliateBeatSync).reason || '')}</p>}
    <section className="editor-card affiliate-story">
      <h2>{t('1. Cách kể và nhịp video', '1. Approach and pacing')}</h2>
      <div className="form-grid">
        <Field label={t('Kiểu nội dung', 'Content style')} hint={style ? t(style.hintVi, style.hintEn) : undefined}><select value={settings.contentStyle} disabled={disabled} onChange={event => patch({ contentStyle: event.target.value })}>{options(AFFILIATE_STYLES)}</select></Field>
        <Field label={t('Cách dẫn dắt', 'Host mode')}><select value={settings.hostMode} disabled={disabled} onChange={event => patch({ hostMode: event.target.value })}>{options(AFFILIATE_HOSTS)}</select></Field>
        <Field label={t('Thời lượng mục tiêu', 'Target duration')}><select value={settings.seconds} disabled={disabled} onChange={event => patch({ seconds: Number(event.target.value) })}>{[15, 30, 45, 60].map(seconds => <option key={seconds} value={seconds}>{seconds} {t('giây', 'seconds')}</option>)}</select></Field>
        <Field label={t('Cách mở đầu', 'Opening hook')}><select value={settings.hookStyle} disabled={disabled} onChange={event => patch({ hookStyle: event.target.value })}>{options(AFFILIATE_HOOKS)}</select></Field>
        <Field label={t('Tư thế / chuyển động', 'Pose / movement')}><select value={settings.pose} disabled={disabled} onChange={event => patch({ pose: event.target.value })}>{options(AFFILIATE_POSES)}</select></Field>
        <Field label={t('Ngôn ngữ video', 'Video language')}><select value={stringValue(data.language) || 'vi'} disabled={disabled} onChange={event => onChange({ language: event.target.value })}>{!AFFILIATE_LANGUAGES.some(value => value.id === data.language) && !!stringValue(data.language) && <option value={stringValue(data.language)}>{stringValue(data.language)}</option>}{options(AFFILIATE_LANGUAGES)}</select></Field>
        <Field label={t('Phong cách hình ảnh', 'Visual style')}><select disabled={disabled} value={visualChoice} onChange={event => { setVisualChoice(event.target.value); const chosen = visualStyles.find(item => item.id === event.target.value); if (chosen) onChange({ style: chosen.prompt }); }}>{visualStyles.map(item => <option key={item.id} value={item.id}>{t(item.vi, item.en)}</option>)}<option value="custom">{t('Tự viết phong cách', 'Custom style')}</option></select></Field>
        {visualChoice === 'custom' && <Field label={t('Mô tả phong cách riêng', 'Custom visual style')}><textarea rows={2} disabled={disabled} value={stringValue(data.style)} onChange={event => onChange({ style: event.target.value })}/></Field>}
        <Field label={t('Yêu cầu hình ảnh bổ sung', 'Additional visual direction')}><textarea rows={2} disabled={disabled} value={stringValue(data.styleText)} onChange={event => onChange({ styleText: event.target.value })}/></Field>

      </div>
      <p className="inline-note">{mode.handsOnly ? t('Cận tay thao tác với sản phẩm; các cảnh ngắn nối theo nhịp, không cần người dẫn nhìn vào máy.', 'Hands demonstrate the product in short, rhythm-led shots; no host speaking to camera.') : mode.model ? t('Có người mẫu xuất hiện để giữ sản phẩm và hình ảnh nhân vật nhất quán.', 'An on-screen model presents the product with consistent appearance.') : t('Tập trung vào sản phẩm và bối cảnh sử dụng.', 'Focus on the product and its use in context.')}{' '}{mode.spoken ? t('Có lời nói theo chế độ đã chọn.', 'Includes speech for the selected mode.') : t('Không có lời nói.', 'No spoken dialogue.')}{' '}{mode.nativeAudio ? t('Âm thanh được tạo trực tiếp cùng cảnh video.', 'Audio is generated with each video scene.') : ''}</p>
      {recommended && recommendedHost && <div className="actions"><p className="inline-note">{t('Gợi ý cho kiểu này', 'Recommended for this style')}: {t(recommendedHost.vi, recommendedHost.en)}{montage ? ' · 15s' : ''}. {t('Lựa chọn hiện tại vẫn được giữ.', 'Your current choice is retained.')}</p><Button disabled={disabled} onClick={() => patch({ hostMode: recommendation, ...(montage ? { seconds: 15 } : {}) })}>{t('Áp dụng gợi ý', 'Apply recommendation')}</Button></div>}
      {['fashion', 'lookbook'].includes(settings.contentStyle) && <p className="inline-note">{t('Fashion và Lookbook luôn có người mẫu trong hình, kể cả khi chọn lời dẫn nền hoặc không lời.', 'Fashion and Lookbook always show a model, including voiceover and silent modes.')}</p>}
      {textField('notes', t('Yêu cầu và ý tưởng riêng', 'Creative brief and notes'), 3)}
    </section>

    <section className="editor-card affiliate-presenter">
      <h2>{t('2. Nhân vật và ảnh tham chiếu', '2. Presenter and references')}</h2>
      <p className="inline-note">{t('Chọn ảnh thật từ Thư viện để định hướng khuôn mặt, bối cảnh và trang phục. Các lựa chọn không áp dụng cho kiểu hiện tại vẫn được giữ.', 'Use Library images to guide appearance, background and outfits. Choices that do not apply to the current style are retained.')}</p>
      <div className="form-grid">
        <Field label={t('Giới tính nhân vật / giọng nói', 'Presenter / voice gender')}><select value={settings.gender} disabled={disabled || !mode.model && !mode.spoken} onChange={event => patch({ gender: event.target.value })}>{options(AFFILIATE_GENDERS)}</select></Field>
        <Field label={t('Độ tuổi', 'Age')}><select value={settings.age} disabled={disabled || !mode.model && !mode.spoken} onChange={event => patch({ age: event.target.value })}>{options(AFFILIATE_AGES)}</select></Field>
        <Field label={t('Giọng / vùng miền', 'Accent')}><select value={settings.accent} disabled={disabled || !mode.spoken} onChange={event => patch({ accent: event.target.value })}>{options(AFFILIATE_ACCENTS)}</select></Field>
      </div>
      <div className="form-grid">
        {assetField(t('Ảnh người mẫu (tùy chọn)', 'Presenter image (optional)'), settings.presenterAssetId, id => patch({ presenterAssetId: id }), mode.model)}
        {assetField(t('Ảnh bối cảnh (tùy chọn)', 'Background image (optional)'), settings.backgroundAssetId, id => patch({ backgroundAssetId: id }))}
      </div>
      {settings.contentStyle === 'lookbook' && <><h3>{t('Bộ trang phục Lookbook · tối đa 4 ảnh', 'Lookbook outfits · up to 4 images')}</h3><p className="inline-note">{t('Ưu tiên ảnh sản phẩm đang chọn. Chọn ảnh cho từng bộ, không lặp lại cùng một ảnh.', 'Start with selected product images. Choose an image for each outfit without duplicates.')}</p><div className="product-photo-list">{[...selectedImages, ...images.filter(asset => !productIds.includes(asset.id))].map(asset => <label className="check-row" key={asset.id}><input type="checkbox" checked={settings.outfitAssetIds.includes(asset.id)} disabled={disabled || !settings.outfitAssetIds.includes(asset.id) && settings.outfitAssetIds.length >= 4} onChange={event => patch({ outfitAssetIds: event.target.checked ? [...settings.outfitAssetIds, asset.id] : settings.outfitAssetIds.filter(id => id !== asset.id) })}/><img loading="lazy" src={window.studio?.mediaUrl(asset.id)} alt=""/>{asset.name}</label>)}</div></>}
      {settings.contentStyle === 'lookbook' && settings.outfitAssetIds.filter(id => !images.some(asset => asset.id === id)).map(id => <label className="check-row" key={id}><input type="checkbox" checked disabled={disabled} onChange={() => patch({ outfitAssetIds: settings.outfitAssetIds.filter(value => value !== id) })}/>{t('Bỏ ảnh trang phục không còn khả dụng', 'Clear unavailable outfit image')}: {id}</label>)}
      {missingOutfits && <p className="task-error">{t('Lookbook cần chọn ít nhất một ảnh trang phục trước khi phân tích.', 'Select at least one outfit image before analyzing a Lookbook.')}</p>}
      {!mode.model && settings.presenterAssetId && <p className="inline-note">{t('Chế độ hiện tại không dùng ảnh người mẫu. Lựa chọn được giữ để dùng lại khi đổi chế độ.', 'This mode does not use the presenter image. Your selection is retained for modes that use it.')}</p>}
      {referenceCount > MAX_AFFILIATE_REFERENCES && <p className="task-error">{t(`Chọn tối đa ${MAX_AFFILIATE_REFERENCES} ảnh nguồn, người mẫu và bối cảnh trước khi chạy.`, `Select at most ${MAX_AFFILIATE_REFERENCES} combined source, presenter and background images before running.`)}</p>}
      {missingReferences.length > 0 && <p className="task-error">{t('Một số ảnh tham chiếu đã chọn không còn trong Thư viện. Chọn lại hoặc bỏ ảnh trước khi chạy.', 'Some selected reference images are no longer in Library. Reselect or clear them before running.')}</p>}
    </section>

    <section className="editor-card affiliate-display">
      <h2>{t('3. Thông điệp và hiển thị', '3. Messaging and display')}</h2>
      {textField('caption', persistentCaption ? t('Caption xuyên suốt video', 'Persistent video caption') : t('Thông điệp chính / caption', 'Main message / caption'), 2, persistentCaption ? t('ASMR và POV dùng một caption xuyên suốt thay vì đổi chữ theo từng cảnh.', 'ASMR and POV use one persistent caption rather than changing text for each shot.') : undefined)}
      {stringValue(data.affiliateCaption) && <details className="details-block"><summary>{t('Caption trong video đã lập kế hoạch', 'Planned in-video caption')}</summary><Result value={data.affiliateCaption}/></details>}
      {textField('cta', t('Lời kêu gọi hành động', 'Call to action'))}
      {textField('affiliateUrl', t('Liên kết Affiliate (tùy chọn)', 'Affiliate link (optional)'))}
      <div className="form-grid">{([
        ['showPrice', t('Hiện giá đã có nguồn', 'Show sourced price')], ['screenText', t('Hiện chữ trên màn hình', 'Show on-screen text')],
        ['aiLabel', t('Nhãn nội dung AI', 'AI content label')], ['adLabel', t('Nhãn quảng cáo', 'Advertisement label')],
        ['endCard', t('Thẻ kết thúc', 'End card')],
      ] as const).map(([key, label]) => <label className="check-row" key={key}><input type="checkbox" disabled={disabled} checked={settings[key]} onChange={event => patch({ [key]: event.target.checked })}/>{label}</label>)}</div>
      {settings.showPrice && product.price === undefined && product.priceMin === undefined && <p className="inline-note">{t('Chưa có giá từ nguồn. Bổ sung giá đã xác minh trong tab Sản phẩm trước khi yêu cầu hiển thị giá.', 'No sourced price is available. Add a verified price in Product before requesting a price display.')}</p>}
      <p className="inline-note">{t('Chỉnh nhạc và âm lượng trong Âm thanh & xuất video; tỷ lệ và chất lượng nằm trong nhóm cài đặt xuất.', 'Set music and volume in Audio & video output; aspect ratio and quality are in export settings.')}{' '}{linkSummary}</p>
      <div className="inspection-row"><span>{t('Nhạc nền', 'Background music')}</span><div className="grow"><p>{data.musicMode === 'auto' ? t('Tự tạo / nhạc đã lưu', 'Auto / saved music') : data.musicMode === 'file' || data.musicId ? state.assets.find(asset => asset.id === data.musicId)?.name || t('Cần chọn audio', 'Choose audio') : t('Không nhạc nền', 'None')}</p></div></div>
    </section>

    <section className="editor-card" aria-label={t('Tiến trình Affiliate', 'Affiliate progress')}>
      <h2>{t('4. Duyệt và sản xuất', '4. Review and produce')}</h2>
      <div className="inspection-row"><span>{t('Số cảnh dự kiến', 'Estimated scenes')}</span><strong>{targetScenes}</strong></div>
      <div className="inspection-row"><span>{t('Cảnh trong kế hoạch hiện tại', 'Current planned shots')}</span><strong>{shots.length}</strong></div>
      <div className="inspection-row"><span>{t('Ảnh / clip đã tạo còn khả dụng', 'Available generated images / clips')}</span><strong>{generatedImages} / {generatedVideos}</strong></div>
      <p className="inline-note">{stringValue(data.script).trim() || shots.length ? t('Đã có kịch bản. Duyệt lời, caption và hành động trong Shot & timeline trước khi tạo hình.', 'A script is available. Review dialogue, captions and action in Shots & timeline before generating visuals.') : t('Chưa có kịch bản. Bắt đầu bằng Phân tích kịch bản.', 'No script yet. Start with Analyze script.')}</p>
      {(data.planningNeedsUpdate === true || data.productionStale === true) && <p className="inline-note" role="status">{t('Dữ liệu đã thay đổi sau kế hoạch hoặc output trước. Phân tích lại và kiểm tra trước khi dựng.', 'Inputs have changed since the previous plan or outputs. Analyze again and review before rendering.')}</p>}
      <div className="stage-buttons"><Button primary disabled={!canRun} onClick={() => onRun('plan')}>{t('Phân tích kịch bản', 'Analyze script')}</Button><Button disabled={!canRun} onClick={() => onRun('all')}>{t('Chạy toàn bộ', 'Run all stages')}</Button></div>
      <p className="inline-note">{t('Phân tích sẽ lập kế hoạch từ sản phẩm và lựa chọn trên. Duyệt từng bước bằng thanh Quy trình sản xuất; kết quả thực nằm ở Output & review.', 'Analysis builds a plan from your product and settings. Continue stage by stage in Production workflow; actual results appear in Outputs & review.')}</p>
      {data.affiliateReview !== undefined ? <AffiliatePlanReview value={data.affiliateReview} title={t('Kết quả duyệt kế hoạch đã lưu', 'Saved plan review')}/> : <p className="inline-note">{t('Chưa có kết quả duyệt kế hoạch Affiliate.', 'No Affiliate plan review result yet.')}</p>}
      {showTaskReview && <AffiliatePlanReview value={latestPlanTask.checkpoint.affiliateReview} title={t('Đánh giá của lần phân tích mới nhất', 'Latest analysis assessment')} error={latestPlanTask.error || stringValue(latestPlanTask.checkpoint.affiliatePlanError)}/>}
      {(post.caption !== undefined || post.hashtags !== undefined) && <section className="review-card" aria-label={t('Nội dung đăng bài', 'Post copy')}><h3>{t('Nội dung đăng bài', 'Post copy')}</h3><p className="inline-note">{t('Bản sao để đăng cùng video, tách biệt với caption hiện trong video.', 'Copy to publish alongside the video, separate from the in-video caption.')}</p>{post.caption !== undefined && <Field label={t('Caption đăng bài', 'Post caption')} hint={t('Tối đa 1.000 ký tự khi chỉnh. Nội dung thay đổi sẽ được review lại trước khi tạo media.', 'Up to 1,000 characters when editing. Changed copy is reviewed again before generation.')}><textarea rows={4} maxLength={1000} disabled={working} value={stringValue(post.caption)} onChange={event => onChange({ affiliatePost: { ...post, caption: event.target.value } })}/></Field>}{post.hashtags !== undefined && <><h3>Hashtags</h3><Result value={post.hashtags}/></>}{typeof record(project.data.production).affiliatePostAssetId === 'string' && <Button disabled={working} onClick={() => void act(() => invoke('asset.export', { id: record(project.data.production).affiliatePostAssetId }))}>{t('Xuất nội dung đăng bài', 'Export post copy')}</Button>}</section>}
      {tasks.length === 0 && <p className="inline-note">{t('Chưa có công việc cho dự án này.', 'No tasks for this project yet.')}</p>}
      {tasks.slice(0, 3).map(task => <article className="activity-row" key={task.id}><div className="activity-stage"><h3 className="grow">{task.name}</h3></div><Status value={task.status}/><progress max={1} value={Number.isFinite(task.progress) ? Math.min(1, Math.max(0, task.progress)) : 0} aria-label={`${task.name} ${t('tiến độ', 'progress')}`}/>{(task.error || task.message) && <p className={task.error ? 'task-error' : 'inline-note'}>{task.error || task.message}</p>}</article>)}
      {tasks.length > 0 && <p className="inline-note">{t('Xem toàn bộ công việc và thao tác hủy / tiếp tục trong Tiến trình dự án.', 'View all tasks and cancel or resume them in Project activity.')}</p>}
    </section>
  </section>;
}

function AffiliatePlanReview({ value, title, error }: { value: unknown; title: string; error?: string }) {
  const { t } = useStudio();
  const review = record(value), checks = record(review.checks ?? value);
  const label = (status: unknown) => status === 'pass' ? t('Đạt theo đánh giá', 'Assessment pass') : status === 'fail' ? t('Chưa đạt', 'Assessment fail') : t('Chưa đủ bằng chứng', 'Insufficient evidence');
  const status = (value: unknown) => ['pass', 'fail'].includes(String(value)) ? String(value) : 'unknown';
  return <section className="review-card" aria-label={title}>
    <div className="review-heading"><h3>{title}</h3><span className={`status review-${review.stale === true ? 'unknown' : status(review.status)}`}>{review.stale === true ? t('Đánh giá đã cũ', 'Stale assessment') : label(review.status)}</span></div>
    {review.stale === true && <p className="task-error" role="status">{t('Đánh giá đã cũ do kế hoạch được chỉnh sửa. Chạy Yêu cầu kiểm tra để duyệt lại bản đã chỉnh hoặc Phân tích để viết lại.', 'This assessment is stale because the plan was edited. Request review to assess the edited version, or Analyze to rewrite it.')}</p>}
    {review.modelAssessed === true && <p className="inline-note">{t('Kịch bản được đối chiếu độc lập với thông tin sản phẩm; đây chưa phải đánh giá chất lượng video cuối.', 'The script was independently compared with the product facts; this does not assess final video quality.')}</p>}
    {error && <p className="task-error" role="alert">{error}</p>}
    {(['facts', 'structure', 'host'] as const).filter(key => checks[key] !== undefined).map(key => {
      const check = record(checks[key]);
      return <div className="review-section" key={key}><div className="review-heading"><strong>{key === 'facts' ? t('Thông tin và tuyên bố', 'Facts and claims') : key === 'structure' ? t('Cấu trúc và thời lượng', 'Structure and timing') : t('Nhân vật và cách dẫn', 'Presenter and delivery')}</strong><span className={`status review-${status(check.status)}`}>{label(check.status)}</span></div><p className="inline-note">{stringValue(check.reason) || t('Chưa có lý do đánh giá.', 'No assessment reason returned.')}</p></div>;
    })}
    {typeof review.attempts === 'number' && <p className="inline-note">{t('Số bản kịch bản đã xét', 'Script drafts assessed')}: {review.attempts}</p>}
    <details className="details-block"><summary>{t('Chi tiết đánh giá', 'Assessment details')}</summary><Result value={value}/></details>
  </section>;
}

function AffiliateTextField({ projectId, settings, field, label, rows, hint, disabled, value, onChange, onValidation }: {
  projectId: string; settings: AffiliateSettings; field: 'notes' | 'caption' | 'cta' | 'affiliateUrl';
  label: string; rows?: number; hint?: string; disabled: boolean; value: string;
  onChange: (value: string) => void; onValidation: (error: string) => void;
}) {
  const { t } = useStudio();
  const [draft, setDraft] = useState(value), [error, setError] = useState('');
  useEffect(() => { setDraft(value); setError(''); onValidation(''); }, [projectId, value]);
  const change = (next: string) => {
    setDraft(next);
    try {
      readAffiliateSettings({ ...settings, [field]: next });
      setError(''); onValidation(''); onChange(next);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message); onValidation(message);
    }
  };
  return <Field label={label} hint={error ? `${t('Chưa áp dụng', 'Not applied')}: ${error}` : hint}>
    {rows ? <textarea rows={rows} value={draft} disabled={disabled} aria-invalid={!!error} onChange={event => change(event.target.value)}/>
      : <input type={field === 'affiliateUrl' ? 'url' : 'text'} value={draft} disabled={disabled} aria-invalid={!!error} onChange={event => change(event.target.value)}/>}
  </Field>;
}
