import { contextBridge, ipcRenderer } from 'electron';
import type { StudioBridge, StudioCommand } from '../src/shared/studio';

const bridge: StudioBridge = {
  invoke: <T>(command: StudioCommand, input: Record<string, unknown> = {}) => ipcRenderer.invoke('studio:invoke', command, input) as Promise<T>,
  onChanged(listener) { const handler = (): void => listener(); ipcRenderer.on('studio:changed', handler); return () => ipcRenderer.removeListener('studio:changed', handler); },
  pickFiles: () => ipcRenderer.invoke('studio:pick-files'),
  pickFolder: () => ipcRenderer.invoke('studio:pick-folder'),
  mediaUrl: id => `studio-media://asset/${encodeURIComponent(id)}`,
};
contextBridge.exposeInMainWorld('studio', bridge);
