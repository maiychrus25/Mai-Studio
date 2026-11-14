import { cloneElement, createContext, isValidElement, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { StudioCommand, StudioState } from '../shared/studio';

export interface StudioContextValue {
  state: StudioState;
  t: (vi: string, en: string) => string;
  busy: boolean;
  invoke: <T = unknown>(command: StudioCommand, input?: Record<string, unknown>) => Promise<T>;
  act: (action: () => Promise<unknown>) => Promise<void>;
  refresh: () => Promise<void>;
  confirm: (message: string, title?: string) => Promise<boolean>;
}
export const StudioContext = createContext<StudioContextValue | null>(null);
export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) throw new Error('Studio context unavailable');
  return context;
}
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    studio: <><rect x="3" y="5" width="18" height="15" rx="3"/><path d="m8 3 2 4m4-4 2 4M3 10h18m-11 4 4 2-4 2z"/></>,
    library: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/></>,
    srt: <><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 11h4m4 0h4M6 15h12"/></>,
    film: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4m10 0h4M3 16h4m10 0h4"/></>,
    series: <><rect x="6" y="7" width="15" height="14" rx="2"/><path d="M3 17V5a2 2 0 0 1 2-2h12m-5 8 5 3-5 3z"/></>,
    affiliate: <><path d="M3 4h7l11 11-6 6L3 9z"/><circle cx="7" cy="8" r="1"/></>,
    dub: <><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></>,
    accounts: <><circle cx="10" cy="7" r="4"/><path d="M3 21v-2a7 7 0 0 1 14 0v2m1-18a4 4 0 0 1 0 8m2 5a7 7 0 0 1 1 5"/></>,
    proxies: <><rect x="3" y="3" width="18" height="6" rx="2"/><rect x="3" y="15" width="18" height="6" rx="2"/><path d="M7 6h.01M7 18h.01M12 9v6"/></>,
    codex: <><path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/></>,
    market: <><path d="M3 9h18l-2-6H5zM4 9v12h16V9M9 21v-7h6v7"/></>,
    settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    play: <path d="m8 4 13 8-13 8z"/>,
    search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    refresh: <><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.studio}</svg>;
}
export function Button({ children, primary, danger, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; danger?: boolean }) {
  return <button type="button" {...props} className={`button ${primary ? 'primary' : ''} ${danger ? 'danger' : ''} ${props.className || ''}`}>{children}</button>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  const control = isValidElement<{ id?: string; 'aria-describedby'?: string }>(children)
    ? cloneElement(children, { id, ...(hint ? { 'aria-describedby': `${id}-hint` } : {}) }) : children;
  return <div className="field"><label htmlFor={id}>{label}</label>{control}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
export function Empty({ icon = 'studio', title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon name={icon} size={30}/></span><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}
export function Status({ value }: { value: string }) {
  const { t } = useStudio();
  const labels: Record<string, string> = {
    draft: t('Bản nháp', 'Draft'), queued: t('Đang chờ', 'Queued'), running: t('Đang chạy', 'Running'),
    waiting_input: t('Cần thao tác', 'Needs input'), paused: t('Tạm dừng', 'Paused'), succeeded: t('Hoàn tất', 'Succeeded'),
    failed: t('Thất bại', 'Failed'), cancelled: t('Đã hủy', 'Cancelled'), interrupted: t('Gián đoạn', 'Interrupted'),
    unconfigured: t('Chưa cấu hình', 'Unconfigured'), ready: t('Sẵn sàng', 'Ready'),
  };
  return <span className={`status status-${value}`}><span className="status-dot"/>{labels[value] || value}</span>;
}
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={wide ? 'dialog wide' : 'dialog'} aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); close.current(); }}>
    <div className="dialog-heading"><h2 id="dialog-title">{title}</h2><Button aria-label={useStudio().t('Đóng', 'Close')} onClick={onClose}><Icon name="close"/></Button></div>
    {children}
  </dialog>;
}
export function JsonField({ label, value, onChange, shape = 'object' }: { label: string; value: unknown; onChange: (value: unknown) => void; shape?: 'object' | 'array' }) {
  const { t } = useStudio();
  const serialized = JSON.stringify(value ?? (shape === 'array' ? [] : {}), null, 2);
  const [text, setText] = useState(serialized);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState('');
  useEffect(() => { setText(serialized); setError(''); textarea.current?.setCustomValidity(''); }, [serialized]);
  return <Field label={label} hint={error || t('JSON hợp lệ được áp dụng khi rời ô.', 'Valid JSON is applied when leaving the field.')}><textarea ref={textarea} className="code-input" rows={8} value={text} aria-invalid={!!error} onChange={e => {
    const next = e.target.value;
    setText(next);
    try {
      const parsed: unknown = JSON.parse(next);
      if (shape === 'array' ? !Array.isArray(parsed) : !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t('Sai cấu trúc JSON', 'Incorrect JSON structure'));
      setError('');
      e.target.setCustomValidity('');
    } catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); setError(message); e.target.setCustomValidity(message); }
  }} onBlur={() => { if (!error) onChange(JSON.parse(text)); }}/></Field>;
}
export function Result({ value }: { value: unknown }) {
  if (value === undefined) return null;
  return <pre className="result">{typeof value === 'string' ? value : JSON.stringify(value, (key, item) => key === 'embedding' || key === 'embeddings' ? undefined : item, 2)}</pre>;
}
export const displayBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export function AccountSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { state, t } = useStudio();
  return <Field label={t('Profile trình duyệt', 'Browser profile')}><select value={value} onChange={e => onChange(e.target.value)}><option value="">{t('Tự động chọn profile', 'Select automatically')}</option>{state.accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.status}</option>)}</select></Field>;
}
