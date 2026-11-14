import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHub, verifyLicense } from '../services/studio-hub';
import type { Server } from 'node:http';

const keys = generateKeyPairSync('ed25519');
async function start(server: Server) {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
}
async function stop(server: Server) { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
async function post(base: string, path: string, body: unknown, admin = false) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: 'Bearer fixture-admin' } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() as Record<string, any> };
}

test('owned keys only, Ed25519 tampering/expiry, device seats, revoke, deactivate and persistent state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-hub-')); const storePath = join(dir, 'hub.json');
  let now = Date.now(); let server = createHub({ ...keys, adminToken: 'fixture-admin', storePath, clock: () => now });
  let base = await start(server);
  try {
    assert.equal((await post(base, '/activate', { key: 'arbitrary-nonempty', deviceId: 'd1' })).status, 403);
    assert.equal((await post(base, '/admin/licenses', { subject: 'Mai' })).status, 401);
    assert.equal((await post(base, '/admin/revoke', { key: 'x' })).status, 401);
    const issued = await post(base, '/admin/licenses', { subject: 'Mai', expiresAt: now + 600000, maxDevices: 1 }, true);
    assert.equal(issued.status, 200); const key = issued.data.key;
    const activation = await post(base, '/activate', { key, deviceId: 'd1' });
    assert.equal(activation.status, 200); const token = activation.data.token;
    const payload = verifyLicense(token, keys.publicKey);
    assert.equal(payload.subject, 'Mai'); assert.equal(payload.deviceId, 'd1');
    assert.throws(() => verifyLicense(token.slice(0, -8) + 'aaaaaaaa', keys.publicKey), /license|signature/i);
    assert.equal((await post(base, '/activate', { key, deviceId: 'd2' })).status, 409);
    assert.equal((await post(base, '/deactivate', { token })).status, 200);
    assert.equal((await post(base, '/activate', { key, deviceId: 'd2' })).status, 200);
    await stop(server); server = createHub({ ...keys, adminToken: 'fixture-admin', storePath, clock: () => now }); base = await start(server);
    assert.equal((await post(base, '/activate', { key, deviceId: 'd3' })).status, 409);
    assert.equal((await post(base, '/admin/revoke', { key }, true)).status, 200);
    assert.equal((await post(base, '/activate', { key, deviceId: 'd2' })).status, 403);
    assert.equal((await post(base, '/validate', { token })).status, 403);
    const persisted = await readFile(storePath, 'utf8'); assert.ok(!persisted.includes(key)); assert.ok(!persisted.includes('fixture-admin'));
    const expired = { ...payload, expiresAt: Date.now() - 1 };
    const encoded = Buffer.from(JSON.stringify(expired)).toString('base64url');
    const signed = encoded + '.' + sign(null, Buffer.from(encoded), keys.privateKey).toString('base64url');
    assert.throws(() => verifyLicense(signed, keys.publicKey), /expired/i);
    now += 700000; assert.equal((await post(base, '/activate', { key, deviceId: 'd2' })).status, 403);
  } finally { await stop(server); await rm(dir, { recursive: true, force: true }); }
});

test('trial provisioning and signed config/update publication are admin-only; invalid auth/body/method rejected', async () => {
  const server = createHub({ privateKey: keys.privateKey, adminToken: 'fixture-admin' }); const base = await start(server);
  try {
    for (const path of ['/admin/trials', '/admin/config', '/admin/update', '/admin/licenses', '/admin/revoke']) {
      assert.equal((await post(base, path, {})).status, 401);
      const r = await fetch(base + path, { method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: '{}' }); assert.equal(r.status, 401);
    }
    assert.equal((await post(base, '/trial', { deviceId: 'x' })).status, 403);
    const trial = await post(base, '/admin/trials', { subject: 'Trial user', expiresAt: Date.now() + 60000 }, true);
    assert.equal(trial.status, 200);
    const active = await post(base, '/trial', { key: trial.data.key, deviceId: 'trial-device' });
    assert.equal(verifyLicense(active.data.token, keys.publicKey).mode, 'trial');
    for (const kind of ['config', 'update']) {
      const published = await post(base, '/admin/' + kind, { value: { version: '0.1.1', platform: 'darwin', arch: 'arm64' } }, true);
      assert.equal(published.status, 200);
      const r = await fetch(base + '/' + kind); assert.equal(r.status, 200);
      const data = await r.json() as { token: string }; assert.equal(verifyLicense(data.token, keys.publicKey).kind, kind);
    }
    assert.equal((await post(base, '/admin/licenses', { subject: '', expiresAt: -1 }, true)).status, 400);
    assert.equal((await fetch(base + '/activate')).status, 405);
    assert.equal((await fetch(base + '/admin/licenses', { method: 'POST', headers: { Authorization: 'Bearer fixture-admin' }, body: '{' })).status, 400);
  } finally { await stop(server); }
});

test('deactivated tokens cannot free a replacement seat; expiry and revocation survive restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-hub-security-')); const storePath = join(root, 'store.json');
  let now = Date.now(); let server = createHub({ privateKey: keys.privateKey, adminToken: 'fixture-admin', clock: () => now, storePath }); let base = await start(server);
  try {
    const license = await post(base, '/admin/licenses', { subject: 'Owner', expiresAt: now + 120000 }, true); const key = license.data.key;
    const first = await post(base, '/activate', { key, deviceId: 'd1' });
    await post(base, '/deactivate', { token: first.data.token });
    const replacement = await post(base, '/activate', { key, deviceId: 'd1' });
    assert.equal((await post(base, '/deactivate', { token: first.data.token })).status, 403);
    assert.equal((await post(base, '/validate', { token: replacement.data.token })).status, 200);
    const tooBig = await fetch(base + '/activate', { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(70000) }) }); assert.equal(tooBig.status, 413);
    const malformed = await post(base, '/activate', []); assert.equal(malformed.status, 400);
    await post(base, '/admin/revoke', { key }, true);
    await stop(server); server = createHub({ privateKey: keys.privateKey, adminToken: 'fixture-admin', clock: () => now, storePath }); base = await start(server);
    assert.equal((await post(base, '/validate', { token: replacement.data.token })).status, 403);
    assert.equal((await post(base, '/activate', { key, deviceId: 'd1' })).status, 403);
    const expiring = await post(base, '/admin/licenses', { subject: 'Expiry', expiresAt: now + 1000 }, true);
    now += 1001; assert.equal((await post(base, '/activate', { key: expiring.data.key, deviceId: 'd' })).status, 403);
  } finally { await stop(server); await rm(root, { recursive: true, force: true }); }
});

test('stress: simultaneous activations honor device limits and bad auth cannot mutate ownership', async () => {
  const server = createHub({ privateKey: keys.privateKey, adminToken: 'fixture-admin' }); const base = await start(server);
  try {
    const issued = await post(base, '/admin/licenses', { subject: 'Stress owner', expiresAt: Date.now() + 120000, maxDevices: 2 }, true);
    const attempts = await Promise.all(Array.from({ length: 30 }, (_, i) => post(base, '/activate', { key: issued.data.key, deviceId: 'device-' + i })));
    assert.equal(attempts.filter(value => value.status === 200).length, 2);
    assert.equal(attempts.filter(value => value.status === 409).length, 28);
    const denied = await Promise.all(Array.from({ length: 30 }, () => post(base, '/admin/revoke', { key: issued.data.key })));
    assert.ok(denied.every(value => value.status === 401));
    for (const active of attempts.filter(value => value.status === 200)) assert.equal((await post(base, '/validate', { token: active.data.token })).status, 200);
  } finally { await stop(server); }
});
