import { useState } from 'react';
import type { UpdateView } from '../shared/studio';
import { Button, useStudio } from './components';

type Translate = (vi: string, en: string) => string;
export function updateMessage(update: UpdateView, t: Translate): string {
  const version = `MaiStudio ${update.version ?? ''}`.trim();
  switch (update.status) {
    case 'unsupported': return t('Chỉ bản cài mới cập nhật được.', 'Only installed builds can update.');
    case 'idle': return t('Chưa kiểm tra bản mới.', 'Not checked yet.');
    case 'checking': return t('Đang kiểm tra bản mới…', 'Checking for updates…');
    case 'latest': return t('Đang dùng bản mới nhất.', 'You are on the latest version.');
    case 'available': return t(`Có bản ${version}.`, `${version} is available.`);
    // No percentage here: this text sits in a live region and would be re-announced on every progress tick.
    case 'downloading': return t(`Đang tải ${version}…`, `Downloading ${version}…`);
    case 'downloaded': return update.mode === 'dmg'
      ? t(`Đã mở bộ cài ${version}. Kéo MaiStudio vào Applications, thoát app này rồi mở lại.`, `${version} installer is open. Drag MaiStudio to Applications, quit this app and open it again.`)
      : t(`${version} đã tải xong, sẵn sàng cài.`, `${version} is downloaded and ready to install.`);
    case 'error': return t(`Lỗi cập nhật: ${update.message ?? ''}`, `Update error: ${update.message ?? ''}`);
  }
}

function UpdateAction({ update }: { update: UpdateView }) {
  const { t, invoke, act, confirm, busy } = useStudio();
  if (!update.version || !['available', 'downloading', 'downloaded', 'error'].includes(update.status)) return null;
  if (update.status === 'downloading') return <Button primary disabled>{t(`Đang tải ${update.percent ?? 0}%`, `Downloading ${update.percent ?? 0}%`)}</Button>;
  const ready = update.status === 'downloaded';
  const label = update.mode === 'page' ? t('Mở trang tải', 'Open download page')
    : update.mode === 'dmg' ? (ready ? t('Mở lại bộ cài', 'Open installer again') : t('Tải bản cài', 'Download installer'))
      : ready ? t('Khởi động lại để cài', 'Restart to install') : t('Tải và cài', 'Download and install');
  return <Button primary disabled={busy} onClick={() => void act(async () => {
    if (update.mode === 'install' && ready && !await confirm(t('MaiStudio sẽ thoát, cài bản mới rồi tự mở lại. Đợi các tác vụ xong trước khi cài.', 'MaiStudio will quit, install the new version and reopen. Let running tasks finish first.'))) return;
    await invoke('update.install');
  })}>{label}</Button>;
}

export function UpdateBanner() {
  const { state, t } = useStudio();
  const update = state.update;
  const [dismissed, setDismissed] = useState('');
  const key = `${update.version}:${update.status}`;
  if (!update.version || !['available', 'downloading', 'downloaded', 'error'].includes(update.status) || dismissed === key) return null;
  return <div className="update-banner">
    <div><strong>{t(`Có bản MaiStudio ${update.version}`, `MaiStudio ${update.version} is available`)}</strong><p role="status">{update.status !== 'available' ? updateMessage(update, t)
      : update.mode === 'install' ? t('Tải nền; xong thì bấm Khởi động lại để cài.', 'Downloads in the background; then restart to install.')
        : update.mode === 'dmg' ? t('Tải dmg đúng máy, kiểm sha512 rồi mở để anh kéo vào Applications.', 'Downloads the dmg for this Mac, checks its sha512 and opens it for you to drag into Applications.')
          : t('Bản .deb cần tải từ trang phát hành.', 'The .deb build is downloaded from the release page.')}</p></div>
    <div className="actions"><UpdateAction update={update}/><Button onClick={() => setDismissed(key)}>{t('Để sau', 'Later')}</Button></div>
  </div>;
}

export function UpdatePanel() {
  const { state, t, invoke, act, busy } = useStudio();
  const update = state.update;
  return <>
    <h2>{t('Cập nhật ứng dụng', 'App updates')}</h2>
    <p className="inline-note">MaiStudio v{state.version} · {t('Bản mới lấy từ trang phát hành GitHub công khai và được kiểm sha512 trước khi cài.', 'Updates come from the public GitHub releases page and are checked by sha512 before installing.')}</p>
    <p className={`update-state update-${update.status}`} role="status">{updateMessage(update, t)}</p>
    {update.status === 'downloading' && <progress max={100} value={update.percent ?? 0} aria-label={t('Tiến độ tải bản cập nhật', 'Update download progress')}/>}
    <div className="actions"><Button disabled={busy || ['unsupported', 'checking', 'downloading', 'downloaded'].includes(update.status)} onClick={() => void act(() => invoke('update.check'))}>{t('Kiểm tra cập nhật', 'Check for updates')}</Button><UpdateAction update={update}/></div>
  </>;
}
