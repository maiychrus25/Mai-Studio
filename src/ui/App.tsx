import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, ProjectKind, StudioCommand, StudioState } from '../shared/studio';
import { Button, Empty, Field, Icon, Modal, StudioContext, useStudio, type StudioContextValue } from './components';
import { Library, Studio } from './Workspace';
import { AdvancedStudio } from './AdvancedStudio';
import { Connections, Codex, Market } from './Connections';
import { SettingsView } from './Settings';
import { ProductImport } from './Production';

export type Page = ProjectKind | 'library' | 'market' | 'accounts' | 'proxies' | 'codex' | 'settings';
const navigation: { id: Page; vi: string; en: string; group: number }[] = [
  { id: 'studio', vi: 'Studio', en: 'Studio', group: 0 }, { id: 'library', vi: 'Thư viện', en: 'Library', group: 0 },
  { id: 'srt', vi: 'SRT Video', en: 'SRT Video', group: 1 }, { id: 'film', vi: 'Làm phim', en: 'Films', group: 1 },
  { id: 'series', vi: 'Series', en: 'Series', group: 1 }, { id: 'affiliate', vi: 'Video Affiliate', en: 'Video Affiliate', group: 1 },
  { id: 'dub', vi: 'Lồng tiếng', en: 'Dubbing', group: 1 },
  { id: 'market', vi: 'Market', en: 'Market', group: 2 }, { id: 'accounts', vi: 'Tài khoản', en: 'Accounts', group: 2 },
  { id: 'proxies', vi: 'Proxy', en: 'Proxies', group: 2 }, { id: 'codex', vi: 'Codex AI', en: 'Codex AI', group: 2 },
  { id: 'settings', vi: 'Cài đặt', en: 'Settings', group: 3 },
];

export default function App() {
  const [state, setState] = useState<StudioState>();
  const [page, setPage] = useState<Page>('studio');
  const [selected, setSelected] = useState<Partial<Record<ProjectKind, string>>>({});
  const [drawer, setDrawer] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(0);
  const [projectEdit, setProjectEdit] = useState<{ project?: Project }>();
  const [confirmation, setConfirmation] = useState<{ message: string; title?: string; resolve: (confirmed: boolean) => void }>();
  const confirmationRef = useRef(confirmation);
  confirmationRef.current = confirmation;
  const request = useRef(0);
  const appliedRequest = useRef(0);
  const t = useCallback((vi: string, en: string) => state?.settings.language === 'en' ? en : vi, [state?.settings.language]);
  const refresh = useCallback(async () => {
    if (!window.studio) throw new Error('Không có kết nối desktop. Mở MaiStudio bằng Electron. / Desktop bridge unavailable. Open MaiStudio in Electron.');
    const current = ++request.current;
    const next = await window.studio.invoke<StudioState>('state');
    if (current > appliedRequest.current) { appliedRequest.current = current; setState(next); }
  }, []);
  const act = useCallback(async (action: () => Promise<unknown>) => {
    setPending(count => count + 1);
    setError('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(count => count - 1); }
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    void act(refresh);
    const unsubscribe = window.studio?.onChanged(() => {
      if (timer !== undefined) return;
      timer = setTimeout(() => { timer = undefined; if (!disposed) void refresh().catch(cause => { if (!disposed) setError(String(cause)); }); }, 80);
    });
    return () => { disposed = true; clearTimeout(timer); unsubscribe?.(); };
  }, [refresh, act]);
  useEffect(() => {
    if (!state) return;
    document.documentElement.dataset.theme = state.settings.theme;
    document.documentElement.lang = state.settings.language;
    document.title = 'MaiStudio';
  }, [state?.settings.theme, state?.settings.language]);
  useEffect(() => { setDrawer(false); }, [page]);
  useEffect(() => () => confirmationRef.current?.resolve(false), []);
  const invoke = useCallback(async <T,>(command: StudioCommand, input?: Record<string, unknown>) => {
    if (!window.studio) throw new Error('Desktop bridge unavailable');
    const result = await window.studio.invoke<T>(command, input);
    if (command !== 'state') await refresh();
    return result;
  }, [refresh]);
  const confirm: StudioContextValue['confirm'] = (message, title) => new Promise(resolve => {
    confirmationRef.current?.resolve(false);
    setConfirmation({ message, title, resolve });
  });
  const finishConfirmation = (answer: boolean) => { confirmation?.resolve(answer); setConfirmation(undefined); };
  if (!state) return <main className="startup"><div className="brand-mark">M<span>✦</span></div><h1>MaiStudio</h1><p>{error || 'Đang kết nối workspace… / Connecting workspace…'}</p><Button primary disabled={pending > 0} onClick={() => void act(refresh)}>{t('Kết nối lại', 'Reconnect')}</Button></main>;
  const context: StudioContextValue = { state, t, invoke, act, refresh, confirm, busy: pending > 0 };
  const currentNav = navigation.find(item => item.id === page)!;
  const projectPage = ['studio', 'srt', 'film', 'series', 'affiliate', 'dub'].includes(page);
  const kind = page as ProjectKind;
  const projects = state.projects.filter(project => project.kind === kind && !project.data.system);
  const project = projects.find(project => project.id === selected[kind]) || projects[0];
  const running = state.tasks.filter(task => task.status === 'running').length;
  const capabilities = state.capabilities.filter(capability => capability.ready).length;
  return <StudioContext.Provider value={context}>
    <a className="skip-link" href="#workspace">{t('Đến nội dung', 'Skip to workspace')}</a>
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#studio" onClick={e => { e.preventDefault(); setPage('studio'); }}><span className="brand-mark">M<span>✦</span></span><span>MaiStudio<small>PRODUCTION WORKSPACE</small></span></a>
        <div className="workspace-label"><span className="workspace-avatar">M</span><div>{t('Không gian cá nhân', 'Personal workspace')}<small>{t('Dữ liệu trên thiết bị', 'Stored on this device')}</small></div><span className="local-dot"/></div>
        <nav aria-label={t('Điều hướng chính', 'Main navigation')}><Navigation page={page} onSelect={setPage}/></nav>
        <div className="sidebar-bottom"><div className="local-note"><span className="local-dot"/>{t('Workspace cục bộ', 'Local workspace')}<span className="version">v{state.version}</span></div><small>{t('Ý tưởng của anh. Quy trình của anh.', 'Your ideas. Your workflow.')}</small></div>
      </aside>
      <div className="main-shell">
        <header className="topbar"><div className="breadcrumb"><Button className="mobile-menu" aria-label={t('Mở điều hướng', 'Open navigation')} onClick={() => setDrawer(true)}><Icon name="menu"/></Button><span className="desktop-label">{t('Không gian làm việc', 'Workspace')}</span><span className="desktop-label">/</span><strong>{t(currentNav.vi, currentNav.en)}</strong></div><div className="topbar-actions"><span className="runtime"><span className={`status-dot ${running ? 'active-dot' : ''}`}/>{running} {t('đang chạy', 'running')}</span><Button aria-label={t('Làm mới trạng thái', 'Refresh state')} disabled={context.busy} onClick={() => void act(refresh)}><Icon name="refresh" size={16}/></Button><Button aria-label={t('Chuyển giao diện sáng tối', 'Toggle light and dark theme')} disabled={context.busy} onClick={() => void act(() => invoke('settings.save', { theme: state.settings.theme === 'dark' ? 'light' : 'dark' }))}>{state.settings.theme === 'dark' ? '☀' : '☾'}</Button><span className="user-avatar" title={t('Workspace cục bộ', 'Local workspace')}>M</span></div></header>
        <main id="workspace" className="workspace" tabIndex={-1}>
          {error && <div role="alert" className="error-banner"><span>{error}</span><Button onClick={() => setError('')} aria-label={t('Đóng lỗi', 'Dismiss error')}><Icon name="close" size={16}/></Button></div>}
          <div className="page-heading"><div><div className="eyebrow">{projectPage ? 'CREATE & PRODUCE' : 'YOUR WORKSPACE'}</div><h1>{t(currentNav.vi, currentNav.en)}{page === 'studio' && <span className="heading-tag">AI WORKSPACE</span>}</h1><p>{page === 'studio' ? t('Từ ý tưởng đầu tiên đến sản phẩm hoàn chỉnh.', 'From the first idea to the final frame.') : page === 'library' ? t('Mọi tài nguyên. Một thư viện.', 'Every asset. One library.') : t('Làm chủ từng bước trong quy trình sáng tạo.', 'Stay in control of your creative workflow.')}</p></div><div className="actions">{page === 'affiliate' && <ProductImport onImported={projects => { if (projects[0]) setSelected(previous => ({ ...previous, affiliate: projects[0].id })); }}/>}{projectPage && <Button primary disabled={context.busy} onClick={() => setProjectEdit({})}><Icon name="plus" size={16}/>{t('Dự án mới', 'New project')}</Button>}</div></div>
          {projectPage && <div className="project-toolbar"><div className="project-picker"><Icon name={page}/><label className="sr-only" htmlFor="project-picker">{t('Dự án hiện tại', 'Current project')}</label><select id="project-picker" value={project?.id || ''} onChange={e => setSelected(previous => ({ ...previous, [kind]: e.target.value }))}>{!projects.length && <option value="">{t('Chưa có dự án', 'No projects yet')}</option>}{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select><span className="count-chip">{projects.length}</span></div><div className="actions">{project && <><Button disabled={context.busy} onClick={() => setProjectEdit({ project })}>{t('Đổi tên', 'Rename')}</Button><Button danger disabled={context.busy} onClick={() => void act(async () => { if (await confirm(t(`Xóa dự án “${project.name}” và các công việc liên quan?`, `Delete “${project.name}” and its related tasks?`))) await invoke('project.delete', { id: project.id }); })}>{t('Xóa', 'Delete')}</Button></>}</div></div>}
          {projectPage && project && !state.accounts.length && !state.settings.providers.image?.baseUrl && <div className="setup-banner"><div><strong>{t('Kết nối provider để bắt đầu sản xuất', 'Connect a provider to start producing')}</strong><p>{t('Anh có thể lưu nháp ngay. Để chạy, cấu hình API hoặc thêm profile trình duyệt và đăng nhập.', 'You can save drafts now. To run work, configure an API or add a browser profile and sign in.')}</p></div><div className="actions"><Button onClick={() => setPage('settings')}>{t('Cấu hình provider', 'Configure provider')}</Button><Button onClick={() => setPage('accounts')}>{t('Thêm profile', 'Add profile')}</Button></div></div>}
          {projectPage && !project ? <div className="panel"><Empty title={t('Bắt đầu một điều mới', 'Start something new')} action={<Button primary onClick={() => setProjectEdit({})}><Icon name="plus" size={16}/>{t('Tạo dự án đầu tiên', 'Create your first project')}</Button>}>{t('Tạo dự án để lưu prompt, quản lý công việc và tập hợp thành phẩm.', 'Create a project to save prompts, manage tasks and bring your output together.')}</Empty></div> : page === 'studio' && project ? <Studio key={project.id} project={project}/> : projectPage && project ? <AdvancedStudio key={project.id} project={project}/> : page === 'library' ? <Library/> : page === 'accounts' || page === 'proxies' ? <Connections key={page} mode={page}/> : page === 'market' ? <Market/> : page === 'codex' ? <Codex/> : <SettingsView/>}
          <footer className="workspace-footer"><span>MaiStudio <span className="muted">/</span> {t('Không gian cho sáng tạo', 'Room for your ideas')}</span><details className="readiness"><summary>{capabilities}/{state.capabilities.length} {t('khả năng sẵn sàng', 'capabilities ready')}</summary><div>{state.capabilities.length ? state.capabilities.map(capability => <p key={capability.id}><strong>{capability.id} · {capability.ready ? t('Sẵn sàng', 'Ready') : t('Chưa sẵn sàng', 'Not ready')}</strong><small>{capability.message}</small></p>) : <p>{t('Chưa có thông tin khả năng từ core.', 'No capability information from core yet.')}</p>}</div></details></footer>
        </main>
      </div>
    </div>
    {drawer && <Modal title={t('Điều hướng', 'Navigation')} onClose={() => setDrawer(false)}><nav aria-label={t('Điều hướng mobile', 'Mobile navigation')}><Navigation page={page} onSelect={next => { setPage(next); setDrawer(false); }}/></nav></Modal>}
    {projectEdit && <ProjectDialog project={projectEdit.project} kind={kind} onClose={() => setProjectEdit(undefined)} onSaved={saved => { setSelected(previous => ({ ...previous, [saved.kind]: saved.id })); setProjectEdit(undefined); }}/>}
    {confirmation && <Modal title={confirmation.title || t('Xác nhận thao tác', 'Confirm action')} onClose={() => finishConfirmation(false)}><p className="confirmation-copy">{confirmation.message}</p><div className="dialog-actions"><Button autoFocus onClick={() => finishConfirmation(false)}>{t('Quay lại', 'Go back')}</Button><Button primary onClick={() => finishConfirmation(true)}>{t('Xác nhận', 'Confirm')}</Button></div></Modal>}
    {context.busy && <div className="activity-indicator" role="status"><span className="spinner"/>{t('Đang xử lý…', 'Working…')}</div>}
  </StudioContext.Provider>;
}
function Navigation({ page, onSelect }: { page: Page; onSelect: (page: Page) => void }) {
  const context = useStudio();
  return <>{navigation.map((item, index) => <div key={item.id}>{(index === 0 || navigation[index - 1].group !== item.group) && <div className="nav-group">{item.group === 0 ? context.t('TỔNG QUAN', 'OVERVIEW') : item.group === 1 ? context.t('CÔNG CỤ SÁNG TẠO', 'CREATIVE TOOLS') : item.group === 2 ? context.t('QUẢN LÝ', 'MANAGE') : context.t('HỆ THỐNG', 'SYSTEM')}</div>}<button className={`nav-item ${page === item.id ? 'selected' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => onSelect(item.id)}><Icon name={item.id} size={18}/><span>{context.t(item.vi, item.en)}</span>{item.id === 'library' && !!context.state.assets.length && <span className="nav-count" aria-hidden="true">{context.state.assets.length}</span>}{page === item.id && <span className="nav-active-dot"/>}</button></div>)}</>;
}
function ProjectDialog({ project, kind, onClose, onSaved }: { project?: Project; kind: ProjectKind; onClose: () => void; onSaved: (project: Project) => void }) {
  const { t, invoke, act, busy } = useStudio();
  const [name, setName] = useState(project?.name || '');
  return <Modal title={project ? t('Đổi tên dự án', 'Rename project') : t('Dự án mới', 'New project')} onClose={onClose}><form onSubmit={e => { e.preventDefault(); void act(async () => onSaved(await invoke<Project>('project.save', { ...(project ? { id: project.id } : {}), kind: project?.kind || kind, name: name.trim(), ...(project ? { data: project.data } : kind === 'film' ? { data: { nativeAudio: true, dub: false } } : {}) }))); }}><Field label={t('Tên dự án', 'Project name')}><input autoFocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} placeholder={t('Đặt tên cho ý tưởng của anh', 'Give your idea a name')}/></Field><div className="dialog-actions"><Button onClick={onClose}>{t('Hủy', 'Cancel')}</Button><Button primary type="submit" disabled={busy || !name.trim()}>{t('Lưu dự án', 'Save project')}</Button></div></form></Modal>;
}
