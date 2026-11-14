import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { NeedsInputError } from '../src/core/queue';
import type { Task, TaskContext } from '../src/shared/studio';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/core/store';
import { BrowserManager } from '../src/core/browser';

test('real browser submits once, downloads its new result and checkpoints remote acceptance', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=', 'base64');
  let submissions = 0;
  const server = createServer((req, res) => {
    if (req.url === '/result.png') { res.setHeader('content-type', 'image/png'); res.end(png); return; }
    if (req.url === '/submit') { submissions++; res.end('{}'); return; }
    res.setHeader('content-type', 'text/html'); res.end(`<textarea id="prompt"></textarea><button id="send">Send</button><section id="replies"></section><script>document.querySelector('button').onclick=async()=>{await fetch('/submit');document.querySelector('section').innerHTML='<article class="reply"><img src="/result.png"></article>'}</script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const root = mkdtempSync(join(tmpdir(), 'maistudio-browser-')); const store = new Store(root);
  store.setSettings({ browserVisible: false, museSelectors: { composer: '#prompt', submit: '#send', response: '.reply', fileInput: 'input[type=file]', stop: '.stop' } });
  const browsers = new BrowserManager(store);
  try {
    const project = store.saveProject({ name: 'browser' });
    const account = store.saveAccount({ name: 'fixture', url: `http://127.0.0.1:${address.port}/` });
    const [task] = store.createTasks({ projectId: project.id, prompts: ['Vẽ một bông hoa'], kind: 'image', accountId: account.id });
    let checkpoint: Record<string, unknown> = {};
    const result = await browsers.generate(task, { signal: new AbortController().signal, checkpoint(value) { checkpoint = { ...checkpoint, ...value }; }, progress() {} });
    assert.equal(submissions, 1); assert.equal(result.outputIds.length, 1);
    assert.equal(store.asset(result.outputIds[0]).mime, 'image/png');
    assert.equal(checkpoint.remoteSubmitted, true); assert.ok(checkpoint.threadUrl);
  } finally { await browsers.shutdown(); store.close(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=', 'base64');
async function textFixture(run: (fixture: {
  store: Store; browsers: BrowserManager; task: Task; context: TaskContext; controller: AbortController;
  submitted: string[]; checkpoints: Record<string, unknown>[]; stopped: () => number; disconnected: () => number;
}) => Promise<void>, options: { stream?: boolean; missing?: boolean; error?: boolean; oversize?: boolean; budget?: boolean; noBusy?: boolean; delayedReply?: boolean; emptyComposer?: boolean } = {}) {
  const submitted: string[] = []; let stops = 0; let disconnected = 0; let threadReply = ''; let threadBusy = false;
  const server = createServer((req, res) => {
    if (req.url === '/submit') {
      let body = ''; req.on('data', chunk => { body += chunk; });
      req.on('end', () => { submitted.push(body); threadReply = 'PARTIAL'; threadBusy = true; res.end('{}'); }); return;
    }
    if (req.url === '/complete') {
      let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => { threadReply = body; threadBusy = false; res.end('{}'); }); return;
    }
    if (req.url === '/stop') { stops++; threadBusy = false; res.end('{}'); return; }
    if (req.url === '/stream') { res.writeHead(200, { 'content-type': 'text/plain' }); res.write('partial'); res.on('close', () => { disconnected++; }); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<main><textarea id="prompt"></textarea><input type="file" multiple><button id="send">Send</button><button id="stop" hidden>Stop</button>
      <section id="replies"><article class="reply">OLD PLAN</article></section></main><script>
      const send = document.querySelector('#send'), stop = document.querySelector('#stop'), replies = document.querySelector('#replies');
      const old = ${JSON.stringify(threadReply)}; if (old) { const reply = document.createElement('article'); reply.className = 'reply'; reply.textContent = old; replies.append(reply); }
      stop.hidden = ${!threadBusy}; send.disabled = ${threadBusy};
      document.cookie = 'profile=shared; SameSite=Lax';
      document.querySelector('input').onchange = () => { send.disabled = true; setTimeout(() => { send.disabled = false; }, 2300); };
      stop.onclick = async () => { await fetch('/stop'); window.streamController?.abort(); stop.hidden = true; };
      send.onclick = async () => {
        send.disabled = ${!!options.noBusy ? 'false' : 'true'}; stop.hidden = ${!!options.noBusy};
        await fetch('/submit', {method:'POST',body:JSON.stringify({prompt:document.querySelector('#prompt').value,files:[...document.querySelector('input').files].map(f=>({name:f.name,size:f.size})),cookie:document.cookie})});
        history.replaceState({}, '', '/thread/plan');
        if (${!!options.error}) { replies.innerHTML += '<div data-testid="assistant-response-error-notice">Provider refused</div>'; stop.hidden = true; send.disabled = false; return; }
        if (${!!options.delayedReply}) await new Promise(resolve=>setTimeout(resolve, 1800));
        const reply = document.createElement('article'); reply.className = 'reply'; replies.append(reply); reply.textContent = 'PARTIAL';
        if (${!!options.stream}) { window.streamController = new AbortController(); fetch('/stream',{signal:window.streamController.signal}).then(r=>r.text()).catch(()=>{}); return; }
        setTimeout(() => { reply.textContent = ${options.oversize ? "'界'.repeat(180000)" : options.budget ? "'x'.repeat(480000)" : "'新计划 — FINAL PLAN'"}; }, 1400);
        setTimeout(() => { fetch('/complete', { method: 'POST', body: reply.textContent }); stop.hidden = true; send.disabled = ${!!options.emptyComposer}; if (${!!options.emptyComposer}) document.querySelector('#prompt').value = ''; }, 2600);
      };
      ${options.missing ? "document.querySelector('main').remove();" : ''}
    </script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const root = mkdtempSync(join(tmpdir(), 'maistudio-text-')); const store = new Store(root); const browsers = new BrowserManager(store);
  store.setSettings({ browserVisible: false, museSelectors: { composer: '#prompt', submit: '#send', response: '.reply', fileInput: 'input[type=file]', stop: '#stop' } });
  const project = store.saveProject({ name: 'planning' }); const account = store.saveAccount({ name: 'fixture', url: `http://127.0.0.1:${address.port}/` });
  const [task] = store.createTasks({ projectId: project.id, prompts: ['Plan a film — giữ nguyên Unicode'], kind: 'plan', accountId: account.id });
  task.input.timeoutMs = 7000;
  const controller = new AbortController(); const checkpoints: Record<string, unknown>[] = [];
  const context: TaskContext = { signal: controller.signal, checkpoint(value) { task.checkpoint = { ...task.checkpoint, ...value }; checkpoints.push(structuredClone(task.checkpoint)); }, progress() {} };
  try { await run({ store, browsers, task, context, controller, submitted, checkpoints, stopped: () => stops, disconnected: () => disconnected }); }
  finally { await browsers.shutdown(); store.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
}

test('text plan uses the persistent account and returns only a new, completed Unicode reply', async () => {
  await textFixture(async ({ store, browsers, task, context, submitted, checkpoints }) => {
    const browser = await browsers.open(store.account(task.accountId));
    await browser.pages()[0].evaluate(() => { document.cookie = 'login=persisted; SameSite=Lax'; });
    const started = Date.now(); const text = await browsers.completeText(task, context);
    assert.equal(text, '新计划 — FINAL PLAN'); assert.ok(Date.now() - started >= 2600, 'must wait for stop to disappear, even with unchanged text');
    assert.equal(submitted.length, 1); const payload = JSON.parse(submitted[0]);
    assert.equal(payload.prompt, task.prompt); assert.match(payload.cookie, /login=persisted/);
    assert.equal(checkpoints[0].remoteSubmitted, true); assert.equal(checkpoints[0].beforeReplyCount, 1);
    assert.match(String(task.checkpoint.threadUrl), /\/thread\/plan$/); assert.equal(task.checkpoint.textResult, text);
  });
});

test('text plan resolves reference IDs to validated images and waits until uploads permit sending', async () => {
  await textFixture(async ({ store, browsers, task, context, submitted }) => {
    const path = join(store.root, 'reference.png'); writeFileSync(path, png);
    const asset = await store.importAsset(path); task.input.refIds = [asset.id];
    const started = Date.now(); await browsers.completeText(task, context);
    const payload = JSON.parse(submitted[0]); assert.equal(payload.files.length, 1); assert.equal(payload.files[0].size, png.length);
    assert.ok(Date.now() - started >= 4900, 'upload must be ready before the reply starts');
    task.checkpoint = {}; task.input.refIds = [path];
    await assert.rejects(browsers.completeText(task, context), /asset|tệp/); assert.equal(submitted.length, 1);
  });
});

test('text plan checkpoints admission before click and refuses ambiguous resume without a thread', async () => {
  await textFixture(async ({ browsers, task, context, submitted }) => {
    const interrupted = { ...context, checkpoint(value: Record<string, unknown>) { context.checkpoint(value); throw new Error('simulated durable checkpoint interruption'); } };
    await assert.rejects(browsers.completeText(task, interrupted)); assert.equal(task.checkpoint.remoteSubmitted, true); assert.equal(submitted.length, 0);
    await assert.rejects(browsers.completeText(task, context), NeedsInputError); assert.equal(submitted.length, 0);
  });
});

test('text plan resumes a saved thread in a reopened profile without sending twice', async () => {
  await textFixture(async ({ store, browsers, task, context, submitted }) => {
    const original = await browsers.open(store.account(task.accountId));
    await original.pages()[0].evaluate(() => { document.cookie = 'savedLogin=yes; Max-Age=3600; SameSite=Lax'; });
    await browsers.completeText(task, context); const checkpoint = { ...task.checkpoint }; delete checkpoint.textResult;
    const browser = await browsers.open(store.account(task.accountId)); await browser.pages().at(-1)!.reload();
    task.checkpoint = checkpoint;
    assert.equal(await browsers.completeText(task, context), '新计划 — FINAL PLAN'); assert.equal(submitted.length, 1);
    await browsers.shutdown(); delete task.checkpoint.textResult;
    const reopened = new BrowserManager(store);
    try {
      assert.equal(await reopened.completeText(task, context), '新计划 — FINAL PLAN'); assert.equal(submitted.length, 1);
      const profile = await reopened.open(store.account(task.accountId)); assert.ok((await profile.cookies()).some(cookie => cookie.name === 'savedLogin' && cookie.value === 'yes'));
    }
    finally { await reopened.shutdown(); }
  });
});

test('text cancellation stops the provider stream and pending browser requests', async () => {
  await textFixture(async ({ store, browsers, task, context, controller, submitted, stopped, disconnected }) => {
    let polls = 0; const pending = browsers.completeText(task, { ...context, progress() { if (++polls >= 3 && submitted.length) controller.abort(); } });
    await assert.rejects(pending); assert.ok(controller.signal.aborted);
    for (let i = 0; i < 30 && (!stopped() || !disconnected()); i++) await delay(50);
    assert.equal(stopped(), 1); assert.equal(disconnected(), 1); assert.equal(task.checkpoint.textResult, undefined);
    assert.equal(submitted.length, 1);
    assert.ok((await browsers.open(store.account(task.accountId))).pages().every(page => !page.url().endsWith('/thread/plan')));
  }, { stream: true });
});

test('text plan rejects already aborted work before opening or submitting', async () => {
  await textFixture(async ({ browsers, task, context, controller, submitted }) => {
    controller.abort(); await assert.rejects(browsers.completeText(task, context), { name: 'AbortError' }); assert.equal(submitted.length, 0);
  });
});

test('missing composer and provider error require input instead of fabricated text', async () => {
  await textFixture(async ({ browsers, task, context, submitted }) => { await assert.rejects(browsers.completeText(task, context), NeedsInputError); assert.equal(submitted.length, 0); }, { missing: true });
  await textFixture(async ({ browsers, task, context, submitted }) => { await assert.rejects(browsers.completeText(task, context), NeedsInputError); assert.equal(submitted.length, 1); assert.equal(task.checkpoint.textResult, undefined); }, { error: true });
});

test('text plan bounds UTF-8 responses to 512 KiB without returning or checkpointing a truncated plan', async () => {
  await textFixture(async ({ browsers, task, context, submitted }) => {
    await assert.rejects(browsers.completeText(task, context), /MiB|limit|vượt/); assert.equal(submitted.length, 1); assert.equal(task.checkpoint.textResult, undefined);
  }, { oversize: true });
});

test('text plan waits for a newly appended reply rather than returning an old completed reply', async () => {
  await textFixture(async ({ browsers, task, context, submitted }) => { assert.equal(await browsers.completeText(task, context), '新计划 — FINAL PLAN'); assert.equal(submitted.length, 1); }, { delayedReply: true });
});

test('unknown completion DOM never treats a quiet streaming partial as a finished plan', async () => {
  await textFixture(async ({ browsers, task, context }) => {
    task.input.timeoutMs = 2500;
    await assert.rejects(browsers.completeText(task, context), NeedsInputError); assert.equal(task.checkpoint.textResult, undefined);
  }, { stream: true, noBusy: true });
});

test('text plan validates resumed thread origin and baseline without submitting', async () => {
  await textFixture(async ({ browsers, task, context, submitted }) => {
    task.checkpoint = { remoteSubmitted: true, beforeReplyCount: 1, threadUrl: 'https://other-provider.invalid/thread' };
    await assert.rejects(browsers.completeText(task, context), NeedsInputError);
    task.checkpoint = { remoteSubmitted: true, threadUrl: 'not a URL' };
    await assert.rejects(browsers.completeText(task, context), NeedsInputError);
    assert.equal(submitted.length, 0);
  });
});

test('generation uses the recovered image-reference template after attaching validated assets', async () => {
  await textFixture(async ({ store, browsers, task, context, submitted }) => {
    const path = join(store.root, 'reference.png'); writeFileSync(path, png); const asset = await store.importAsset(path);
    task.kind = 'image'; task.input = { refIds: [asset.id], ratio: '9:16', timeoutMs: 4000 };
    const page = (await browsers.open(store.account(task.accountId))).pages()[0];
    await page.evaluate(() => {
      document.querySelector('#send')!.addEventListener('click', () => {
        setTimeout(() => { const reply = document.createElement('article'); reply.className = 'reply'; reply.innerHTML = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=">'; document.querySelector('#replies')!.append(reply); }, 100);
      });
    });
    const result = await browsers.generate(task, context); assert.equal(result.outputIds.length, 1);
    const payload = JSON.parse(submitted[0]); assert.equal(payload.files[0].size, png.length);
    assert.equal(payload.prompt, 'Create 1 image(s) with aspect ratio 9:16, using the attached image(s) as reference (keep the subject, face and style). Do not ask follow-up questions, just generate.\n\nPlan a film — giữ nguyên Unicode');
  });
});

test('resuming a stopped partial without observed completion requires input, never a completed plan', async () => {
  await textFixture(async ({ store, browsers, task, context, submitted }) => {
    const page = (await browsers.open(store.account(task.accountId))).pages()[0];
    await page.evaluate(() => { document.querySelector('#replies')!.insertAdjacentHTML('beforeend', '<article class="reply">PARTIAL</article>'); });
    task.input.timeoutMs = 1500; task.checkpoint = { remoteSubmitted: true, beforeReplyCount: 1, threadUrl: page.url(), textBusy: true };
    await assert.rejects(browsers.completeText(task, context), NeedsInputError); assert.equal(submitted.length, 0);
  });
});

test('generation waits for the completed media rather than downloading a streaming preview', async () => {
  await textFixture(async ({ store, browsers, task, context, submitted }) => {
    task.kind = 'image'; task.input.timeoutMs = 4500;
    const page = (await browsers.open(store.account(task.accountId))).pages()[0];
    await page.evaluate(() => {
      document.querySelector('#send')!.addEventListener('click', () => {
        setTimeout(() => {
          const reply = document.createElement('article'); reply.className = 'reply'; reply.innerHTML = '<img src="data:image/png;base64,AA==">'; document.querySelector('#replies')!.append(reply);
          setTimeout(() => { reply.querySelector('img')!.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII='; }, 1500);
        }, 100);
      });
    });
    const started = Date.now(); const result = await browsers.generate(task, context);
    assert.equal(result.outputIds.length, 1); assert.ok(Date.now() - started >= 2600); assert.equal(submitted.length, 1);
  });
});

test('text plan resumes a timed-out live thread and receives its final reply without another admission', async () => {
  await textFixture(async ({ browsers, task, context, submitted }) => {
    task.input.timeoutMs = 1000; await assert.rejects(browsers.completeText(task, context), NeedsInputError);
    assert.equal(submitted.length, 1); assert.ok(task.checkpoint.threadUrl); assert.equal(task.checkpoint.textResult, undefined);
    task.input.timeoutMs = 7000; assert.equal(await browsers.completeText(task, context), '新计划 — FINAL PLAN'); assert.equal(submitted.length, 1);
  });
});

test('cancel while processing references stops before remote admission', async () => {
  await textFixture(async ({ store, browsers, task, context, controller, submitted }) => {
    const path = join(store.root, 'reference.png'); writeFileSync(path, png); const asset = await store.importAsset(path); task.input.refIds = [asset.id];
    await browsers.open(store.account(task.accountId)); const timer = setTimeout(() => controller.abort(), 250);
    try { await assert.rejects(browsers.completeText(task, context), { name: 'AbortError' }); }
    finally { clearTimeout(timer); }
    assert.equal(submitted.length, 0); assert.equal(task.checkpoint.remoteSubmitted, undefined);
  });
});

for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark'] as const) {
  test(`Chrome text fixture completes at ${width}px in ${colorScheme} mode`, async () => {
    await textFixture(async ({ store, browsers, task, context }) => {
      const page = (await browsers.open(store.account(task.accountId))).pages()[0];
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 }); await page.emulateMedia({ colorScheme });
      assert.equal(await browsers.completeText(task, context), '新计划 — FINAL PLAN');
    });
  });
}

test('cancel during initial provider navigation terminates the page request promptly', async () => {
  const controller = new AbortController(); let disconnected = 0;
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' }); res.write('<main>Loading');
    res.on('close', () => { disconnected++; }); setTimeout(() => controller.abort(), 100);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const root = mkdtempSync(join(tmpdir(), 'maistudio-navigation-')); const store = new Store(root); store.setSettings({ browserVisible: false });
  const browsers = new BrowserManager(store); const project = store.saveProject({ name: 'navigation' });
  const account = store.saveAccount({ name: 'fixture', url: `http://127.0.0.1:${address.port}/` });
  const [task] = store.createTasks({ projectId: project.id, prompts: ['Plan'], kind: 'plan', accountId: account.id });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pending = browsers.completeText(task, { signal: controller.signal, checkpoint() {}, progress() {} });
    await assert.rejects(Promise.race([pending, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('navigation did not cancel within 2 seconds')), 2000); })]), { name: 'AbortError' });
    assert.equal(disconnected, 1);
  } finally { clearTimeout(timer); const closed = new Promise<void>(resolve => server.close(() => resolve())); server.closeAllConnections(); await closed; await browsers.shutdown(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('completed text is returned when the provider clears the composer and disables its empty Send button', async () => {
  await textFixture(async ({ browsers, task, context, submitted }) => {
    assert.equal(await browsers.completeText(task, context), '新计划 — FINAL PLAN'); assert.equal(submitted.length, 1);
  }, { emptyComposer: true });
});

test('text checkpoint fits the whole durable task budget while preserving admission on rejection', async () => {
  await textFixture(async ({ store, browsers, task, context, submitted }) => {
    task.input.snapshot = 'x'.repeat(600000); store.updateTask(task.id, { input: task.input });
    let resultWrites = 0;
    const durable: TaskContext = { ...context, checkpoint(value) {
      if (value.textResult !== undefined) resultWrites++;
      store.updateTask(task.id, { checkpoint: { ...task.checkpoint, ...value } }); context.checkpoint(value);
    } };
    await assert.rejects(browsers.completeText(task, durable), NeedsInputError);
    assert.equal(resultWrites, 0, 'reject before attempting an oversized durable write');
    assert.equal(submitted.length, 1); assert.equal(store.task(task.id).checkpoint.remoteSubmitted, true);
    assert.ok(store.task(task.id).checkpoint.threadUrl); assert.equal(store.task(task.id).checkpoint.textResult, undefined);
    await assert.rejects(browsers.completeText(task, durable), NeedsInputError); assert.equal(submitted.length, 1);
  }, { budget: true });
});


async function musicFixture(run: (fixture: {
  store: Store; browsers: BrowserManager; task: Task; context: TaskContext; controller: AbortController;
  submissions: string[]; downloads: () => number; videoDownloads: () => number; wav: Buffer;
}) => Promise<void>, variant = 'link.wav', slow = false) {
  const wav = Buffer.alloc(44 + 3200); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(3200, 40);
  for (let i = 0; i < 1600; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 8000) * 8000), 44 + i * 2);
  const controller = new AbortController(); const submissions: string[] = []; let downloads = 0; let videoDownloads = 0; let acceptedAt = 0;
  const source = `/new.${variant.split('.').at(-1)}?signed=fixture`;
  const media = variant.startsWith('audio') ? `<audio preload="none" src="${source}"></audio>` : variant.startsWith('source') ? `<audio preload="none"><source src="${source}" type="audio/wav"></audio>` : `<a href="${source}">Download music</a>`;
  const reply = `<article class="reply"><video preload="none" src="/decoy.mp4"></video><a href="/decoy.mp4">Video</a><a href="/old.wav">Previous music</a>${media}</article>`;
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/new.')) {
      downloads++; res.writeHead(200, { 'content-type': 'audio/wav' });
      if (slow) { res.write(wav.subarray(0, 44)); setTimeout(() => controller.abort(), 100); } else res.end(wav); return;
    }
    if (req.url === '/old.wav') { res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(wav); return; }
    if (req.url === '/decoy.mp4') { videoDownloads++; res.writeHead(404); res.end(); return; }
    if (req.url === '/submit') { let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => { submissions.push(body); acceptedAt = Date.now(); res.end('{}'); }); return; }
    const active = acceptedAt > 0 && Date.now() - acceptedAt < 1800;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<textarea id="prompt"></textarea><button id="send">Send</button><button id="stop" ${active ? '' : 'hidden'}>Stop</button>
      <section><article class="reply"><a href="/old.wav">Old completed music</a></article>${acceptedAt ? reply : ''}</section><script>
      const send=document.querySelector('#send'),stop=document.querySelector('#stop');
      stop.onclick=()=>{stop.hidden=true};
      send.onclick=async()=>{stop.hidden=false;await fetch('/submit',{method:'POST',body:document.querySelector('#prompt').value});history.replaceState({},'', '/thread/music');document.querySelector('section').insertAdjacentHTML('beforeend',${JSON.stringify(reply)});setTimeout(()=>{stop.hidden=true},1800)};
      </script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const root = mkdtempSync(join(tmpdir(), 'maistudio-music-')); const store = new Store(root); const browsers = new BrowserManager(store);
  store.setSettings({ browserVisible: false, museSelectors: { composer: '#prompt', submit: '#send', response: '.reply', fileInput: 'input[type=file]', stop: '#stop' } });
  const project = store.saveProject({ name: 'music' }); const account = store.saveAccount({ name: 'fixture', url: `http://127.0.0.1:${address.port}/` });
  const task: Task = { ...store.createTasks({ projectId: project.id, prompts: ['Please create instrumental background music as an MP3 audio file (no vocals).'], kind: 'image', accountId: account.id, input: { timeoutMs: 4500 } })[0], kind: 'music' as Task['kind'] };
  const context: TaskContext = { signal: controller.signal, checkpoint(value) { task.checkpoint = { ...task.checkpoint, ...value }; }, progress() {} };
  try { await run({ store, browsers, task, context, controller, submissions, downloads: () => downloads, videoDownloads: () => videoDownloads, wav }); }
  finally { await browsers.shutdown(); store.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
}

for (const variant of ['link.wav', 'link.mp3', 'link.m4a', 'link.ogg', 'audio.wav', 'source.wav']) {
  test(`music ${variant} downloads new PCM audio once after streaming, never video or an old reply`, async () => {
    await musicFixture(async ({ store, browsers, task, context, submissions, downloads, videoDownloads, wav }) => {
      const page = (await browsers.open(store.account(task.accountId))).pages()[0];
      await page.setViewportSize({ width: variant === 'link.wav' ? 1280 : 390, height: 844 });
      await page.emulateMedia({ colorScheme: variant === 'link.wav' ? 'light' : 'dark' });
      const started = Date.now(); const result = await browsers.generate(task, context);
      assert.ok(Date.now() - started >= 1800); assert.deepEqual(submissions, [task.prompt]); assert.equal(downloads(), 1); assert.equal(videoDownloads(), 0);
      assert.equal(result.outputIds.length, 1); const asset = store.asset(result.outputIds[0]); assert.equal(asset.mime, 'audio/wav'); assert.match(asset.name, /\.wav$/);
      assert.deepEqual(readFileSync(store.assetPath(asset.id)), wav); assert.equal(task.checkpoint.remoteSubmitted, true); assert.match(String(task.checkpoint.downloadUrl), /\/new\./);
      if (variant === 'link.wav') {
        const duration = await page.evaluate(base64 => new Promise<number>((resolve, reject) => { const audio = new Audio(`data:audio/wav;base64,${base64}`); audio.onloadedmetadata = () => resolve(audio.duration); audio.onerror = () => reject(new Error('PCM WAV is not playable')); }), wav.toString('base64'));
        assert.ok(Math.abs(duration - 0.2) < 0.01);
      }
    }, variant);
  });
}

test('music resumes an admitted thread after browser restart without resubmission or a prior audio download', async () => {
  await musicFixture(async ({ store, browsers, task, context, submissions, downloads }) => {
    task.input.timeoutMs = 1000; await assert.rejects(browsers.generate(task, context), NeedsInputError);
    assert.equal(submissions.length, 1); assert.equal(downloads(), 0); assert.equal(task.checkpoint.remoteSubmitted, true); assert.ok(task.checkpoint.threadUrl);
    await browsers.shutdown(); await delay(1000); task.input.timeoutMs = 4500;
    const reopened = new BrowserManager(store);
    try { assert.equal((await reopened.generate(task, context)).outputIds.length, 1); assert.equal(submissions.length, 1); assert.equal(downloads(), 1); }
    finally { await reopened.shutdown(); }
  });
});

test('music cancellation aborts its audio download and never imports partial output', async () => {
  await musicFixture(async ({ store, browsers, task, context, controller, submissions, downloads }) => {
    await assert.rejects(browsers.generate(task, context), { name: 'AbortError' });
    assert.ok(controller.signal.aborted); assert.equal(submissions.length, 1); assert.equal(downloads(), 1); assert.equal(store.assets().length, 0);
  }, 'link.wav', true);
});
