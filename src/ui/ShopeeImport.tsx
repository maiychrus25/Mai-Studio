import { useEffect, useState } from 'react';
import type { Project } from '../shared/studio';
import { Button, Field, Modal, Result, Status, useStudio } from './components';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const hasValue = (value: unknown): value is string | number => typeof value === 'string' ? !!value.trim() : typeof value === 'number' && Number.isFinite(value);

export function ShopeeImport({ project, saveProject }: { project: Project; saveProject: () => Promise<Project> }) {
  const { state, t, invoke, act, busy } = useStudio();
  const [url, setUrl] = useState('');
  const [capture, setCapture] = useState('');
  const [help, setHelp] = useState(false);
  const [bookmarklet, setBookmarklet] = useState('');
  const [copyNote, setCopyNote] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    const savedSource = record(project.data.productSource), savedProduct = record(project.data.product);
    setUrl(typeof savedSource.inputUrl === 'string' ? savedSource.inputUrl : typeof savedProduct.url === 'string' ? savedProduct.url : ''); setCapture(''); setHelp(false); setNote('');
  }, [project.id]);

  const product = record(project.data.product);
  const source = record(project.data.productSource);
  const provider = state.settings.providers.shopee;
  const apiReady = !!provider?.baseUrl?.trim() && provider.hasKey;
  const tasks = state.tasks.filter(task => task.projectId === project.id && task.kind === 'product-import').sort((a, b) => b.createdAt - a.createdAt);
  const importing = tasks.some(task => ['queued', 'running', 'waiting_input', 'paused'].includes(task.status));
  const missingFields = Array.isArray(source.missingFields) ? source.missingFields : [];
  const warnings = Array.isArray(source.warnings) ? source.warnings : [];
  const imageErrors = Array.isArray(source.imageErrors) ? source.imageErrors : [];
  const selectedIds = Array.isArray(project.data.productAssetIds) ? new Set(project.data.productAssetIds.filter((id): id is string => typeof id === 'string')) : undefined;
  const imageCount = selectedIds && state.assets.filter(asset => selectedIds.has(asset.id) && asset.mime.startsWith('image/')).length;
  const title = hasValue(product.name) ? product.name : hasValue(product.title) ? product.title : undefined;
  const facts: Array<[string, unknown]> = [
    [t('Giá', 'Price'), product.price],
    [t('Giá thấp nhất', 'Minimum price'), product.priceMin],
    [t('Giá cao nhất', 'Maximum price'), product.priceMax],
    [t('Đánh giá', 'Rating'), product.rating],
    [t('Số đánh giá', 'Rating count'), product.ratingCount],
    [t('Đã bán', 'Sold'), product.sold],
    [t('Cửa hàng', 'Shop'), product.shopName],
  ];

  const copyBookmarklet = () => void act(async () => {
    setCopyNote('');
    const result = await invoke<{ code: string; copied: boolean }>('shopee.bookmarklet', {});
    setBookmarklet(result.code);
    setCopyNote(result.copied
      ? t('Đã sao chép bookmarklet. Dán vào trường URL của dấu trang.', 'Bookmarklet copied. Paste it into the bookmark URL field.')
      : t('Không sao chép tự động được. Chọn mã bên dưới rồi nhấn Cmd+C hoặc Ctrl+C.', 'Automatic copy unavailable. Select the code below and press Cmd+C or Ctrl+C.'));
  });
  const importProduct = (official: boolean) => void act(async () => {
    setNote('');
    const saved = await saveProject();
    await invoke('shopee.import', { projectId: saved.id, url: url.trim(), ...(!official ? { text: capture } : {}) });
    setNote(t('Đã gửi công việc nhập. Xem tiến trình bên dưới; hủy hoặc thử lại trong Tiến trình dự án.', 'Import submitted. Follow its status below; cancel or retry in Project activity.'));
  });

  return <section className="editor-card" aria-label={t('Nhập sản phẩm Shopee', 'Shopee product intake')}>
    <h2>{t('Nhập sản phẩm Shopee', 'Import a Shopee product')}</h2>
    <p className="inline-note">{t('Mở liên kết bằng Chrome thông thường, dùng bookmarklet lấy dữ liệu rồi dán JSON vào đây. Nếu cần, đặt Chrome làm trình duyệt mặc định.', 'Open the link in normal Chrome, capture with the bookmarklet, then paste the JSON here. Set Chrome as your default browser if needed.')}</p>
    <Field label={t('1. Liên kết Shopee Việt Nam', '1. Shopee Vietnam link')} hint={t('Hỗ trợ liên kết dài hoặc rút gọn; core kiểm tra liên kết trước khi mở hoặc nhập.', 'Long and short links are supported; core validates links before opening or importing.')}>
      <input type="text" inputMode="url" autoComplete="off" value={url} disabled={busy} placeholder="https://shopee.vn/…" onChange={event => { setUrl(event.target.value); setNote(''); }} onPaste={event => {
        const text = event.clipboardData.getData('text/plain');
        if (!text.trimStart().startsWith('{')) return;
        event.preventDefault();
        setCapture(text);
        try {
          const data = record(JSON.parse(text));
          const link = typeof data.inputUrl === 'string' && data.inputUrl.trim() ? data.inputUrl : data.url;
          if (typeof link === 'string') setUrl(link);
        } catch { /* Core reports invalid capture data on import. */ }
        setNote(t('Đã chuyển JSON sang ô dữ liệu. Kiểm tra liên kết sản phẩm trước khi nhập.', 'JSON moved to the capture field. Check the product link before importing.'));
      }}/>
    </Field>
    <div className="actions">
      <Button disabled={busy || !url.trim()} onClick={() => void act(async () => {
        setNote('');
        const opened = await invoke<{ url: string; inputUrl: string; shopId: string; itemId: string }>('shopee.open', { url: url.trim() });
        setNote(`${t('Đã mở trong trình duyệt mặc định', 'Opened in the default browser')}: ${opened.url}`);
      })}>{t('Mở trong trình duyệt', 'Open in browser')}</Button>
      <Button disabled={busy} onClick={() => { setHelp(true); copyBookmarklet(); }}>{t('2. Hướng dẫn / sao chép bookmarklet', '2. Help / copy bookmarklet')}</Button>
    </div>
    <Field label={t('3. Dán dữ liệu sản phẩm đã lấy', '3. Paste captured product data')} hint={t('Dán nội dung từ nút Lấy SP trên trang sản phẩm đang mở.', 'Paste the data copied by the capture bookmark on the open product page.')}>
      <textarea className="code-input" rows={6} value={capture} disabled={busy} spellCheck={false} onChange={event => setCapture(event.target.value)} placeholder={t('Dán JSON từ trang sản phẩm vào đây', 'Paste JSON from the product page here')}/>
    </Field>
    <div className="actions">
      <Button primary disabled={busy || importing || !url.trim() || !capture.trim()} onClick={() => importProduct(false)}>{t('4. Nhập dữ liệu và ảnh', '4. Import facts and images')}</Button>
      <Button disabled={busy || importing || !url.trim() || !apiReady} onClick={() => importProduct(true)}>{t('Nhập bằng API chính thức', 'Import via official API')}</Button>
    </div>
    <p className="inline-note">{apiReady ? t('API chính thức dùng kết nối Shopee đã cấu hình, không dùng JSON trong ô trên.', 'Official API uses your configured Shopee connection and ignores the pasted JSON above.') : t('API Shopee chưa được cấu hình. Anh có thể dùng cách đọc từ trình duyệt ở trên.', 'The Shopee API is not configured. You can use the browser capture steps above.')}</p>
    {note && <p className="inline-note" role="status">{note}</p>}
    {tasks.length > 0 && <div aria-label={t('Tiến trình nhập Shopee', 'Shopee import progress')}>
      <p className="inline-note">{t('Hủy hoặc thử lại trong Tiến trình dự án.', 'Cancel or retry in Project activity.')}</p>
      {tasks.slice(0, 5).map(task => <article className="activity-row" key={task.id}>
        <div className="activity-stage"><strong>{task.name}</strong><Status value={task.status}/></div>
        {task.status === 'running' && <progress max={1} value={task.progress} aria-label={t('Tiến độ nhập sản phẩm', 'Product import progress')}/>}
        {(task.error || task.message) && <p className={task.error ? 'task-error' : 'inline-note'}>{task.error || task.message}</p>}
      </article>)}
    </div>}
    {Object.keys(product).length > 0 && <div className="review-section">
      <h3>{title ?? t('Chưa có tên sản phẩm', 'Product name unavailable')}</h3>
      {!hasValue(product.price) && <p className="inline-note">{t('Chưa có giá được xác minh.', 'Verified price unavailable.')}</p>}
      <dl className="review-metrics">{facts.filter(([, value]) => hasValue(value)).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="inline-note">{String(value)}</dd></div>)}</dl>
      {hasValue(product.description) && <Result value={product.description}/>}
      {product.attributes != null && <details><summary>{t('Thuộc tính', 'Attributes')}</summary><Result value={product.attributes}/></details>}
      {product.variationGroups != null && <details><summary>{t('Nhóm phân loại', 'Variation groups')}</summary><Result value={product.variationGroups}/></details>}
      {product.variations != null && <details><summary>{t('Phân loại', 'Variations')}</summary><Result value={product.variations}/></details>}
      <p className="inline-note">{imageCount !== undefined ? t(`Ảnh đã nhập đang chọn trong Library: ${imageCount}`, `Imported images selected in Library: ${imageCount}`) : t('Chưa có danh sách ảnh tham chiếu đã nhập.', 'Imported reference image selection unavailable.')}</p>
      {(missingFields.length > 0 || warnings.length > 0 || imageErrors.length > 0) && <div role="status">
        <p className="review-baseline">{t('Dữ liệu nhập chưa đầy đủ hoặc có cảnh báo. Kiểm tra phần thiếu và lỗi ảnh trước khi dùng để tạo nội dung.', 'This import is partial or has warnings. Review missing fields and image errors before generating content.')}</p>
        {missingFields.length > 0 && <><h3>{t('Trường còn thiếu', 'Missing fields')}</h3><Result value={missingFields}/></>}
        {warnings.length > 0 && <><h3>{t('Cảnh báo', 'Warnings')}</h3><Result value={warnings}/></>}
        {imageErrors.length > 0 && <><h3>{t('Ảnh không nhập được', 'Image import errors')}</h3><Result value={imageErrors}/></>}
      </div>}
    </div>}
    {Object.keys(source).length > 0 && <>
      {hasValue(source.url) && <p className="inline-note">{t('Nguồn', 'Source')}: {source.url}</p>}
      <details><summary>{t('Metadata nguồn nhập', 'Import source metadata')}</summary><Result value={source}/></details>
    </>}
    {help && <Modal title={t('Lấy dữ liệu từ Chrome', 'Capture product data in Chrome')} onClose={() => setHelp(false)}>
      <p className="inline-note">{t('Dùng Chrome thông thường trên Mac hoặc Linux, tại trang sản phẩm Shopee Việt Nam đã tải xong.', 'Use normal Chrome on Mac or Linux with the Shopee Vietnam product page fully loaded.')}</p>
      <ol className="import-results">
        <li>{t('Hiện thanh dấu trang: Cmd+Shift+B trên Mac hoặc Ctrl+Shift+B trên Linux.', 'Show the bookmarks bar: Cmd+Shift+B on Mac or Ctrl+Shift+B on Linux.')}</li>
        <li>{t('Thêm dấu trang bất kỳ bằng Cmd+D / Ctrl+D. Đặt tên “Shopee capture”, lưu vào thanh dấu trang.', 'Add a bookmark with Cmd+D / Ctrl+D. Name it “Shopee capture” and save it to the bookmarks bar.')}</li>
        <li>{t('Nhấp phải dấu trang → Chỉnh sửa. Thay toàn bộ URL bằng mã đã sao chép bên dưới (giữ tiền tố javascript:) rồi lưu.', 'Right-click the bookmark → Edit. Replace the entire URL with the copied code below (keep the javascript: prefix), then save.')}</li>
        <li>{t('Trên trang sản phẩm, bấm dấu trang vừa tạo. Sao chép JSON được cung cấp, quay lại MaiStudio và dán vào bước 3.', 'On the product page, click your new bookmark. Copy the resulting JSON, return to MaiStudio and paste it into step 3.')}</li>
      </ol>
      <Field label={t('Mã bookmarklet (chỉ đọc)', 'Bookmarklet code (read only)')} hint={t('Chọn toàn bộ bằng Cmd+A / Ctrl+A, sao chép bằng Cmd+C / Ctrl+C nếu clipboard tự động không khả dụng.', 'Use Cmd+A / Ctrl+A to select all and Cmd+C / Ctrl+C to copy if automatic clipboard copy is unavailable.')}>
        <textarea className="code-input" rows={5} value={bookmarklet} readOnly spellCheck={false} onFocus={event => event.currentTarget.select()}/>
      </Field>
      {copyNote && <p className="inline-note" role="status">{copyNote}</p>}
      <div className="dialog-actions"><Button disabled={busy} onClick={copyBookmarklet}>{t('Sao chép', 'Copy')}</Button><Button onClick={() => setHelp(false)}>{t('Đóng', 'Close')}</Button></div>
    </Modal>}
  </section>;
}
