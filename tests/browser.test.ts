import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
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
