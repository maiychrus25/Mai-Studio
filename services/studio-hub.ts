import http from 'node:http';
import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID, sign, timingSafeEqual, verify, type KeyObject } from 'node:crypto';
import { chmodSync, closeSync, constants, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type LicenseRecord = { id: string; subject: string; mode: 'license' | 'trial'; expiresAt: number; maxDevices: number; revoked: boolean; devices: Record<string, { id: string; issuedAt: number }> };
type HubStore = { version: 1; licenses: Record<string, LicenseRecord>; config?: string; update?: string };
export interface HubPayload {
  version: 1; issuer: 'mai-studio-hub'; kind: 'license' | 'config' | 'update'; issuedAt: number; expiresAt: number;
  licenseId?: string; activationId?: string; deviceId?: string; subject?: string; mode?: 'license' | 'trial'; value?: Record<string, unknown>;
}
const BODY_LIMIT = 64 * 1024;
const LEASE_MS = 24 * 60 * 60 * 1000;
class HubError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HubError(400, 'Expected a JSON object');
  return value as Record<string, unknown>;
}
function string(value: unknown, name: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > max) throw new HubError(400, `Invalid ${name}`);
  return value;
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function own<T>(values: Record<string, T>, key: string): T | undefined { return Object.hasOwn(values, key) ? values[key] : undefined; }
function keyObject(key: KeyObject | string, type: 'private' | 'public'): KeyObject {
  const result = typeof key === 'string' ? (type === 'private' ? createPrivateKey(key) : createPublicKey(key)) : key;
  if (result.asymmetricKeyType !== 'ed25519' || result.type !== type) throw new Error('Hub requires an Ed25519 ' + type + ' key');
  return result;
}
function decode(token: string, publicKey: KeyObject | string, now: number): HubPayload {
  try {
    if (typeof token !== 'string' || token.length > 128 * 1024) throw new Error();
    const parts = token.split('.');
    if (parts.length !== 2 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error();
    const [data, signature] = parts;
    const sig = Buffer.from(signature, 'base64url');
    if (sig.length !== 64 || sig.toString('base64url') !== signature || Buffer.from(data, 'base64url').toString('base64url') !== data) throw new Error();
    if (!verify(null, Buffer.from(data), keyObject(publicKey, 'public'), sig)) throw new Error();
    const payload = record(JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))) as unknown as HubPayload;
    if (payload.version !== 1 || payload.issuer !== 'mai-studio-hub' || !['license', 'config', 'update'].includes(payload.kind) || !Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt) || payload.issuedAt > now + 60000 || payload.expiresAt <= payload.issuedAt) throw new Error();
    if (payload.expiresAt <= now) throw new Error('License token expired');
    if (payload.kind === 'license') {
      for (const value of [payload.licenseId, payload.activationId, payload.deviceId, payload.subject]) string(value, 'license payload');
      if (!['license', 'trial'].includes(payload.mode || '')) throw new Error();
    } else record(payload.value);
    return payload;
  } catch (e) {
    if (e instanceof Error && e.message === 'License token expired') throw e;
    throw new Error('Invalid license token or Ed25519 signature');
  }
}
/** Verifies signature, issuer, schema and wall-clock expiry only. Revocation/seat status requires
 * POST /validate against the authority. Signed config/update use the same envelope; check kind.
 */
export function verifyLicense(token: string, publicKey: KeyObject | string): HubPayload { return decode(token, publicKey, Date.now()); }

/** Owned hub protocol (times are Unix milliseconds):
 * Admin Bearer auth: POST /admin/licenses or /admin/trials {subject,expiresAt,maxDevices?,key?}
 *   returns {key}; POST /admin/revoke {key}; POST /admin/config or /admin/update {value,expiresAt?}.
 * Public capabilities: POST /activate or /trial {key,deviceId}, POST /deactivate or /validate {token}.
 *   Only provisioned keys activate; trials must also be admin-provisioned. GET /config and /update
 *   return signed envelopes. Deactivation needs the signed activation token. Store contains hashes
 *   of keys, never plaintext keys/admin token/private key. Single-writer local service; do not share
 *   storePath across hub processes. All mutations are synchronously persisted before success.
 */
export function createHub(options: { privateKey: KeyObject | string; adminToken: string; clock?: () => number; storePath?: string }): http.Server {
  const privateKey = keyObject(options.privateKey, 'private'); const publicKey = createPublicKey(privateKey);
  if (typeof options.adminToken !== 'string' || !options.adminToken.trim() || Buffer.byteLength(options.adminToken) > 4096) throw new Error('Hub adminToken is required');
  const adminHash = Buffer.from(hash(options.adminToken), 'hex');
  const clock = options.clock || Date.now;
  const storePath = options.storePath ? resolve(options.storePath) : undefined;
  let store: HubStore = { version: 1, licenses: {} };
  if (storePath && existsSync(storePath)) {
    const fd = openSync(storePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let data: Buffer;
    try {
      const size = fstatSync(fd).size;
      if (size === 0 || size > 16 * 1024 * 1024) throw new Error('Invalid hub store size');
      data = Buffer.alloc(size); if (readSync(fd, data, 0, size, 0) !== size) throw new Error('Incomplete hub store');
    } finally { closeSync(fd); }
    const loaded = record(JSON.parse(data.toString('utf8')));
    if (loaded.version !== 1) throw new Error('Unsupported hub store version');
    const licenses = record(loaded.licenses);
    if (Object.keys(licenses).length > 10000) throw new Error('Hub store license limit exceeded');
    for (const [keyHash, item] of Object.entries(licenses)) {
      const lic = record(item);
      if (!/^[a-f0-9]{64}$/.test(keyHash) || !Number.isSafeInteger(lic.expiresAt) || !Number.isSafeInteger(lic.maxDevices) || Number(lic.maxDevices) < 1 || Number(lic.maxDevices) > 100 || !['license', 'trial'].includes(String(lic.mode)) || typeof lic.revoked !== 'boolean') throw new Error('Invalid stored license');
      string(lic.id, 'stored license ID'); string(lic.subject, 'stored subject');
      for (const [device, activation] of Object.entries(record(lic.devices))) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(device)) throw new Error('Invalid stored device');
        const value = record(activation); string(value.id, 'stored activation');
        if (!Number.isSafeInteger(value.issuedAt)) throw new Error('Invalid stored activation time');
      }
      if (Object.keys(lic.devices as object).length > Number(lic.maxDevices)) throw new Error('Invalid stored device count');
    }
    for (const kind of ['config', 'update'] as const) {
      if (loaded[kind] !== undefined && typeof loaded[kind] !== 'string') throw new Error('Invalid stored signed envelope');
    }
    store = loaded as unknown as HubStore;
    chmodSync(storePath, 0o600);
  }
  function persist(next: HubStore): void {
    if (storePath) {
      mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 });
      const temp = `${storePath}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' }); renameSync(temp, storePath);
      } finally { if (existsSync(temp)) unlinkSync(temp); }
    }
    store = next;
  }
  function issue(payload: Omit<HubPayload, 'version' | 'issuer'>): string {
    const encoded = Buffer.from(JSON.stringify({ version: 1, issuer: 'mai-studio-hub', ...payload })).toString('base64url');
    return encoded + '.' + sign(null, Buffer.from(encoded), privateKey).toString('base64url');
  }
  async function body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    if (Number(req.headers['content-length']) > BODY_LIMIT) throw new HubError(413, 'Request body too large');
    let size = 0; const chunks: Buffer[] = [];
    for await (const part of req) {
      const data = Buffer.from(part); size += data.length;
      if (size > BODY_LIMIT) throw new HubError(413, 'Request body too large');
      chunks.push(data);
    }
    try { return record(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { throw new HubError(400, 'Invalid JSON object'); }
  }
  function active(payload: HubPayload): LicenseRecord {
    if (payload.kind !== 'license' || !payload.licenseId) throw new HubError(403, 'Activation token required');
    const license = Object.values(store.licenses).find(l => l.id === payload.licenseId);
    if (!license || license.revoked || license.expiresAt <= clock() || own(license.devices, payload.deviceId || '')?.id !== payload.activationId) throw new HubError(403, 'License revoked, expired or deactivated');
    return license;
  }
  const server = http.createServer(async (req, res) => {
    const reply = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    try {
      const path = (req.url || '').split('?')[0];
      if (path.startsWith('/admin/')) {
        const expected = 'Bearer ';
        const header = req.headers.authorization || '';
        const actual = Buffer.from(hash(header.startsWith(expected) ? header.slice(expected.length) : ''), 'hex');
        if (!header.startsWith(expected) || !timingSafeEqual(actual, adminHash)) throw new HubError(401, 'Admin authorization required');
      }
      if (req.method === 'GET' && (path === '/config' || path === '/update')) {
        const kind = path.slice(1) as 'config' | 'update'; const token = store[kind];
        if (!token) throw new HubError(404, 'No signed ' + kind + ' published');
        try { decode(token, publicKey, clock()); } catch { throw new HubError(410, 'Signed publication expired or invalid'); }
        reply(200, { token }); return;
      }
      if (req.method !== 'POST') throw new HubError(405, 'POST required');
      if (!['/admin/licenses', '/admin/trials', '/admin/revoke', '/admin/config', '/admin/update', '/activate', '/trial', '/deactivate', '/validate'].includes(path)) throw new HubError(404, 'Unknown endpoint');
      const input = await body(req); const now = clock();
      if (!Number.isSafeInteger(now)) throw new Error('Invalid hub clock');
      if (path === '/admin/licenses' || path === '/admin/trials') {
        if (Object.keys(store.licenses).length >= 10000) throw new HubError(409, 'License limit reached');
        const subject = string(input.subject, 'subject');
        const expiresAt = input.expiresAt;
        if (!Number.isSafeInteger(expiresAt) || Number(expiresAt) <= now) throw new HubError(400, 'expiresAt must be a future Unix millisecond time');
        const maxDevices = input.maxDevices ?? 1;
        if (!Number.isSafeInteger(maxDevices) || Number(maxDevices) < 1 || Number(maxDevices) > 100) throw new HubError(400, 'maxDevices must be 1-100');
        const key = input.key === undefined ? 'mai_' + randomBytes(32).toString('base64url') : string(input.key, 'license key');
        if (key.length < 24) throw new HubError(400, 'Provisioned keys must contain at least 24 characters');
        const keyHash = hash(key); if (own(store.licenses, keyHash)) throw new HubError(409, 'Key already provisioned');
        const license: LicenseRecord = { id: randomUUID(), subject, mode: path.endsWith('/trials') ? 'trial' : 'license', expiresAt: Number(expiresAt), maxDevices: Number(maxDevices), revoked: false, devices: {} };
        persist({ ...store, licenses: { ...store.licenses, [keyHash]: license } }); reply(200, { key, licenseId: license.id }); return;
      }
      if (path === '/admin/revoke') {
        const keyHash = hash(string(input.key, 'license key')); const license = own(store.licenses, keyHash);
        if (!license) throw new HubError(404, 'Unknown license');
        persist({ ...store, licenses: { ...store.licenses, [keyHash]: { ...license, revoked: true, devices: {} } } }); reply(200, { revoked: true }); return;
      }
      if (path === '/admin/config' || path === '/admin/update') {
        const kind = path.slice('/admin/'.length) as 'config' | 'update';
        const value = record(input.value); const expiresAt = input.expiresAt ?? now + LEASE_MS;
        if (!Number.isSafeInteger(expiresAt) || Number(expiresAt) <= now) throw new HubError(400, 'Invalid publication expiry');
        const token = issue({ kind, value, issuedAt: now, expiresAt: Number(expiresAt) });
        persist({ ...store, [kind]: token }); reply(200, { token }); return;
      }
      if (path === '/activate' || path === '/trial') {
        // Missing/wrong keys share one response; arbitrary nonempty strings never create a license.
        const key = typeof input.key === 'string' && input.key.length <= 256 ? input.key : '';
        const license = own(store.licenses, hash(key));
        if (!license || license.revoked || license.expiresAt <= now || (path === '/trial' && license.mode !== 'trial')) throw new HubError(403, 'Provisioned valid license key required');
        const deviceId = string(input.deviceId, 'device ID', 128);
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(deviceId)) throw new HubError(400, 'Invalid device ID');
        let activation = own(license.devices, deviceId);
        if (!activation && Object.keys(license.devices).length >= license.maxDevices) throw new HubError(409, 'Activation device limit reached');
        activation ||= { id: randomUUID(), issuedAt: now };
        const updated = { ...license, devices: { ...license.devices, [deviceId]: activation } };
        persist({ ...store, licenses: { ...store.licenses, [hash(key)]: updated } });
        const token = issue({ kind: 'license', licenseId: license.id, activationId: activation.id, deviceId, subject: license.subject, mode: license.mode, issuedAt: now, expiresAt: Math.min(license.expiresAt, now + LEASE_MS) });
        reply(200, { token, expiresAt: Math.min(license.expiresAt, now + LEASE_MS) }); return;
      }
      let payload: HubPayload;
      try { payload = decode(string(input.token, 'activation token', 128 * 1024), publicKey, now); }
      catch { throw new HubError(403, 'Invalid or expired activation token'); }
      const license = active(payload);
      if (path === '/validate') { reply(200, { valid: true, expiresAt: payload.expiresAt }); return; }
      const devices = { ...license.devices }; delete devices[payload.deviceId!];
      const keyHash = Object.keys(store.licenses).find(k => store.licenses[k].id === license.id)!;
      persist({ ...store, licenses: { ...store.licenses, [keyHash]: { ...license, devices } } }); reply(200, { deactivated: true });
    } catch (error) {
      // No request data, key, token, provider message or internal exception is reflected.
      if (!res.headersSent && !res.destroyed) reply(error instanceof HubError ? error.status : 500, { error: error instanceof HubError ? error.message : 'Hub operation failed' });
    }
  });
  server.requestTimeout = 10000; server.headersTimeout = 5000; server.setTimeout(10000, socket => socket.destroy());
  server.maxHeadersCount = 32; server.maxRequestsPerSocket = 100;
  return server;
}

// CLI requires an Ed25519 PEM file and admin token in the environment. Import never binds a port.
if (require.main === module) {
  try {
    const keyPath = process.env.STUDIO_HUB_PRIVATE_KEY_FILE;
    const adminToken = process.env.STUDIO_HUB_ADMIN_TOKEN;
    const port = Number(process.env.STUDIO_HUB_PORT || 17861);
    if (!keyPath || !adminToken || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Missing hub configuration');
    const server = createHub({ privateKey: readFileSync(keyPath, 'utf8'), adminToken, storePath: process.env.STUDIO_HUB_STORE_PATH });
    server.on('error', () => { console.error('Studio hub could not start'); process.exitCode = 1; });
    server.listen(port, process.env.STUDIO_HUB_HOST || '127.0.0.1');
  } catch { console.error('Studio hub requires valid STUDIO_HUB_PRIVATE_KEY_FILE, STUDIO_HUB_ADMIN_TOKEN and port configuration'); process.exitCode = 1; }
}
