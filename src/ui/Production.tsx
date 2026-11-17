import { useState } from 'react';
import type { Asset, Project, Shot, StudioStage } from '../shared/studio';
import { Button, Field, Modal, Status, useStudio } from './components';
import { AssetPreview } from './Workspace';

export const productionStages: { id: StudioStage; vi: string; en: string }[] = [
  { id: 'plan', vi: 'Phân tích bằng AI', en: 'Analyze with AI' },
  { id: 'characters', vi: 'Ảnh nhân vật', en: 'Character images' },
  { id: 'images', vi: 'Tạo ảnh', en: 'Generate images' },
  { id: 'videos', vi: 'Tạo video', en: 'Generate videos' },
  { id: 'speech', vi: 'Tạo lời đọc', en: 'Generate speech' },
  { id: 'music', vi: 'Nhạc nền', en: 'Music' },
  { id: 'check', vi: 'Yêu cầu kiểm tra', en: 'Request review' },
  { id: 'render', vi: 'Dựng từ output', en: 'Render outputs' },
  { id: 'all', vi: 'Chạy toàn bộ', en: 'Run all stages' },
];
export interface ShotGroup { label: string; scope: string; path: (string | number)[]; shots: Shot[] }
export function shotGroups(project: Project, data: Record<string, unknown>): ShotGroup[] {
  const groups: ShotGroup[] = [];
  function visit(source: Record<string, unknown>, scope: string, path: (string | number)[], label: string) {
    if (path.length > 4) return;
    const seriesRoot = project.kind === 'series' && path.length === 0;
    if (!seriesRoot && Array.isArray(source.shots)) {
      groups.push({ label, scope, path: [...path, 'shots'], shots: source.shots as Shot[] });
      return;
    }
    for (const field of seriesRoot ? ['episodes'] : ['scenes']) {
      if (!Array.isArray(source[field])) continue;
      source[field].forEach((item: unknown, index: number) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return;
        const record = item as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id : `${field === 'scenes' ? 'scene' : 'episode'}-${index + 1}`;
        const name = typeof record.name === 'string' ? record.name : typeof record.title === 'string' ? record.title : id;
        visit(record, `${scope}/${encodeURIComponent(id)}`, [...path, field, index], [label, name].filter(Boolean).join(' / '));
      });
    }
  }
  visit(data, encodeURIComponent(project.id), [], '');
  return groups;
}
export function replaceGroup(data: Record<string, unknown>, path: (string | number)[], shots: Shot[]): Record<string, unknown> {
  function replace(value: unknown, depth: number): unknown {
    if (depth === path.length) return shots;
    const key = path[depth];
    if (Array.isArray(value)) return value.map((item, index) => index === key ? replace(item, depth + 1) : item);
    const source = value as Record<string, unknown>;
    return { ...source, [key]: replace(source[key], depth + 1) };
  }
  return replace(data, 0) as Record<string, unknown>;
}
export function StageToolbar({ kind, onRun, selectedCount = 0, selected = false, nativeAudio = false, musicEnabled = false }: {
  kind: Project['kind']; onRun: (stage: StudioStage, force?: boolean) => void; selectedCount?: number; selected?: boolean; nativeAudio?: boolean; musicEnabled?: boolean;
}) {
  const { t, busy } = useStudio();
  const stages = productionStages.filter(stage => kind === 'dub' ? (selected ? ['speech'] : ['speech', 'check', 'render', 'all']).includes(stage.id) : (!selected || ['images', 'videos', 'speech', 'check'].includes(stage.id)) && !(kind === 'affiliate' && nativeAudio && stage.id === 'speech'));
  if (kind === 'affiliate' && !selected) stages.sort((a, b) => Number(b.id === 'all') - Number(a.id === 'all'));
  return <section className={selected ? 'selected-stages' : 'panel stage-panel'} aria-label={selected ? t('Thao tác trên shot đã chọn', 'Selected shot operations') : t('Các bước sản xuất', 'Production stages')}>
    <div className="section-heading"><div><h2>{selected ? t(`Chạy ${selectedCount} shot đã chọn`, `Run ${selectedCount} selected shots`) : t('Quy trình sản xuất', 'Production workflow')}</h2><p className="inline-note">{kind === 'dub' ? t('Lời đọc được lưu để dựng lại. Kiểm tra local chỉ xác minh stream/thời lượng, không xác minh nội dung bằng ASR và không tạo TTS.', 'Speech is cached for rendering. Local check validates streams/duration; it does not verify content with ASR or generate TTS.') : selected ? t('Chỉ gửi những shot đã chọn; output trước đó vẫn được core đối soát.', 'Only selected shots are submitted; core reconciles previously saved output.') : t('AI analysis và các bước tạo nội dung chạy qua hàng đợi. Dựng từ output chỉ dùng tài nguyên đã có.', 'AI analysis and generation run through the queue. Render outputs uses existing assets.')}</p></div></div>
    <div className="stage-buttons">{stages.map(stage => <Button key={stage.id} primary={!selected && stage.id === (kind === 'affiliate' ? 'all' : 'plan')} disabled={busy || (selected && !selectedCount) || (nativeAudio && stage.id === 'speech') || (stage.id === 'music' && !musicEnabled)} title={nativeAudio && stage.id === 'speech' ? t('Đang dùng âm thanh từ clip, không tạo TTS.', 'Using clip audio; TTS is disabled.') : stage.id === 'music' && !musicEnabled ? t('Chọn Auto hoặc file audio trong Chế độ nhạc nền.', 'Choose Auto or an audio file in Music mode.') : undefined} onClick={() => onRun(stage.id)}>{kind === 'dub' && stage.id === 'check' ? t('Kiểm tra local', 'Local check') : t(stage.vi, stage.en)}</Button>)}</div>
    <details className="details-block regenerate-controls"><summary>{selected ? t('Tạo lại shot đã chọn', 'Regenerate selected') : t('Tạo lại output', 'Regenerate outputs')}</summary>
      <p className="inline-note">{t('Yêu cầu tạo lại có thể tính thêm phí. Clip/ảnh được gán thủ công vẫn được giữ nguyên.', 'Regeneration may incur additional charges. Explicitly assigned clips and images are retained.')}</p>
      <div className="stage-buttons">{stages.filter(stage => ['music', 'characters', 'images', 'videos', 'speech'].includes(stage.id)).map(stage => <Button key={stage.id} disabled={busy || (selected && !selectedCount) || (nativeAudio && stage.id === 'speech') || (stage.id === 'music' && !musicEnabled)} onClick={() => onRun(stage.id, true)}>{({ music: t('Tạo lại nhạc', 'Regenerate music'), characters: t('Tạo lại ảnh nhân vật', 'Regenerate characters'), images: t('Tạo lại ảnh', 'Regenerate images'), videos: t('Tạo lại video', 'Regenerate videos'), speech: t('Tạo lại lời đọc', 'Regenerate speech') } as Record<string, string>)[stage.id]}</Button>)}</div>
    </details>
  </section>;
}
export function ProductionOutputs({ data, scope }: { data: Record<string, unknown>; scope?: string }) {
  const { state, t } = useStudio();
  const [preview, setPreview] = useState<Asset>();
  const [limit, setLimit] = useState(40);
  const production = data.production && typeof data.production === 'object' ? data.production as Record<string, unknown> : {};
  const labels: Record<string, string> = { characterImages: t('Ảnh nhân vật', 'Character image'), images: t('Ảnh shot', 'Shot image'), videos: t('Video shot', 'Shot video'), speech: t('Lời đọc', 'Speech') };
  const outputs = Object.entries(labels).flatMap(([stage, label]) => {
    const map = production[stage];
    if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
    return Object.entries(map).filter(([key, value]) => typeof value === 'string' && (!scope || key === scope || key.startsWith(`${scope}/`))).map(([key, id]) => ({ key, id: id as string, label, stage }));
  });
  const music = reviewRecord(production.music);
  if (!scope && typeof music.assetId === 'string') outputs.push({ key: 'music', id: music.assetId, stage: 'music', label: t('Nhạc nền', 'Music') });
  return <>{!scope && data.productionStale === true && <p className="inline-note" role="status">{t('Kế hoạch đã thay đổi. Output cũ được giữ lại; core sẽ kiểm tra khả năng tái sử dụng khi chạy bước tiếp theo.', 'The plan changed. Previous output is retained; core checks reuse when the next stage runs.')}</p>}<div className="section-heading"><h2>{scope ? t('Output của shot', 'Shot outputs') : t('Output sản xuất', 'Production outputs')} <span className="count-chip">{outputs.length}</span></h2></div>{!outputs.length ? <p className="inline-note">{t('Chưa có output đã lưu cho phạm vi này.', 'No saved output for this scope yet.')}</p> : <div className="production-outputs">{outputs.slice(0, limit).map(output => {
    const asset = state.assets.find(asset => asset.id === output.id);
    return <div className="production-output" key={`${output.stage}/${output.key}`}><div><span className="kind-label">{output.label}</span><small title={output.key}>{output.key}</small></div>{asset ? <Button aria-label={`${t('Xem', 'Preview')} ${asset.name}`} onClick={() => setPreview(asset)}>{asset.mime.startsWith('image/') && <img loading="lazy" src={window.studio!.mediaUrl(asset.id)} alt=""/>}{asset.name}</Button> : <span className="task-error">{t('Không có metadata tài nguyên', 'Asset metadata unavailable')}: {output.id}</span>}</div>;
  })}</div>}{outputs.length > limit && <Button onClick={() => setLimit(value => value + 40)}>{t('Xem thêm output', 'Show more outputs')}</Button>}<QualityResults value={data.qualityReviews} scope={scope} production={production}/>{preview && <AssetPreview asset={preview} onClose={() => setPreview(undefined)}/>}</>;
}
export function ProjectActivity({ projectId }: { projectId: string }) {
  const { state, t, invoke, act, confirm, busy } = useStudio();
  const [preview, setPreview] = useState<Asset>();
  const [limit, setLimit] = useState(40);
  const tasks = state.tasks.filter(task => task.projectId === projectId).slice().sort((a, b) => b.createdAt - a.createdAt);
  const action = (name: string, id: string) => void act(async () => {
    if (name === 'resume' && state.tasks.find(task => task.id === id)?.status === 'waiting_input' && !await confirm(t('Tiếp tục từ checkpoint sau khi đã xem review/lỗi và xử lý thao tác đang chờ?', 'Continue from the checkpoint after reviewing the results/errors and resolving the pending input?'))) return;
    if (['cancel', 'retry'].includes(name) && !await confirm(name === 'cancel' ? t('Hủy công việc này? Yêu cầu đã gửi tới provider có thể đã được tính phí.', 'Cancel this task? Work already accepted by a provider may have been charged.') : t('Thử lại công việc? Đối soát lần chạy gián đoạn trước khi gửi lại; provider có thể tính phí.', 'Retry this task? Reconcile interrupted work before resubmitting; provider charges may apply.'))) return;
    await invoke('task.action', { action: name, ids: [id] });
  });
  return <section id="project-activity" className="panel inspector-panel"><h2>{t('Tiến trình dự án', 'Project activity')} <span className="count-chip">{tasks.length}</span></h2>{!tasks.length && <p className="inline-note">{t('Chưa có công việc.', 'No tasks yet.')}</p>}{tasks.slice(0, limit).map(task => <article className="activity-row" key={task.id}><div className="activity-stage"><strong>{task.name}</strong><span className="kind-label">{String(task.input.stage || task.kind)}</span></div><Status value={task.status}/><progress max={1} value={task.progress} aria-label={`${task.name} ${t('tiến độ', 'progress')}`}/><small className="muted">{Math.round(task.progress * 100)}%</small>{(task.error || task.message) && <p className={task.error ? 'task-error' : 'inline-note'}>{task.error || task.message}</p>}<div className="actions">{['running', 'queued', 'waiting_input', 'paused'].includes(task.status) && <Button disabled={busy} onClick={() => action('cancel', task.id)}>{t('Hủy', 'Cancel')}</Button>}{['running', 'queued'].includes(task.status) && <Button disabled={busy} onClick={() => action('pause', task.id)}>{t('Tạm dừng', 'Pause')}</Button>}{['paused', 'waiting_input'].includes(task.status) && <Button disabled={busy} onClick={() => action('resume', task.id)}>{t('Tiếp tục', 'Resume')}</Button>}{['failed', 'interrupted', 'cancelled'].includes(task.status) && <Button disabled={busy} onClick={() => action('retry', task.id)}>{t('Thử lại', 'Retry')}</Button>}{task.status === 'waiting_input' && task.accountId && <Button disabled={busy} onClick={() => void act(() => invoke('account.open', { id: task.accountId }))}>{t('Mở profile', 'Open profile')}</Button>}</div><div className="output-list">{task.outputIds.map(id => { const asset = state.assets.find(asset => asset.id === id); return asset ? <Button key={id} onClick={() => setPreview(asset)}>{t('Xem', 'Preview')}: {asset.name}</Button> : null; })}</div></article>)}{tasks.length > limit && <Button onClick={() => setLimit(value => value + 40)}>{t('Xem thêm công việc', 'Show more tasks')} ({tasks.length - limit})</Button>}{preview && <AssetPreview asset={preview} onClose={() => setPreview(undefined)}/>}</section>;
}
function reviewRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function ReviewStatus({ value }: { value: unknown }) {
  const { t } = useStudio();
  const labels: Record<string, string> = {
    pass: t('Đạt theo đánh giá', 'Assessment pass'), fail: t('Chưa đạt theo đánh giá', 'Assessment fail'),
    unknown: t('Chưa kết luận', 'Unknown'), not_applicable: t('Không áp dụng', 'Not applicable'),
    reference_created: t('Mốc clip đầu tiên', 'First-clip baseline'),
    consistency_pass: t('Giọng nhất quán trong nhóm clip', 'Consistent within this clip group'),
    consistency_fail: t('Giọng chưa nhất quán trong nhóm clip', 'Inconsistent within this clip group'),
  };
  const status = typeof value === 'string' && Object.hasOwn(labels, value) ? value : 'unknown';
  return <span className={`status review-status review-${status}`}><span className="status-dot"/>{labels[status]}</span>;
}
export function QualityResults({ value, scope, production }: { value: unknown; scope?: string; production?: Record<string, unknown> }) {
  const { state, t } = useStudio();
  const [preview, setPreview] = useState<Asset>();
  const [limit, setLimit] = useState(40);
  const entries = Object.entries(reviewRecord(value)).filter(([key]) => !scope || key === scope || key.startsWith(`${scope}/`));
  const metric = (value: unknown, suffix = '', scale = 1) => typeof value === 'number' && Number.isFinite(value) ? `${(value * scale).toFixed(scale === 100 ? 1 : suffix === ' Hz' ? 0 : 2)}${suffix}` : t('Chưa có', 'Unavailable');
  if (!entries.length) return null;
  return <section className="quality-results" aria-label={t('Kết quả review', 'Review results')}>
    <h2>{t('Kết quả review từ core', 'Review results from core')} <span className="count-chip">{entries.length}</span></h2>
    <p className="inline-note">{t('Đây là đánh giá do mô hình hoặc thuật toán trả về để anh review, không phải bảo đảm chất lượng.', 'These are model or algorithm assessments for your review, not a quality guarantee.')}</p>
    {entries.slice(0, limit).map(([key, raw]) => {
      const review = reviewRecord(raw); const image = reviewRecord(review.image); const video = reviewRecord(review.video); const speech = reviewRecord(review.speech);
      const checks = reviewRecord(image.checks); const transcript = reviewRecord(speech.transcript); const acoustic = reviewRecord(speech.acoustic); const identity = reviewRecord(speech.identity);
      const intervals = Array.isArray(acoustic.parts) ? acoustic.parts : [];
      const currentImage = reviewRecord(production?.images)[key]; const currentVideo = reviewRecord(production?.videos)[key];
      const staleImage = typeof currentImage === 'string' && typeof image.assetId === 'string' && currentImage !== image.assetId;
      const staleSpeech = typeof currentVideo === 'string' && typeof speech.assetId === 'string' && currentVideo !== speech.assetId;
      const assets = [...new Set([image.assetId, video.assetId, speech.assetId].filter((id): id is string => typeof id === 'string'))].map(id => state.assets.find(asset => asset.id === id)).filter((asset): asset is Asset => !!asset);
      return <article className="review-card" key={key} aria-label={`${t('Review shot', 'Shot review')} ${key}`}>
        {!scope && <h3 className="review-shot-id">{key}</h3>}
        {Object.keys(image).length > 0 && <section className="review-section"><div className="review-heading"><h3>{t('Đánh giá ảnh', 'Image assessment')}</h3><ReviewStatus value={image.status}/></div>
          {staleImage && <p className="review-baseline">{t('Đánh giá này thuộc output trước. Chạy review để đánh giá output hiện tại.', 'This assessment belongs to previous output. Run review for the current output.')}</p>}
          {image.modelAssessed === true && <p className="inline-note">{t('Đánh giá bằng mô hình trên ảnh thực và ảnh tham chiếu.', 'Model assessment of the actual image and supplied references.')}</p>}
          <ul className="review-checks">{[['scene', t('Bối cảnh', 'Scene')], ['face', t('Khuôn mặt', 'Face')], ['outfit', t('Trang phục', 'Outfit')], ...(checks.product ? [['product', t('Sản phẩm', 'Product')]] : [])].map(([id, label]) => { const check = reviewRecord(checks[id]); return <li key={id}><div className="review-heading"><strong>{label}</strong><ReviewStatus value={check.status}/></div><p>{typeof check.reason === 'string' ? check.reason : t('Chưa có lý do đánh giá.', 'No assessment reason returned.')}</p></li>; })}</ul>
          {typeof image.at === 'number' && Number.isFinite(image.at) && <small className="muted">{new Date(image.at).toLocaleString(state.settings.language)}</small>}
        </section>}
        {Object.keys(video).length > 0 && <section className="review-section"><div className="review-heading"><h3>{t('Hành động và chuyển động video', 'Video action and motion')}</h3><ReviewStatus value={video.status}/></div>
          {typeof currentVideo === 'string' && video.assetId !== currentVideo && <p className="review-baseline">{t('Đánh giá thuộc clip trước. Chạy review cho clip hiện tại.', 'This assessment belongs to a previous clip. Review the current clip.')}</p>}
          <p className="inline-note">{t('Đánh giá từ bốn frame trong đoạn dùng khi dựng; cần xem video để kiểm tra phần giữa các frame.', 'Assessment of four frames from the edited interval; watch the video to check movement between samples.')}</p>
          <ul className="review-checks">{[['action', t('Hành động', 'Action')], ['motion', t('Chuyển động', 'Motion')], ['continuity', t('Liền mạch', 'Continuity')], ['identity', t('Nhân vật và phong cách', 'Identity and style')]].map(([id, label]) => { const check = reviewRecord(reviewRecord(video.checks)[id]); return <li key={id}><div className="review-heading"><strong>{label}</strong><ReviewStatus value={check.status}/></div><p>{typeof check.reason === 'string' ? check.reason : t('Chưa đủ bằng chứng.', 'Insufficient evidence.')}</p></li>; })}</ul>
          {Array.isArray(video.sampleTimes) && <p className="inline-note">{t('Mốc frame nguồn', 'Source frame times')}: {video.sampleTimes.map(time => typeof time === 'number' ? `${time.toFixed(2)}s` : '').join(' → ')}</p>}
          {Array.isArray(reviewRecord(production?.qualityTakes)[key]) && <p className="inline-note">{t('Số bản đã đánh giá và giữ lại', 'Assessed and retained takes')}: {(reviewRecord(production?.qualityTakes)[key] as unknown[]).length}</p>}
        </section>}
        {Object.keys(speech).length > 0 && <section className="review-section"><div className="review-heading"><h3>{t('Đánh giá lời nói', 'Speech assessment')}</h3><ReviewStatus value={speech.status}/></div>
          {staleSpeech && <p className="review-baseline">{t('Đánh giá giọng thuộc clip trước. Chạy review cho clip hiện tại.', 'This speech assessment belongs to a previous clip. Run review for the current clip.')}</p>}<p className="inline-note">{t('Đối chiếu nội dung', 'Content comparison')}: {speech.semantic === 'assessed' ? t('Đã đánh giá', 'Assessed') : t('Chưa kết luận', 'Unknown')}</p>
          <div className="review-transcripts"><div><strong>{t('Lời cần nói', 'Expected')}</strong><p>{typeof speech.expected === 'string' && speech.expected ? speech.expected : t('Không có lời thoại dự kiến.', 'No expected dialogue.')}</p></div><div><strong>{t('Lời nhận được', 'Heard')}</strong><p>{typeof speech.heard === 'string' && speech.heard ? speech.heard : t('Chưa có transcript.', 'No transcript returned.')}</p></div></div>
          <dl className="review-metrics"><div><dt>{t('Khớp từ', 'Word match')}</dt><dd>{metric(transcript.match, '%', 100)}</dd></div><div><dt>{t('Từ thừa', 'Extra words')}</dt><dd>{metric(transcript.extra, '%', 100)}</dd></div><div><dt>{t('Thời gian có giọng', 'Voiced audio')}</dt><dd>{metric(acoustic.voiced, ' s')}</dd></div><div><dt>{t('Cao độ f0', 'Pitch f0')}</dt><dd>{metric(acoustic.f0, ' Hz')}</dd></div></dl>
          {typeof transcript.ok === 'boolean' && <div className="review-heading"><strong>{t('So sánh transcript', 'Transcript comparison')}</strong><ReviewStatus value={transcript.ok ? 'pass' : 'fail'}/></div>}
          <div className="review-heading"><h4>{t('Tính nhất quán giọng', 'Speaker consistency')}</h4><ReviewStatus value={identity.status}/></div>
          {identity.status === 'reference_created' && <p className="review-baseline">{t('Clip đầu chỉ là mốc so sánh, chưa xác minh được giọng mong muốn.', 'The first clip is a comparison baseline, not verification of the desired voice.')}</p>}
          {typeof identity.reason === 'string' && <p className="inline-note">{identity.reason}</p>}
          {typeof identity.similarity === 'number' && <p className="inline-note">{t('Độ tương đồng cosine', 'Cosine similarity')}: {metric(identity.similarity)}</p>}
          {intervals.length > 0 && <details className="details-block"><summary>{t('Khoảng có giọng', 'Voiced intervals')} ({intervals.length})</summary><ol className="review-intervals">{intervals.slice(0, 20).map((interval, index) => { const part = reviewRecord(interval); return <li key={index}>{metric(part.start, ' s')} → {metric(part.end, ' s')}</li>; })}</ol></details>}
          {typeof speech.at === 'number' && Number.isFinite(speech.at) && <small className="muted">{new Date(speech.at).toLocaleString(state.settings.language)}</small>}
        </section>}
        {assets.length > 0 && <div className="actions">{assets.map(asset => <Button key={asset.id} onClick={() => setPreview(asset)}>{t('Xem tài nguyên review', 'Review asset')}: {asset.name}</Button>)}</div>}
      </article>;
    })}
    {entries.length > limit && <Button onClick={() => setLimit(value => value + 40)}>{t('Xem thêm review', 'Show more reviews')}</Button>}
    {preview && <AssetPreview asset={preview} onClose={() => setPreview(undefined)}/>}
  </section>;
}
export function ProductImport({ onImported }: { onImported: (projects: Project[]) => void }) {
  const { t, invoke, act, busy } = useStudio();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [result, setResult] = useState<Project[]>();
  const [error, setError] = useState('');
  const maxBytes = 8 * 1024 * 1024;
  return <><Button disabled={busy} onClick={() => { setOpen(true); setResult(undefined); setError(''); }}>{t('Nhập lô sản phẩm', 'Import product batch')}</Button>{open && <Modal title={t('Nhập sản phẩm CSV / JSON', 'Import CSV / JSON products')} onClose={() => setOpen(false)} wide><form onSubmit={event => { event.preventDefault(); void act(async () => {
    setError('');
    try {
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error(t('Dữ liệu nhập tối đa 8 MiB.', 'Import data is limited to 8 MiB.'));
    const projects = await invoke<Project[]>('project.import.products', { text, format });
    setResult(projects); onImported(projects); setText('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); throw cause; }
  }); }}>{error && <p className="task-error" role="alert">{error}</p>}<div className="form-grid"><Field label={t('Định dạng', 'Format')}><select value={format} onChange={event => setFormat(event.target.value as 'csv' | 'json')}><option value="csv">CSV</option><option value="json">JSON</option></select></Field><Field label={t('Tệp sản phẩm', 'Product file')}><input type="file" accept=".csv,.json,text/csv,application/json" onChange={event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (file) void act(async () => { setError(''); try { if (file.size > maxBytes) throw new Error(t('Tệp nhập tối đa 8 MiB.', 'Import file is limited to 8 MiB.')); setText(await file.text()); setFormat(file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv'); setResult(undefined); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); throw cause; } });
  }}/></Field></div><Field label={t('Dán dữ liệu sản phẩm', 'Paste product data')} hint={t('Tối đa 8 MiB / 1.000 sản phẩm. Core đọc CSV có dấu nháy và kiểm tra dữ liệu; mỗi sản phẩm tạo một dự án affiliate riêng.', 'Up to 8 MiB / 1,000 products. Core parses quoted CSV and validates facts; each product creates a separate affiliate project.')}><textarea className="code-input" rows={12} required value={text} onChange={event => { setText(event.target.value); setResult(undefined); }}/></Field>{result && <div role="status"><h3>{t(`Đã nhập ${result.length} dự án`, `Imported ${result.length} projects`)}</h3><ul className="import-results">{result.slice(0, 30).map(project => <li key={project.id}>{project.name}</li>)}</ul></div>}<div className="dialog-actions"><Button onClick={() => setOpen(false)}>{t('Đóng', 'Close')}</Button><Button primary type="submit" disabled={busy || !text.trim()}>{t('Nhập thành dự án', 'Import as projects')}</Button></div></form></Modal>}</>;
}
