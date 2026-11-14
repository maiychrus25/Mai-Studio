import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, shell } from 'electron';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { copyFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { autoUpdater } from 'electron-updater';
import { StudioService } from '../src/core/studio';
import { object, publicUrl, redact } from '../src/core/store';
import type { StudioCommand } from '../src/shared/studio';
import { SignedUpdateGate } from '../src/core/updates';

protocol.registerSchemesAsPrivileged([{ scheme: 'studio-media', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } }]);
const isolatedRoot = process.env.MAISTUDIO_DATA_DIR;
if (isolatedRoot) app.setPath('userData', resolve(isolatedRoot));
let window: BrowserWindow | undefined;
let studio: StudioService | undefined;
let quitting = false;
let updateReady = false;
let downloadedUpdate: { path: string; version: string } | undefined;
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
  const updateGate = licensePublicKey ? new SignedUpdateGate({ publicKey: licensePublicKey, platform: process.platform, arch: process.arch, currentVersion: app.getVersion() }) : undefined;
  const updateFeed = process.env.MAISTUDIO_UPDATE_FEED;
  if (updateFeed) { autoUpdater.setFeedURL({ provider: 'generic', url: publicUrl(updateFeed) }); autoUpdater.autoDownload = false; }
  autoUpdater.on('error', error => { studio?.store.log(redact(error.message), 'error'); studio?.emit('changed'); });
  autoUpdater.on('update-downloaded', info => {
    updateReady = false;
    if (!updateGate) { studio?.store.log('Update authority public key chưa được cấu hình', 'error'); return; }
    void updateGate.verifyFile(info.downloadedFile, info.version).then(() => { downloadedUpdate = { path: info.downloadedFile, version: info.version }; updateReady = true; studio?.emit('changed'); })
      .catch(error => { downloadedUpdate = undefined; studio?.store.log(redact(String(error)), 'error'); studio?.emit('changed'); });
  });
  studio = new StudioService(root, {
    commercial: app.isPackaged && !!licensePublicKey,
    licensePublicKey,
    encryption: {
      available: () => safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
      encrypt: value => safeStorage.encryptString(value), decrypt: value => safeStorage.decryptString(value),
    },
    actions: {
      openExternal: async url => { await shell.openExternal(publicUrl(url)); },
      openAsset: async path => { shell.showItemInFolder(path); },
      exportAsset: async (path, name) => { const chosen = await dialog.showSaveDialog({ defaultPath: name }); if (!chosen.canceled && chosen.filePath) await copyFile(path, chosen.filePath); else throw new Error('Đã hủy lưu tệp'); },
      checkUpdate: async () => {
        if (!app.isPackaged || !updateFeed || !updateGate) throw new Error('Cần update feed và public key authority cho bản phát hành');
        const hub = studio!.store.settings().providers.license.baseUrl; if (!hub) throw new Error('Cấu hình License Hub để xác minh signed update manifest');
        await updateGate.check(hub, updateFeed);
        const update = await autoUpdater.checkForUpdates();
        if (!update) throw new Error('Không đọc được update metadata');
        updateGate.assertMetadata(update.updateInfo);
        return { version: update?.updateInfo.version ?? app.getVersion(), downloaded: updateReady };
      },
      installUpdate: async beforeInstall => {
        if (!updateGate || !updateFeed || !app.isPackaged) throw new Error('Chưa có signed update feed');
        if (!updateReady) { const info = await autoUpdater.checkForUpdates(); if (!info) throw new Error('Kiểm tra signed update trước khi tải'); updateGate.assertMetadata(info.updateInfo); await autoUpdater.downloadUpdate(); return { downloading: true }; }
        if (!downloadedUpdate) throw new Error('Update chưa được xác minh'); await updateGate.verifyFile(downloadedUpdate.path, downloadedUpdate.version);
        beforeInstall(); autoUpdater.quitAndInstall(); return { installing: true };
      },
    },
  });
  allowedFolders.add(studio.store.settings().outputDir);
  studio.on('changed', () => { if (window && !window.isDestroyed()) window.webContents.send('studio:changed'); });
  protocol.handle('studio-media', async request => {
    try {
      const url = new URL(request.url); if (url.hostname !== 'asset' || !/^\/[a-f0-9-]{36}$/.test(url.pathname) || request.method !== 'GET') return new Response('Not found', { status: 404 });
      const path = studio!.store.assetPath(url.pathname.slice(1)); const range = request.headers.get('range');
      return await net.fetch(pathToFileURL(path).href, { headers: range ? { Range: range } : {} });
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
}
if (singleInstance) app.whenReady().then(start).catch(async error => { dialog.showErrorBox('MaiStudio startup', redact(String(error))); quitting = true; await studio?.close(); app.exit(1); });
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault(); quitting = true;
  studio?.close().catch(error => { process.stderr.write(redact(String(error))); }).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
