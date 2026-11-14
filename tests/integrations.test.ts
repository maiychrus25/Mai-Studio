import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { IntegrationClient } from '../src/core/integrations';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
async function fixture(handler: http.RequestListener, run: (base: string) => Promise<void>) {
  const server = http.createServer(handler);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try { await run(`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/v1`); }
  finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}

test('OpenAI-compatible text, image, multipart ASR/refs and binary speech use actual HTTP', async () => {
  const seen: string[] = [];
  await fixture(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString(); seen.push(req.url!);
    assert.equal(req.headers.authorization, 'Bearer fixture-key');
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/audio/speech') {
      assert.equal(JSON.parse(body).voice, 'alloy');
      const wav = Buffer.alloc(48); wav.write('RIFF'); wav.write('WAVE', 8); wav.write('fmt ', 12);
      res.setHeader('Content-Type', 'audio/wav'); res.end(wav);
    } else if (req.url === '/v1/audio/transcriptions') {
      assert.match(body, /name="file"/); assert.match(body, /name="model"/); res.end(JSON.stringify({ text: 'Xin chào' }));
    } else if (req.url?.startsWith('/v1/images/')) {
      if (req.url.endsWith('edits')) assert.match(body, /name="image\[\]"/);
      res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
    } else { assert.ok(JSON.parse(body).messages); res.end(JSON.stringify({ choices: [{ message: { content: 'Kế hoạch thật' } }] })); }
  }, async base => {
    const client = new IntegrationClient({ baseUrl: base, apiKey: 'fixture-key', model: 'fixture-model' });
    assert.equal(await client.plan('Viết truyện'), 'Kế hoạch thật');
    assert.equal(await client.translate('Hello', 'Vietnamese'), 'Kế hoạch thật');
    assert.ok((await client.voices()).length);
    assert.equal((await client.speak('Xin chào', 'alloy')).mime, 'audio/wav');
    assert.deepEqual((await client.generateImage('Sunrise')).buffer, png);
    const dir = await mkdtemp(join(tmpdir(), 'studio-provider-'));
    try {
      const path = join(dir, 'ref.png'); await writeFile(path, png);
      assert.equal(await client.transcribe(path), 'Xin chào');
      assert.deepEqual((await client.generateImage('Edit', { refs: [path] })).buffer, png);
    } finally { await rm(dir, { recursive: true, force: true }); }
    assert.equal(seen.length, 6);
  });
});

test('vision review sends real local image bytes and MIME types with the original prompt and returns provider JSON as text', async () => {
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYwLjMuMTAwAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkJCgoKDAwLCw4ODhERFP/EAEwAAQEAAAAAAAAAAAAAAAAAAAAGAQEBAAAAAAAAAAAAAAAAAAAGBxABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAIAAgMBIgACEQADEQD/2gAMAwEAAhEDEQA/AIsAUX9//9k=', 'base64');
  const prompt = 'Compare these references; return the observed face/outfit differences as JSON.';
  const reply = JSON.stringify({ matches: false, differences: ['fixture provider observation'] });
  let posts = 0;
  await fixture(async (req, res) => {
    posts++; assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer vision-fixture-key');
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); assert.equal(body.model, 'chosen-vision-model');
    assert.equal(body.messages.length, 1); assert.equal(body.messages[0].role, 'user');
    assert.deepEqual(body.messages[0].content, [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,' + png.toString('base64') } },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + jpeg.toString('base64') } },
    ]);
    assert.ok(!raw.includes('reference-path'));
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
  }, async base => {
    const dir = await mkdtemp(join(tmpdir(), 'studio-vision-'));
    try {
      const paths = [join(dir, 'reference-path.wrong-extension'), join(dir, 'reference-path.jpg')];
      await writeFile(paths[0], png); await writeFile(paths[1], jpeg);
      const result = await new IntegrationClient({ baseUrl: base, apiKey: 'vision-fixture-key', model: 'chosen-vision-model' }).reviewImages(prompt, paths);
      assert.equal(typeof result, 'string'); assert.equal(result, reply); assert.equal(posts, 1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('vision accepts sixteen refs and the full 25 MiB raw-image budget without widening generic JSON requests', async () => {
  const limit = 25 * 1024 * 1024; let posts = 0;
  await fixture(async (req, res) => {
    posts++; assert.equal(req.url, '/v1/chat/completions');
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); const content = body.messages[0].content;
    assert.equal(content.length, posts === 1 ? 17 : 2);
    assert.equal(content.slice(1).reduce((sum: number, part: { image_url: { url: string } }) => sum + Buffer.from(part.image_url.url.split(',')[1], 'base64').length, 0), posts === 1 ? png.length * 16 : limit);
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'provider review' } }] }));
  }, async base => {
    const dir = await mkdtemp(join(tmpdir(), 'studio-vision-limit-'));
    try {
      const file = join(dir, 'ref.png'), large = join(dir, 'large.png');
      await writeFile(file, png); await writeFile(large, Buffer.concat([png, Buffer.alloc(limit - png.length)]));
      const client = new IntegrationClient({ baseUrl: base });
      assert.equal(await client.reviewImages('Review', Array(16).fill(file)), 'provider review');
      assert.equal(await client.reviewImages('Review', [large]), 'provider review');
      await assert.rejects(client.reviewImages('Review', [large, file]), /25 MiB|reference upload/i);
      await assert.rejects(client.json('POST', '/chat/completions', { raw: 'x'.repeat(9 * 1024 * 1024) }), /request too large/i);
      assert.equal(posts, 2);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('vision rejects invalid refs, non-images, SVG, empty/oversized files and abort before any request', async () => {
  let posts = 0;
  await fixture((_req, res) => { posts++; res.setHeader('Content-Type', 'application/json'); res.end('{}'); }, async base => {
    const dir = await mkdtemp(join(tmpdir(), 'studio-vision-invalid-'));
    try {
      const image = join(dir, 'ref.png'), svg = join(dir, 'ref.svg'), audio = join(dir, 'audio.wav'), empty = join(dir, 'empty'), huge = join(dir, 'huge');
      await writeFile(image, png); await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      await writeFile(audio, 'RIFF----WAVE---------------------audio'); await writeFile(empty, '');
      await writeFile(huge, Buffer.alloc(25 * 1024 * 1024 + 1));
      const client = new IntegrationClient({ baseUrl: base });
      for (const paths of [[], Array(17).fill(image), [svg], [audio], [empty], [huge], ['https://example.test/image.png'], ['data:image/png;base64,abc'], [null], [{ path: image }], 'not-an-array'] as unknown[]) await assert.rejects(client.reviewImages('Review', paths as string[]), /image|refs|path|upload|file/i);
      const abort = new AbortController(); abort.abort();
      await assert.rejects(client.reviewImages('Review', [image], abort.signal), /abort/i);
      await assert.rejects(client.reviewImages('', [image]), /prompt/i);
      assert.equal(posts, 0);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('vision reuses strict completion parsing and active abort never retries or fabricates a review', async () => {
  let posts = 0, mode = 'blank', submitted: (() => void) | undefined;
  await fixture(async (req, res) => {
    posts++; for await (const _chunk of req) { /* consume the actual image request */ }
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'hang') { res.write('{'); submitted?.(); return; }
    res.end(JSON.stringify(mode === 'object' ? { choices: [{ message: { content: { ok: true } } }] } : mode === 'missing' ? {} : { choices: [{ message: { content: '' } }] }));
  }, async base => {
    const dir = await mkdtemp(join(tmpdir(), 'studio-vision-abort-'));
    try {
      const image = join(dir, 'ref.png'); await writeFile(image, png); const client = new IntegrationClient({ baseUrl: base });
      for (const variant of ['blank', 'object', 'missing']) { mode = variant; await assert.rejects(client.reviewImages('Review', [image]), /text|response|choices/i); }
      mode = 'hang'; const started = new Promise<void>(resolve => submitted = resolve), abort = new AbortController();
      const running = client.reviewImages('Review', [image], abort.signal), rejected = assert.rejects(running, /abort/i);
      await started; abort.abort(); await rejected; assert.equal(posts, 4);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('network trust boundary rejects redirects, path injection, malformed/empty/oversized responses and redacts errors', async () => {
  await fixture((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.endsWith('/redirect')) { res.writeHead(302, { Location: 'http://localhost:1/secret' }); res.end(); }
    else if (req.url?.endsWith('/oversize')) res.end('x'.repeat(9 * 1024 * 1024));
    else if (req.url?.endsWith('/error')) { res.statusCode = 429; res.end('fixture-key echoed'); }
    else if (req.url?.endsWith('/malformed')) res.end('no json');
    else res.end(JSON.stringify({ choices: [{ message: { content: '' } }], data: [{ b64_json: 'bm90IGFuIGltYWdl' }] }));
  }, async base => {
    const c = new IntegrationClient({ baseUrl: base, apiKey: 'fixture-key' });
    for (const path of ['https://evil.test', '//evil.test', '/%2e%2e/secret', '/\\evil.test', '/../secret']) {
      await assert.rejects(c.json('GET', path), /path|URL/i);
    }
    for (const path of ['/redirect', '/oversize', '/error', '/malformed']) {
      await assert.rejects(c.json('GET', path), (e: Error) => !e.message.includes('fixture-key'));
    }
    await assert.rejects(c.plan('hello'), /text|response/i);
    await assert.rejects(c.generateImage('hello'), /image|media/i);
    const abort = new AbortController(); abort.abort();
    await assert.rejects(c.plan('hello', abort.signal), /abort|cancel/i);
    await assert.rejects(c.market('download', { productId: 'http://169.254.169.254' }), /product ID/i);
  });
  for (const baseUrl of ['http://example.com', 'http://127.1', 'http://2130706433', 'https://u:p@example.com', 'file:///tmp']) {
    assert.throws(() => new IntegrationClient({ baseUrl }), /HTTPS|URL|credential|loopback/i);
  }
});

test('Shopee signs the exact GraphQL body and rejects unprovisioned credentials/URLs/errors', async () => {
  await fixture(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    assert.equal(req.url, '/v1/graphql');
    const auth = req.headers.authorization!;
    const timestamp = /Timestamp=(\d+)/.exec(auth)![1];
    assert.ok(auth.includes(createHash('sha256').update('123' + timestamp + raw + 'secret').digest('hex')));
    assert.match(JSON.parse(raw).query, /productOfferV2/);
    assert.deepEqual(JSON.parse(raw), { query: '{productOfferV2(itemId:456,shopId:123,limit:1,page:1){nodes{itemId shopId productName imageUrl priceMin priceMax price priceDiscountRate ratingStar sales shopName shopType productLink offerLink productCatIds}}}' });
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: { productOfferV2: { nodes: [{ itemId: 456, productName: 'Owned offer' }] } } }));
  }, async base => {
    const client = new IntegrationClient({ baseUrl: base, apiKey: JSON.stringify({ appId: '123', secret: 'secret' }) });
    const result = await client.shopeeProduct('https://shopee.vn/product/123/456') as { productName: string };
    assert.equal(result.productName, 'Owned offer');
    await assert.rejects(client.shopeeProduct('https://evil.test/product/123/456'), /Shopee|URL/i);
    await assert.rejects(new IntegrationClient({ baseUrl: base }).shopeeProduct('https://shopee.vn/product/123/456'), /unconfigured/i);
  });
});

test('aborting a streamed response closes it and rejects unsafe media URL references', async () => {
  let imageUrl = 'https://127.0.0.1/internal';
  await fixture((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.endsWith('/hang')) { res.write('{'); return; }
    res.end(JSON.stringify({ data: [{ url: imageUrl }] }));
  }, async base => {
    const c = new IntegrationClient({ baseUrl: base });
    await assert.rejects(c.json('GET', '/hang', undefined, AbortSignal.timeout(25)), /abort/i);
    for (const url of ['https://127.0.0.1/internal', 'https://169.254.169.254/latest', 'https://[::1]/secret', 'https://localhost/secret', 'https://user:pass@cdn.test/image.png']) {
      imageUrl = url; await assert.rejects(c.generateImage('x'), /Unsafe|URL|credential/i);
    }
  });
});

// Contract source: market.pyc SHA256 7afdf0ec9eb71ef0705c651ccca6ee7c704e710178b79ecc579c82f98b1bbb16,
// CPython 3.14 dis of BotlamvideoClient, web_slugify/product_url; server.pyc market_buy. LIVE UNVERIFIED.
test('observed Market cookie login/catalog/library/delivery/image/logout and browser purchase URLs', async () => {
  const productId = '12345678-1234-1234-1234-123456789abc'; const cookie = 'a'.repeat(64); const seen: string[] = [];
  await fixture(async (req, res) => {
    seen.push(req.url!); assert.equal(req.headers.authorization, undefined);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/api/products') res.end(JSON.stringify([{ id: productId, title: 'Điện ảnh Việt', image: '/api/images/12345678', price: 100 }]));
    else if (req.url === '/v1/api/auth/login') {
      let raw = ''; for await (const b of req) raw += b;
      assert.deepEqual(JSON.parse(raw), { email: 'fixture@example.com', password: 'fixture-password' });
      res.setHeader('Set-Cookie', ['unrelated=value; HttpOnly', `botlamvideo_session=${cookie}; Path=/; HttpOnly; Secure`]);
      res.end(JSON.stringify({ user: { id: 'user1', email: 'fixture@example.com', fullName: 'Fixture Owner', name: 'fixture-password ' + cookie, token: 'never-expose' } }));
    } else if (req.url === '/v1/api/images/12345678') { res.setHeader('Content-Type', 'image/png'); res.end(png); }
    else {
      assert.equal(req.headers.cookie, 'botlamvideo_session=' + cookie);
      if (req.url === '/v1/api/account/orders') res.end(JSON.stringify({ library: [{ productId, deliveryUrl: '/api/deliveries/' + productId }] }));
      else if (req.url === '/v1/api/deliveries/' + productId) { res.setHeader('Content-Type', 'text/plain'); res.end('A genuine owned master prompt with more than twenty characters.'); }
      else if (req.url === '/v1/api/auth/logout') res.end(JSON.stringify({ ok: true }));
      else { res.statusCode = 404; res.end('{}'); }
    }
  }, async base => {
    const client = new IntegrationClient({ baseUrl: base });
    assert.equal((await client.market('catalog', {}) as unknown[]).length, 1);
    const login = await client.market('login', { email: 'fixture@example.com', password: 'fixture-password' });
    assert.equal(client.exportSession(), cookie);
    assert.ok(!JSON.stringify(login).includes(cookie)); assert.ok(!JSON.stringify(login).includes('never-expose')); assert.ok(!JSON.stringify(login).includes('fixture-password'));
    assert.equal((await client.market('library', {}) as unknown[]).length, 1);
    const delivery = await client.market('download', { productId }) as { text: string }; assert.match(delivery.text, /genuine owned master prompt/);
    const image = await client.market('download', { imageId: '12345678' }) as { buffer: Buffer; mime: string }; assert.deepEqual(image.buffer, png); assert.equal(image.mime, 'image/png');
    const purchase = await client.market('buy', { productId }) as { url: string; purchased: boolean };
    assert.equal(purchase.url, base + '/chatbotprompt/dien-anh-viet--' + productId); assert.equal(purchase.purchased, false);
    await client.market('logout', {}); assert.equal(client.exportSession(), ''); await assert.rejects(client.market('library', {}), /needs_login/i);
    const count = seen.length;
    await assert.rejects(client.market('download', { productId: 'https://evil.test/path' }), /product ID/i);
    await assert.rejects(client.market('download', { imageId: '../auth/me' }), /image ID/i);
    assert.equal(seen.length, count);
  });
});

test('Market rejects missing cookies, expired sessions, bad schemas, HTML delivery, attachment and redirects without secret echoes', async () => {
  const productId = '12345678-1234-1234-1234-123456789abc'; let variant = 'missing-cookie';
  await fixture((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (variant === 'missing-cookie') res.end(JSON.stringify({ user: { email: 'test@example.com' } }));
    else if (variant === 'auth') { res.statusCode = 401; res.end('fixture-password ' + 'a'.repeat(64)); }
    else if (variant === 'bad-catalog') res.end('{}');
    else if (req.url?.includes('/api/account/orders')) res.end(JSON.stringify({ library: [{ productId, deliveryUrl: '/api/deliveries/' + productId }] }));
    else if (variant === 'html') { res.setHeader('Content-Type', 'text/html'); res.end('<html>not a prompt</html>'); }
    else if (variant === 'attachment') { res.setHeader('Content-Type', 'text/plain'); res.setHeader('Content-Disposition', 'attachment; filename=prompt.txt'); res.end('Not a supported automatic master prompt attachment'); }
    else if (variant === 'redirect') { res.writeHead(302, { Location: 'https://evil.test/private' }); res.end(); }
    else res.end(JSON.stringify({ error: 'fixture-password' }));
  }, async base => {
    const client = new IntegrationClient({ baseUrl: base, apiKey: 'a'.repeat(64) });
    await assert.rejects(client.market('login', { email: 'test@example.com', password: 'fixture-password' }), /session|cookie/i);
    variant = 'bad-catalog'; await assert.rejects(client.market('catalog', {}), /catalog|response/i);
    for (const v of ['html', 'attachment', 'redirect']) { variant = v; await assert.rejects(new IntegrationClient({ baseUrl: base, apiKey: 'a'.repeat(64) }).market('download', { productId }), /HTML|attachment|request|response|delivery/i); }
    variant = 'auth'; const expired = new IntegrationClient({ baseUrl: base, apiKey: 'a'.repeat(64) });
    await assert.rejects(expired.market('library', {}), (e: Error) => !e.message.includes('fixture-password') && !e.message.includes('a'.repeat(64)));
    await assert.rejects(expired.market('library', {}), /needs_login/);
  });
});

// VoiceTube source: voicetube.pyc SHA256 978bf5134ea47d8fbdb49fe6ab74e8272b7382da515947f65513a3c343098009.
// Static contract from VoiceTube.voices/create/job/wait/download; fixture only, LIVE UNVERIFIED.
test('observed VoiceTube voice groups, job submission/polling and signed audio URL reference', async () => {
  let posts = 0; let failed = false; let submitted: Record<string, unknown> = {};
  await fixture(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer voice-fixture-key'); res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/api/v1/voices') res.end(JSON.stringify({ customVoices: [], systemVoices: [{ id: 'system-voice-id-123', displayName: 'System voice' }], libraryVoices: [{ id: 'library-voice-id-123', name: 'Library voice', locale: 'en-US' }] }));
    else if (req.method === 'POST') { posts++; let raw = ''; for await (const c of req) raw += c; submitted = JSON.parse(raw); res.end(JSON.stringify({ jobId: 'job-fixture-12345678' })); }
    else if (req.url === '/v1/api/v1/tts/jobs/job-fixture-12345678') res.end(JSON.stringify({ job: { status: failed ? 'FAILED' : 'SUCCEEDED', outputDurationSeconds: 2, errorMessage: 'voice-fixture-key must not echo' } }));
    else if (req.url === '/v1/api/tts/jobs/job-fixture-12345678/download?format=json') res.end(JSON.stringify({ url: 'https://audio.example.test/output.wav?signature=reference-only' }));
    else { res.statusCode = 404; res.end('{}'); }
  }, async base => {
    const client = new IntegrationClient({ baseUrl: base, apiKey: 'voice-fixture-key' }, { protocol: 'voicetube' });
    const voices = await client.voices() as { id: string; kind: string }[]; assert.equal(voices.length, 2); assert.equal(voices[1].kind, 'library');
    const result = await client.speak('Hello', 'library-voice-id-123');
    assert.equal(result.mime, 'audio/wav'); assert.match(result.url!, /^https:\/\/audio.example.test/);
    assert.equal(posts, 1); assert.deepEqual(submitted, { text: 'Hello', qualityMode: 'standard', language: 'en', speed: 1, engine: 'library', generationMode: 'voice_clone', libraryVoiceId: 'library-voice-id-123' });
    failed = true; await assert.rejects(client.speak('Hello', 'system-voice-id-123'), (e: Error) => !e.message.includes('voice-fixture-key') && /FAILED|failed/i.test(e.message));
    await assert.rejects(client.speak('Hello', 'missing'), /voice/i);
  });
});

test('stress: concurrent bounded HTTP calls and VoiceTube cancellation never resubmit a billed job', async () => {
  let creates = 0; let polls = 0;
  await fixture(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.endsWith('/api/v1/voices')) res.end(JSON.stringify({ systemVoices: [{ id: 'voice-fixture-12345678', displayName: 'Fixture' }] }));
    else if (req.method === 'POST' && req.url?.endsWith('/api/v1/tts/jobs')) { creates++; res.end(JSON.stringify({ jobId: 'job-fixture-12345678' })); }
    else if (req.url?.endsWith('/api/v1/tts/jobs/job-fixture-12345678')) { polls++; res.end(JSON.stringify({ job: { status: 'RUNNING' } })); }
    else res.end(JSON.stringify({ ok: true }));
  }, async base => {
    const client = new IntegrationClient({ baseUrl: base, apiKey: 'fixture' });
    const values = await Promise.all(Array.from({ length: 40 }, () => client.json('GET', '/bounded')));
    assert.ok(values.every(value => (value as { ok: boolean }).ok));
    const voice = new IntegrationClient({ baseUrl: base, apiKey: 'fixture' }, { protocol: 'voicetube' });
    const controller = new AbortController();
    const speech = voice.speak('Hello', 'voice-fixture-12345678', controller.signal);
    while (!polls) await new Promise(r => setTimeout(r, 5));
    controller.abort(); await assert.rejects(speech, (e: Error) => /Reconcile before retrying/.test(e.message) && !e.message.includes('fixture'));
    assert.equal(creates, 1); assert.equal(polls, 1);
  });
});

test('timed ASR requests verbose JSON segments, preserves custom model and plain ASR multipart behavior', async () => {
  const requests: { method: string | undefined; path: string | undefined; fields: string }[] = [];
  const segments = [{ start: 0, end: 1.25, text: 'Xin chào' }, { start: 1.25, end: 2.75, text: 'Việt Nam' }];
  await fixture(async (req, res) => {
    let fields = ''; for await (const chunk of req) fields += chunk;
    requests.push({ method: req.method, path: req.url, fields });
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ text: 'Xin chào Việt Nam', segments: segments.map((segment, id) => ({ ...segment, id, tokens: [7] })) }));
  }, async base => {
    const dir = await mkdtemp(join(tmpdir(), 'studio-timed-asr-'));
    try {
      const path = join(dir, 'speech.wav'); const wav = Buffer.alloc(48); wav.write('RIFF'); wav.write('WAVE', 8); await writeFile(path, wav);
      for (const model of ['whisper-1', 'custom-timestamp-model']) {
        const client = new IntegrationClient({ baseUrl: base, apiKey: 'fixture-key', model });
        assert.deepEqual(await client.transcribeTimed(path), { text: 'Xin chào Việt Nam', segments });
        const request = requests.at(-1)!;
        assert.equal(request.method, 'POST'); assert.equal(request.path, '/v1/audio/transcriptions');
        assert.match(request.fields, new RegExp('name="model"\\r\\n\\r\\n' + model + '\\r\\n'));
        assert.match(request.fields, /name="response_format"\r\n\r\nverbose_json\r\n/);
        assert.match(request.fields, /name="timestamp_granularities\[\]"\r\n\r\nsegment\r\n/);
        assert.match(request.fields, /name="file"; filename="speech.wav"/);
        assert.equal(await client.transcribe(path), 'Xin chào Việt Nam');
        assert.doesNotMatch(requests.at(-1)!.fields, /name="response_format"|name="timestamp_granularities/);
      }
      assert.equal(requests.length, 4);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('known GPT ASR models keep JSON and real text without requesting unsupported timestamps or retrying', async () => {
  const requests: string[] = []; let reject = false;
  await fixture(async (req, res) => {
    let fields = ''; for await (const chunk of req) fields += chunk; requests.push(fields);
    res.setHeader('Content-Type', 'application/json');
    if (reject) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Unsupported fixture request' })); }
    else res.end(JSON.stringify({ text: 'Real transcript, no timestamps' }));
  }, async base => {
    const dir = await mkdtemp(join(tmpdir(), 'studio-json-asr-'));
    try {
      const path = join(dir, 'speech.wav'); await writeFile(path, Buffer.from('controlled audio fixture'));
      for (const model of ['gpt-transcribe', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe-2025-06-03', 'gpt-4o-mini-transcribe-2025-12-15', 'gpt-4o-transcribe-diarize']) {
        const client = new IntegrationClient({ baseUrl: base, model });
        assert.deepEqual(await client.transcribeTimed(path), { text: 'Real transcript, no timestamps', segments: [] });
        const fields = requests.at(-1)!;
        assert.ok(fields.includes('name="model"\r\n\r\n' + model + '\r\n'));
        assert.match(fields, /name="response_format"\r\n\r\njson\r\n/);
        assert.doesNotMatch(fields, /timestamp_granularities|verbose_json/);
      }
      const count = requests.length; reject = true;
      await assert.rejects(new IntegrationClient({ baseUrl: base, model: 'custom-timestamps' }).transcribeTimed(path), /HTTP 400/);
      assert.equal(requests.length, count + 1, 'a rejected paid POST must not be retried with another format/model');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test('timed ASR validates finite ordered intervals, text, schema and segment bound without inventing timings', async () => {
  let response: unknown = {}; let raw: string | undefined;
  await fixture((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(raw ?? JSON.stringify(response)); }, async base => {
    const dir = await mkdtemp(join(tmpdir(), 'studio-asr-validation-'));
    try {
      const path = join(dir, 'speech.wav'); await writeFile(path, Buffer.from('controlled audio fixture'));
      const client = new IntegrationClient({ baseUrl: base, model: 'whisper-1' });
      for (const value of [{ text: 'Real transcript' }, { text: 'Real transcript', segments: [] }]) {
        response = value; assert.deepEqual(await client.transcribeTimed(path), { text: 'Real transcript', segments: [] });
      }
      const valid = { start: 0, end: 1, text: 'Spoken text' };
      for (const segments of [null, {}, [null], [{ ...valid, start: '0' }], [{ ...valid, end: null }], [{ ...valid, start: -1 }], [{ ...valid, end: 0 }], [{ start: 2, end: 1, text: 'Reversed' }], [{ ...valid, text: '' }], [{ ...valid, text: '  ' }], [{ ...valid, text: 7 }], [valid, { start: 0.5, end: 2, text: 'Overlap' }], [{ start: 2, end: 3, text: 'Later' }, valid], Array.from({ length: 1001 }, (_, i) => ({ start: i, end: i + 1, text: 'Segment' }))]) {
        response = { text: 'Real transcript', segments }; await assert.rejects(client.transcribeTimed(path), /segment|interval|text|response/i);
      }
      raw = '{"text":"Real transcript","segments":[{"start":0,"end":1e999,"text":"Overflow"}]}';
      await assert.rejects(client.transcribeTimed(path), /segment|interval/i); raw = undefined;
      for (const value of [{ text: '' }, { text: '  ', segments: [valid] }, { segments: [valid] }, []]) {
        response = value; await assert.rejects(client.transcribeTimed(path), /text|response/i);
      }
      response = { text: '1000 real timed segments', segments: Array.from({ length: 1000 }, (_, i) => ({ start: i + 0.25, end: i + 0.75, text: 'Segment ' + i })) };
      assert.equal((await client.transcribeTimed(path)).segments.length, 1000);
      raw = '{'; await assert.rejects(client.transcribeTimed(path), /response|JSON/i);
      const abort = new AbortController(); abort.abort(); await assert.rejects(client.transcribeTimed(path, abort.signal), /abort/i);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
