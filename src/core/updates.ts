import { createHash, type KeyObject } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { verifyLicense } from '../../services/studio-hub';
import { object, publicUrl, text } from './store';

interface Artifact { platform: string; arch: string; url: string; sha256: string; size: number }
interface ApprovedUpdate { version: string; feedUrl: string; artifacts: Artifact[]; expiresAt: number }
export class SignedUpdateGate {
  private approved?: ApprovedUpdate;
  constructor(private readonly options: { publicKey: KeyObject | string; platform: string; arch: string; currentVersion: string }) {}
  async check(hubUrl: string, feedUrl: string): Promise<ApprovedUpdate> {
    this.approved = undefined;
    const response = await fetch(publicUrl(hubUrl, true).replace(/\/$/, '') + '/update', { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok || !response.body) throw new Error(`Signed update authority HTTP ${response.status}`);
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 65536) { await reader.cancel(); throw new Error('Signed update response quá lớn'); } chunks.push(value); }
    } finally { reader.releaseLock(); }
    const token = text(object(JSON.parse(Buffer.concat(chunks).toString('utf8'))).token, 'Update token', 64000);
    const payload = verifyLicense(token, this.options.publicKey);
    if (payload.kind !== 'update') throw new Error('Signed token is not an update manifest');
    const value = object(payload.value); const version = text(value.version, 'Update version', 100);
    const parts = (v: string): number[] => { if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error('Invalid update version'); return v.split('.').map(Number); };
    const next = parts(version); const current = parts(this.options.currentVersion);
    let newer = false;
    for (let i = 0; i < 3; i++) { if (next[i] !== current[i]) { newer = next[i] > current[i]; break; } }
    if (!newer) throw new Error('Signed update version is not newer');
    const signedFeed = publicUrl(value.feedUrl, true);
    if (signedFeed !== publicUrl(feedUrl, true)) throw new Error('Configured feed does not match signed feed');
    if (!Array.isArray(value.artifacts) || !value.artifacts.length || value.artifacts.length > 30) throw new Error('Signed artifact list invalid');
    const artifacts = value.artifacts.map(raw => {
      const item = object(raw); const artifact: Artifact = { platform: text(item.platform, 'Artifact platform', 30), arch: text(item.arch, 'Artifact architecture', 30), url: publicUrl(item.url, true), sha256: text(item.sha256, 'Artifact hash', 64), size: Number(item.size) };
      if (!/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > 4 * 1024 ** 3) throw new Error('Signed artifact hash/size invalid');
      if (new URL(artifact.url).origin !== new URL(signedFeed).origin) throw new Error('Signed artifact origin does not match feed');
      return artifact;
    }).filter(artifact => artifact.platform === this.options.platform && artifact.arch === this.options.arch);
    if (!artifacts.length) throw new Error('Signed manifest has no artifact for this platform/architecture');
    this.approved = { version, feedUrl: signedFeed, artifacts, expiresAt: payload.expiresAt }; return structuredClone(this.approved);
  }
  private current(): ApprovedUpdate {
    if (!this.approved || this.approved.expiresAt <= Date.now()) throw new Error('Signed update authorization missing or expired'); return this.approved;
  }
  assertMetadata(info: { version: string; files: Array<{ url: string }> }): void {
    const approved = this.current(); if (info.version !== approved.version) throw new Error('Update metadata version differs from signed version');
    if (!Array.isArray(info.files) || !info.files.length || info.files.some(file => !approved.artifacts.some(artifact => artifact.url === new URL(file.url, approved.feedUrl).href))) throw new Error('Update metadata artifact URL was not signed');
  }
  async verifyFile(path: string, version: string): Promise<void> {
    const approved = this.current(); if (version !== approved.version) throw new Error('Downloaded update version differs from signed version');
    const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Update artifact must be a regular file');
    const candidates = approved.artifacts.filter(artifact => artifact.size === info.size); if (!candidates.length) throw new Error('Update artifact size differs from signed size');
    const digest = createHash('sha256'); for await (const chunk of createReadStream(path)) digest.update(chunk);
    const hash = digest.digest('hex');
    if (!candidates.some(artifact => artifact.sha256 === hash)) throw new Error('Update artifact hash differs from signed hash');
    this.current();
  }
}
