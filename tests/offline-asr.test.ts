import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { OfflineAsr, ASR_MODEL, verifyAsrFile, validateSpeechParts } from '../src/core/offline-asr';

async function rootFixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'mai-offline-asr-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true, maxRetries: 3 }); }
}
async function httpFixture(handler: http.RequestListener, run: (url: string) => Promise<void>) {
  const server = http.createServer(handler); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try { await run(`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`); }
  finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}

test('readiness requires exact regular model files; checksum helper rejects corrupt, missing and symlink files', async () => rootFixture(async root => {
  const engine = new OfflineAsr(root);
  assert.equal(engine.ready(), false);
  const folder = join(root, 'models', ASR_MODEL.name); await mkdir(folder, { recursive: true });
  for (const name of Object.keys(ASR_MODEL.files)) await writeFile(join(folder, name), 'wrong model bytes');
  assert.equal(engine.ready(), false);
  const file = join(root, 'known'); await writeFile(file, 'known fixture');
  const digest = createHash('sha256').update('known fixture').digest('hex');
  assert.equal(verifyAsrFile(file, digest), true); assert.equal(verifyAsrFile(file, '0'.repeat(64)), false);
  const linked = join(root, 'linked'); await symlink(file, linked); assert.equal(verifyAsrFile(linked, digest), false);
  assert.equal(verifyAsrFile(join(root, 'missing'), digest), false);
}));

test('model preparation rejects owned-directory symlinks and an already aborted request without network', async t => rootFixture(async root => {
  let network = 0; t.mock.method(globalThis, 'fetch', async () => { network++; throw new Error('No network expected'); });
  const elsewhere = join(root, 'elsewhere'); await mkdir(elsewhere); await symlink(elsewhere, join(root, 'models'));
  const engine = new OfflineAsr(root); assert.equal(engine.ready(), false);
  await assert.rejects(engine.prepare(), /symbolic|symlink|directory/i);
  const abort = new AbortController(); abort.abort(); await assert.rejects(engine.prepare(abort.signal), /abort|cancel/i);
  assert.equal(network, 0); assert.deepEqual(await readdir(elsewhere), []);
}));

test('prepare fetches only the pinned official URL and rejects unsafe redirects, HTTP errors, archive bounds and partial files', async t => {
  const originalFetch = globalThis.fetch; let variant = 'redirect'; let requests = 0;
  await httpFixture((_req, res) => {
    requests++;
    if (variant === 'redirect') { res.writeHead(302, { Location: 'https://evil.example/model' }); res.end(); }
    else if (variant === 'huge') { res.writeHead(200, { 'Content-Length': String(81 * 1024 * 1024) }); res.end('x'); }
    else if (variant === 'short') res.end('corrupt');
    else { res.statusCode = 403; res.end('provider error must not become success'); }
  }, async url => {
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
      assert.equal(String(input), ASR_MODEL.url); assert.equal(options?.redirect, 'manual');
      return originalFetch(url, options);
    });
    for (const value of ['redirect', 'huge', 'short', 'error']) {
      variant = value;
      await rootFixture(async root => {
        const engine = new OfflineAsr(root);
        await assert.rejects(engine.prepare(), /redirect|host|archive|size|bytes|HTTP|download/i);
        assert.equal(engine.ready(), false); assert.deepEqual(await readdir(join(root, 'models')), []);
      });
    }
    assert.equal(requests, 4);
  });
});

test('active model download abort closes the real HTTP stream and removes staging files', async t => {
  const originalFetch = globalThis.fetch;
  await httpFixture((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.write('partial archive'); }, async url => {
    t.mock.method(globalThis, 'fetch', (input: string | URL | Request, options?: RequestInit) => { assert.equal(String(input), ASR_MODEL.url); return originalFetch(url, options); });
    await rootFixture(async root => {
      await assert.rejects(new OfflineAsr(root).prepare(AbortSignal.timeout(40)), /abort|cancel|timeout/i);
      assert.deepEqual(await readdir(join(root, 'models')), []);
    });
  });
});

test('model preparation keeps its fail-fast busy guard while speech worker calls use a waiting lease', async t => {
  const originalFetch = globalThis.fetch; let started!: () => void; const requestStarted = new Promise<void>(resolve => started = resolve);
  await httpFixture((_req, res) => { res.writeHead(200); res.write('partial archive'); started(); }, async url => {
    t.mock.method(globalThis, 'fetch', (_input: string | URL | Request, options?: RequestInit) => originalFetch(url, options));
    await rootFixture(async root => {
      const engine = new OfflineAsr(root), abort = new AbortController();
      const running = assert.rejects(engine.prepare(abort.signal), /abort|cancel/i);
      try { await requestStarted; await assert.rejects(engine.prepare(), /preparation is already active/i); }
      finally { abort.abort(); await running; }
      assert.deepEqual(await readdir(join(root, 'models')), []);
    });
  });
});

test('transcription and embeddings reject missing/corrupt models, invalid files and symlinks', async () => rootFixture(async root => {
  const engine = new OfflineAsr(root); const input = join(root, 'voice.wav'); await writeFile(input, 'test audio');
  await assert.rejects(engine.transcribe(input), /model|prepare/i); await assert.rejects(engine.embed(input), /model|prepare/i);
  const linked = join(root, 'linked.wav'); await symlink(input, linked);
  await assert.rejects(engine.transcribe(linked), /file|symlink|symbolic/i);
  await assert.rejects(engine.transcribe(join(root, 'missing')), /file|ENOENT/i);
  const abort = new AbortController(); abort.abort(); await assert.rejects(engine.transcribe(input, abort.signal), /abort|cancel/i);
}));

test('measured speech intervals preserve real bounds and reject malformed, unordered and excessive parts', async () => rootFixture(async root => {
  const parts = [{ start: 0.1, end: 0.8 }, { start: 0.8, end: 1.2 }];
  assert.deepEqual(validateSpeechParts(parts, 1.2), parts);
  assert.notEqual(validateSpeechParts(parts, 1.2), parts);
  for (const invalid of [null, [], [{ start: -1, end: 1 }], [{ start: 1, end: 1 }], [{ start: 0, end: Infinity }], [{ start: NaN, end: 1 }], [{ start: '0', end: 1 }], [{ start: 0, end: 1.3 }], [{ start: 0, end: 1 }, { start: 0.9, end: 1.1 }], Array.from({ length: 1001 }, (_, i) => ({ start: i / 1000, end: (i + 1) / 1000 }))]) assert.throws(() => validateSpeechParts(invalid, 1.2), /part|interval|duration/i);
  const input = join(root, 'voice.wav'); await writeFile(input, 'controlled input');
  const engine = new OfflineAsr(root);
  await assert.rejects(engine.transcribeParts(input, [{ start: 1, end: 0 }]), /part|interval/i);
  await assert.rejects(engine.transcribeParts(input, parts), /model|prepare/i);
}));

test('transcribeParts checks measured intervals against the real PCM duration before any native load', async t => rootFixture(async root => {
  const command = join(root, 'controlled-ffmpeg');
  await writeFile(command, '#!/usr/bin/env node\nprocess.stdout.write(Buffer.alloc(32000));', { mode: 0o700 });
  const input = join(root, 'voice.wav'); await writeFile(input, 'controlled input');
  const engine = new OfflineAsr(root, command); t.mock.method(engine, 'ready', () => true);
  await assert.rejects(engine.transcribeParts(input, [{ start: 0, end: 1.001 }]), /duration|interval/i);
  assert.deepEqual(await readdir(join(root, 'asr-work')), []);
}));

test('worker reads bounded JSON over stdin and rejects malformed requests without loading native models', async () => {
  for (const input of ['{', 'x'.repeat(128 * 1024 + 1), JSON.stringify({ root: '/tmp', jobId: '../escape', mode: 'transcribe' }), JSON.stringify({ root: '/tmp', jobId: '11111111-1111-1111-1111-111111111111', mode: 'unknown' }), JSON.stringify({ root: '/tmp', jobId: '11111111-1111-1111-1111-111111111111', mode: ['parts'] })]) {
    const result = await new Promise<{ code: number | null; stdout: string }>((resolveResult, reject) => {
      const child = spawn(process.execPath, [resolve(__dirname, '../src/core/asr-worker.js')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = ''; child.stdout.on('data', b => stdout += b); child.stderr.resume(); child.on('error', reject);
      child.on('close', code => resolveResult({ code, stdout })); child.stdin.on('error', () => {}); child.stdin.end(input);
    });
    assert.notEqual(result.code, 0); assert.ok(result.stdout.length < 8192); assert.equal(typeof JSON.parse(result.stdout).error, 'string');
    if (input.includes('["parts"]')) assert.match(JSON.parse(result.stdout).error, /Invalid ASR worker request/);
  }
});

test('active FFmpeg cancellation kills controlled CLI descendants and releases the global ASR admission', async t => rootFixture(async root => {
  const command = join(root, 'controlled-ffmpeg'); const pidFile = join(root, 'pid');
  await writeFile(command, `#!/usr/bin/env node\nconst f=require('node:fs'),c=require('node:child_process');const p=c.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});f.writeFileSync(${JSON.stringify(pidFile)},String(p.pid));setInterval(()=>{},1000);`, { mode: 0o700 });
  const engine = new OfflineAsr(root, command); t.mock.method(engine, 'ready', () => true);
  const input = join(root, 'voice.wav'); await writeFile(input, 'controlled input'); const abort = new AbortController();
  const running = engine.transcribe(input, abort.signal); const rejection = assert.rejects(running, /abort|cancel/i);
  let pid = 0;
  for (let i = 0; i < 100; i++) { try { pid = Number(await readFile(pidFile, 'utf8')); if (pid) break; } catch {} await new Promise(r => setTimeout(r, 10)); }
  assert.ok(pid); abort.abort(); await rejection;
  for (let i = 0; i < 100; i++) { try { process.kill(pid, 0); } catch { pid = 0; break; } await new Promise(r => setTimeout(r, 10)); }
  assert.equal(pid, 0); assert.deepEqual(await readdir(join(root, 'asr-work')), []);
}));

test('controlled FFmpeg rejects empty, odd, short embedding and excessive PCM, and releases admission after each failure', async t => rootFixture(async root => {
  const input = join(root, 'voice.wav'); await writeFile(input, 'controlled input');
  for (const [name, body, expected] of [
    ['empty', '', /PCM duration/i],
    ['odd', "process.stdout.write(Buffer.alloc(3));", /PCM duration/i],
    ['short', "process.stdout.write(Buffer.alloc(2000));", /PCM duration/i],
    ['huge', "process.stdout.write(Buffer.alloc(57600002));", /byte\/duration limit/i],
    ['failed', 'process.exitCode=1;', /process failed/i],
  ] as const) {
    const command = join(root, name);
    await writeFile(command, `#!/usr/bin/env node\n${body}`, { mode: 0o700 });
    const engine = new OfflineAsr(root, command); t.mock.method(engine, 'ready', () => true);
    await assert.rejects(name === 'short' ? engine.embed(input) : engine.transcribe(input), expected);
    assert.deepEqual(await readdir(join(root, 'asr-work')), []);
  }
  const engine = new OfflineAsr(root, join(root, 'missing-command')); t.mock.method(engine, 'ready', () => true);
  await assert.rejects(engine.transcribe(input), /Cannot start offline speech process/i);
  assert.deepEqual(await readdir(join(root, 'asr-work')), []);
}));

test('concurrent offline calls across instances wait FIFO for one worker and release it after failures', async t => rootFixture(async root => {
  const command = join(root, 'controlled-ffmpeg'), log = join(root, 'starts'), lock = join(root, 'cpu-lock');
  await writeFile(command, `#!/usr/bin/env node\nconst f=require('node:fs'),p=require('node:path');const name=p.basename(process.argv[process.argv.indexOf('-i')+1]);try{f.closeSync(f.openSync(${JSON.stringify(lock)},'wx'));}catch{f.appendFileSync(${JSON.stringify(log)},'OVERLAP\\n');process.exit(3);}f.appendFileSync(${JSON.stringify(log)},name+'\\n');setTimeout(()=>{f.unlinkSync(${JSON.stringify(lock)});process.stdout.write(Buffer.alloc(3));},80);`, { mode: 0o700 });
  const first = new OfflineAsr(join(root, 'first'), command), second = new OfflineAsr(join(root, 'second'), command);
  let checked = 0; const ready = () => { checked++; return true; };
  t.mock.method(first, 'ready', ready); t.mock.method(second, 'ready', ready);
  const paths = ['one.wav', 'two.wav', 'three.wav'].map(name => join(root, name)); for (const path of paths) await writeFile(path, 'controlled audio');
  const one = assert.rejects(first.transcribe(paths[0]), /PCM duration/i);
  for (let n = 0; n < 200; n++) { try { if ((await readFile(log, 'utf8')).includes('one.wav')) break; } catch {} await new Promise(resolve => setTimeout(resolve, 5)); }
  const two = assert.rejects(second.embed(paths[1]), /PCM duration/i);
  for (let n = 0; n < 200 && checked < 2; n++) await new Promise(resolve => setTimeout(resolve, 5));
  const three = assert.rejects(first.transcribeParts(paths[2], [{ start: 0, end: 1 }]), /PCM duration/i);
  try { await Promise.all([one, two, three]); } finally { await Promise.allSettled([one, two, three]); }
  assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n'), ['one.wav', 'two.wav', 'three.wav']);
  assert.deepEqual(await readdir(join(root, 'first', 'asr-work')), []); assert.deepEqual(await readdir(join(root, 'second', 'asr-work')), []);
}));

test('aborting a queued offline call removes its waiter without spawning or blocking the following job', async t => rootFixture(async root => {
  const command = join(root, 'controlled-ffmpeg'), log = join(root, 'starts'), releaseFile = join(root, 'release');
  await writeFile(command, `#!/usr/bin/env node\nconst f=require('node:fs'),p=require('node:path');const name=p.basename(process.argv[process.argv.indexOf('-i')+1]);f.appendFileSync(${JSON.stringify(log)},name+'\\n');const timer=setInterval(()=>{if(f.existsSync(${JSON.stringify(releaseFile)})){clearInterval(timer);process.stdout.write(Buffer.alloc(3));}},5);`, { mode: 0o700 });
  const engine = new OfflineAsr(root, command); let checked = 0; t.mock.method(engine, 'ready', () => { checked++; return true; });
  const paths = ['active.wav', 'cancelled.wav', 'next.wav'].map(name => join(root, name)); for (const path of paths) await writeFile(path, 'controlled audio');
  const first = assert.rejects(engine.transcribe(paths[0]), /PCM duration/i);
  for (let n = 0; n < 200; n++) { try { if ((await readFile(log, 'utf8')).includes('active.wav')) break; } catch {} await new Promise(resolve => setTimeout(resolve, 5)); }
  const abort = new AbortController(), cancelled = assert.rejects(engine.embed(paths[1], abort.signal), /abort/i);
  void cancelled.catch(() => {});
  try {
    for (let n = 0; n < 200 && checked < 2; n++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(checked, 2); abort.abort(); await cancelled;
    const next = assert.rejects(engine.transcribe(paths[2]), /PCM duration/i); await writeFile(releaseFile, 'release'); await Promise.all([first, next]);
  } finally { abort.abort(); await writeFile(releaseFile, 'release'); await Promise.allSettled([first, cancelled]); }
  assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n'), ['active.wav', 'next.wav']); assert.deepEqual(await readdir(join(root, 'asr-work')), []);
}));
