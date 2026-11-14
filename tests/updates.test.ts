import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../services/studio-hub';
import { SignedUpdateGate } from '../src/core/updates';

test('installer admission binds signed version, platform, feed, artifact size and SHA-256 before installation', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519'); const hub = createHub({ privateKey, adminToken: 'test-admin' });
  await new Promise<void>(resolve => hub.listen(0, '127.0.0.1', resolve)); const address = hub.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`; const file = Buffer.from('controlled update artifact');
  const artifact = { platform: 'darwin', arch: 'arm64', url: base + '/feed/update.zip', sha256: createHash('sha256').update(file).digest('hex'), size: file.length };
  const publish = async () => {
    const response = await fetch(base + '/admin/update', { method: 'POST', headers: { authorization: 'Bearer test-admin', 'content-type': 'application/json' }, body: JSON.stringify({ value: { version: '0.2.0', feedUrl: base + '/feed/', artifacts: [artifact] } }) }); assert.equal(response.status, 200);
  };
  await publish();
  const root = mkdtempSync(join(tmpdir(), 'maistudio-update-'));
  try {
    const gate = new SignedUpdateGate({ publicKey, platform: 'darwin', arch: 'arm64', currentVersion: '0.1.0' });
    await gate.check(base, base + '/feed/');
    gate.assertMetadata({ version: '0.2.0', files: [{ url: 'update.zip' }] });
    assert.throws(() => gate.assertMetadata({ version: '9.0.0', files: [{ url: 'update.zip' }] }), /version/i);
    assert.throws(() => gate.assertMetadata({ version: '0.2.0', files: [{ url: 'https://evil.test/unapproved.zip' }] }), /artifact|URL/i);
    const destination = join(root, 'update.zip'); writeFileSync(destination, 'tampered');
    await assert.rejects(gate.verifyFile(destination, '0.2.0'), /hash|size|artifact/i);
    writeFileSync(destination, file); await gate.verifyFile(destination, '0.2.0');
    const wrong = new SignedUpdateGate({ publicKey, platform: 'linux', arch: 'arm64', currentVersion: '0.1.0' });
    await assert.rejects(wrong.check(base, base + '/feed/'), /platform|artifact/i);
    const other = new SignedUpdateGate({ publicKey: generateKeyPairSync('ed25519').publicKey, platform: 'darwin', arch: 'arm64', currentVersion: '0.1.0' });
    await assert.rejects(other.check(base, base + '/feed/'), /signature|token/i);
    await assert.rejects(gate.check(base, base + '/different-feed/'), /feed/i);
  } finally { hub.closeAllConnections(); await new Promise<void>(resolve => hub.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});
