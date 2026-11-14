import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SecretVault } from '../src/core/vault';
import { publicUrl, redact } from '../src/core/store';

test('secrets remain only in memory when an OS keystore is unavailable', () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-vault-'));
  try {
    const vault = new SecretVault(root);
    const result = vault.save('image.key', 'private-test-value');
    assert.equal(result.persisted, false); assert.equal(vault.get('image.key'), 'private-test-value');
    const reopened = new SecretVault(root); assert.equal(reopened.get('image.key'), '');
    assert.throws(() => readFileSync(join(root, 'secrets.json')), /ENOENT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('URL and log boundaries reject credentials, insecure remote origins and redact tokens', () => {
  assert.throws(() => publicUrl('http://example.com/x'), /HTTPS/);
  assert.throws(() => publicUrl('https://user:pass@example.com/x'), /HTTPS|mật khẩu/);
  assert.throws(() => publicUrl('file:///etc/passwd'), /HTTPS/);
  assert.equal(publicUrl('http://127.0.0.1:3456/', true), 'http://127.0.0.1:3456/');
  assert.equal(redact('Authorization Bearer secret-value'), 'Authorization Bearer [redacted]');
  assert.ok(!redact('https://host/path?key=secret-value&token=hidden').includes('secret-value'));
});
