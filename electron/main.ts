import { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, safeStorage, shell } from 'electron';
import { join, resolve } from 'node:path';
import { copyFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { autoUpdater } from 'electron-updater';
import { StudioService } from '../src/core/studio';
import { object, publicUrl, redact } from '../src/core/store';
import type { StudioCommand } from '../src/shared/studio';
import { AppUpdates, handOffInstaller, type InstallerHandoff } from '../src/core/app-update';
import { mediaResponse } from './media';

protocol.registerSchemesAsPrivileged([{ scheme: 'studio-media', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } }]);
const isolatedRoot = process.env.MAISTUDIO_DATA_DIR;
if (isolatedRoot) app.setPath('userData', resolve(isolatedRoot));
let window: BrowserWindow | undefined;
let studio: StudioService | undefined;
let quitting = false;
let updates: AppUpdates | undefined;
const allowedFolders = new Set<string>();
const allowedExecutables = new Set<string>();
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
app.on('second-instance', () => { window?.show(); window?.focus(); });

function trusted(event: Electron.IpcMainInvokeEvent): void {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('IPC sender không được cấp quyền');
}
async function createWindow(): Promise<void> {
  window = new BrowserWindow({ width: 1480, height: 960, minWidth: 360, minHeight: 600, title: 'MaiStudio', backgroundColor: '#10121a',
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: studio-media:; media-src 'self' blob: studio-media:; connect-src 'self' studio-media:; font-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'"] } });
  });
  window.on('close', event => { if (!quitting) { event.preventDefault(); app.quit(); } });
  await window.loadFile(join(__dirname, '../../dist-ui/index.html'));
}
async function start(): Promise<void> {
  const root = app.getPath('userData');
  const keyFile = join(process.resourcesPath, 'license-public.pem');
  const licensePublicKey = existsSync(keyFile) ? await readFile(keyFile, 'utf8') : process.env.MAISTUDIO_LICENSE_PUBLIC_KEY;
  // GitHub releases feed from app-update.yml (build.publish); electron-updater checks sha512 from latest*.yml before update-downloaded.
  autoUpdater.autoDownload = false; autoUpdater.autoInstallOnAppQuit = false;
  updates = new AppUpdates({
    version: app.getVersion(), packaged: app.isPackaged, platform: process.platform, arch: process.arch, appImage: !!process.env.APPIMAGE,
    downloadDir: join(app.getPath('temp'), 'mai-studio-updates'),
    check: async prerelease => {
      autoUpdater.allowPrerelease = prerelease;
      const result = await autoUpdater.checkForUpdates();
      return result && { version: result.updateInfo.version, files: result.updateInfo.files, available: result.isUpdateAvailable };
    },
    download: () => autoUpdater.downloadUpdate(),
    install: installDownloadedUpdate,
    openPath: async path => { const failure = await shell.openPath(path); if (failure) throw new Error(failure); },
    openExternal: async url => { await shell.openExternal(publicUrl(url)); },
    fetch: ((url, init) => net.fetch(String(url), init)) as typeof fetch,
    changed: () => { studio?.emit('changed'); },
  });
  autoUpdater.on('error', error => updates?.failed(error));
  autoUpdater.on('download-progress', progress => updates?.progress(progress.percent));
  autoUpdater.on('update-downloaded', () => updates?.downloaded());
  studio = new StudioService(root, {
    version: app.getVersion(),
    commercial: app.isPackaged && !!licensePublicKey,
    licensePublicKey,
    encryption: {
      available: () => safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
      encrypt: value => safeStorage.encryptString(value), decrypt: value => safeStorage.decryptString(value),
    },
    actions: {
      openExternal: async url => { await shell.openExternal(publicUrl(url)); },
      copyText: async value => { clipboard.writeText(value); },
      openAsset: async path => { shell.showItemInFolder(path); },
      exportAsset: async (path, name) => { const chosen = await dialog.showSaveDialog({ defaultPath: name }); if (!chosen.canceled && chosen.filePath) await copyFile(path, chosen.filePath); else throw new Error('Đã hủy lưu tệp'); },
      checkUpdate: () => updates!.check(),
      installUpdate: beforeInstall => updates!.install(beforeInstall),
      updateState: () => updates!.view(),
    },
  });
  allowedFolders.add(studio.store.settings().outputDir);
  studio.on('changed', () => { if (window && !window.isDestroyed()) window.webContents.send('studio:changed'); });
  protocol.handle('studio-media', async request => {
    try {
      const url = new URL(request.url); if (url.hostname !== 'asset' || !/^\/[a-f0-9-]{36}$/.test(url.pathname) || request.method !== 'GET') return new Response('Not found', { status: 404 });
      const id = url.pathname.slice(1);
      return await mediaResponse(studio!.store.assetPath(id), studio!.store.asset(id).mime, request);
    } catch { return new Response('Not found', { status: 404 }); }
  });
  ipcMain.handle('studio:invoke', async (event, rawCommand: unknown, rawInput: unknown) => {
    trusted(event); const input = rawInput === undefined ? {} : object(rawInput);
    if (typeof rawCommand !== 'string' || rawCommand.length > 100) throw new Error('Command không hợp lệ');
    if (rawCommand === 'settings.save') {
      if (input.outputDir !== undefined && !allowedFolders.has(String(input.outputDir))) throw new Error('Chọn thư mục output qua nút chọn thư mục');
      for (const key of ['browserPath', 'ffmpegPath', 'ffprobePath'] as const) {
        const candidate = input[key];
        if (candidate && candidate !== studio!.store.settings()[key] && !allowedExecutables.has(String(candidate))) {
          const selected = await dialog.showMessageBox(window!, { type: 'question', buttons: ['Hủy', 'Dùng đường dẫn này'], defaultId: 0, cancelId: 0, message: `Cho phép chạy ${key}?`, detail: String(candidate) });
          if (selected.response !== 1) throw new Error('Chưa cấp quyền chạy binary'); allowedExecutables.add(String(candidate));
        }
      }
    }
    try { return await studio!.invoke(rawCommand as StudioCommand, input); }
    catch (error) { throw new Error(redact(error instanceof Error ? error.message : 'Thao tác thất bại')); }
  });
  ipcMain.handle('studio:pick-files', async event => {
    trusted(event); const selected = await dialog.showOpenDialog(window!, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Media / subtitles', extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'mkv', 'wav', 'mp3', 'm4a', 'srt', 'txt'] }] });
    return selected.canceled ? [] : studio!.importFiles(selected.filePaths);
  });
  ipcMain.handle('studio:pick-folder', async event => {
    trusted(event); const selected = await dialog.showOpenDialog(window!, { properties: ['openDirectory', 'createDirectory'] });
    if (selected.canceled || !selected.filePaths[0]) return null; allowedFolders.add(selected.filePaths[0]); return selected.filePaths[0];
  });
  await createWindow();
  void updates.check();
}
// Like quitAndInstall, but a failed handoff throws so the studio unlocks instead of waiting for a quit that never comes.
function installDownloadedUpdate(): void {
  const appImage = process.platform === 'linux';
  let target = process.env.APPIMAGE ?? process.execPath;
  const renamed = (path: string) => { target = path; };
  autoUpdater.once('appimage-filename-updated', renamed);
  // AppImage: forceRunAfter would start the new AppImage while this instance still holds the single-instance lock; relaunch after exit instead.
  try { handOffInstaller(autoUpdater as unknown as InstallerHandoff, !appImage); }
  finally { autoUpdater.off('appimage-filename-updated', renamed); }
  if (appImage) app.relaunch({ execPath: target, args: [] });
  app.quit();
}
if (singleInstance) app.whenReady().then(start).catch(async error => { dialog.showErrorBox('MaiStudio startup', redact(String(error))); quitting = true; await studio?.close(); app.exit(1); });
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault(); quitting = true;
  studio?.close().catch(error => { process.stderr.write(redact(String(error))); }).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
