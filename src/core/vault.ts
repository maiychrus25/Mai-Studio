import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export interface EncryptionPort { available(): boolean; encrypt(value: string): Buffer; decrypt(value: Buffer): string }
export class SecretVault {
  private readonly values = new Map<string, string>();
  private encrypted: Record<string, string> = {};
  private readonly file: string;
  constructor(root: string, private readonly encryption?: EncryptionPort) {
    this.file = join(root, 'secrets.json');
    if (existsSync(this.file)) {
      const data: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.values(data).some(value => typeof value !== 'string')) throw new Error('Kho bí mật không hợp lệ; cần khôi phục backup');
      this.encrypted = data as Record<string, string>;
    }
  }
  persistent(): boolean { return this.encryption?.available() ?? false; }
  get(key: string): string {
    if (this.values.has(key)) return this.values.get(key)!;
    if (!this.encrypted[key] || !this.persistent()) return '';
    try { return this.encryption!.decrypt(Buffer.from(this.encrypted[key], 'base64')); } catch { return ''; }
  }
  save(key: string, value: string): { persisted: boolean; message: string } {
    if (!/^(?:image|video|text|voice|asr|market|shopee|license)\.key$|^proxy\.[a-f0-9-]{36}$|^license\.token$/.test(key) || typeof value !== 'string' || value.length > 16384) throw new Error('Secret key/value không hợp lệ');
    this.values.set(key, value);
    if (!this.persistent()) return { persisted: false, message: 'Không có OS keystore: chỉ giữ bí mật trong RAM đến khi thoát ứng dụng.' };
    if (value) this.encrypted[key] = this.encryption!.encrypt(value).toString('base64'); else delete this.encrypted[key];
    const temporary = `${this.file}.part`;
    writeFileSync(temporary, JSON.stringify(this.encrypted), { mode: 0o600 }); renameSync(temporary, this.file);
    return { persisted: true, message: 'Đã lưu bằng OS keystore' };
  }
}
