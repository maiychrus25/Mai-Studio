import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { browserExecutable } from '../src/core/browser';
import { StudioService } from '../src/core/studio';
import { captureShopeeProduct, shopeeBookmarklet } from '../src/shared/shopee-capture';
import type { Project, Task } from '../src/shared/studio';

const intake = () => require('../src/core/shopee');
const url = 'https://shopee.vn/product/123/456';
const image = 'https://down-vn.img.susercontent.com/file/vn-product-photo';
const page = (extra = {}) => ({ _: 'maistudio-shopee', v: 1, kind: 'page', url, title: 'Áo xanh', price: '112.686₫ – 120.000₫', description: 'Chất liệu cotton', images: [image], ...extra });

test('Shopee links preserve product identity and accept only supported HTTPS long and short hosts', () => {
  for (const link of [url, 'https://www.shopee.vn/ao-xanh-i.123.456?sp_atk=tracking']) {
    const parsed = intake().shopeeLink(link);
    assert.equal(parsed.url, url); assert.equal(parsed.shopId, '123'); assert.equal(parsed.itemId, '456');
  }
  for (const link of ['https://s.shopee.vn/Ab12', 'https://vn.shp.ee/Ab12', 'https://shope.ee/Ab12']) assert.equal(intake().shopeeLink(link).short, true);
  for (const link of ['http://shopee.vn/product/1/2', 'https://shopee.vn.evil.test/product/1/2', 'https://shopee.vn@evil.test/product/1/2', 'https://shopee.vn:444/product/1/2', 'https://shopee.vn/search', 'file:///product/1/2', 'https://127.0.0.1/product/1/2', 'https://shopee.vn/product/1/9007199254740993']) assert.throws(() => intake().shopeeLink(link), /Shopee|product|URL|ID/i, link);
});

test('short-link resolution validates every redirect and never follows a foreign or private host', async () => {
  const calls: string[] = [];
  const request = async (value: string) => { calls.push(value); return new Response(null, { status: 302, headers: { location: url } }); };
  const resolved = await intake().resolveShopeeLink('https://s.shopee.vn/Ab12', undefined, request);
  assert.equal(resolved.url, url); assert.equal(calls.length, 1);
  for (const location of ['https://evil.test/', 'http://127.0.0.1/', 'https://shopee.vn/user/login']) {
    let count = 0;
    await assert.rejects(intake().resolveShopeeLink('https://s.shopee.vn/Ab12', undefined, async () => { count++; return new Response(null, { status: 302, headers: { location } }); }), /Shopee|product|URL|link/i);
    assert.equal(count, 1);
  }
  await assert.rejects(intake().resolveShopeeLink('https://s.shopee.vn/Ab12', undefined, request, 0), /redirect|link/i);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(intake().resolveShopeeLink('https://s.shopee.vn/Ab12', controller.signal, request), /abort/i);
});

test('visible-page capture retains supplied price text, marks missing facts and accepts the legacy Muse envelope', () => {
  for (const marker of ['maistudio-shopee', 'musestudio-shopee']) {
    const result = intake().parseShopeeCapture(JSON.stringify(page({ _: marker })), url);
    assert.equal(result.product.name, 'Áo xanh'); assert.equal(result.product.price, '112.686₫ – 120.000₫');
    assert.equal(result.product.description, 'Chất liệu cotton'); assert.equal(result.source.method, 'page');
    assert.deepEqual(result.images, [image]); assert.ok(result.source.missingFields.includes('variations'));
    assert.equal(result.product.rating, undefined); assert.equal(result.product.sold, undefined);
  }
  const result = intake().parseShopeeCapture(JSON.stringify(page({ price: '', description: '' })), url);
  assert.ok(result.source.missingFields.includes('price')); assert.ok(result.source.missingFields.includes('description'));
  assert.equal(result.product.priceMin, undefined);
});

test('cached Shopee capture converts documented price units and preserves attributes, variations and source time', () => {
  const result = intake().parseShopeeCapture(JSON.stringify({ _: 'musestudio-shopee', v: 1, kind: 'get_pc', url, capturedAt: '2026-11-16T09:00:00.000Z', data: {
    item: { item_id: 456, shop_id: 123, title: 'Áo xanh', description: 'Mô tả thật', price_min: 11268600000, price_max: 12000000000,
      attributes: [{ name: 'Chất liệu', value: 'cotton' }], tier_variations: [{ name: 'Màu', options: ['Xanh', 'Đen'] }], models: [{ name: 'Xanh / M', price: 11268600000, extinfo: { tier_index: [0, 0] } }] },
    product_images: { images: ['vn-product-photo'] }, product_review: { rating_star: 4.9, total_rating_count: 84, historical_sold: 0 }, shop_detailed: { name: 'Shop thật' }
  } }), url);
  assert.equal(result.product.priceMin, 112686); assert.equal(result.product.priceMax, 120000);
  assert.equal(result.product.attributes[0].value, 'cotton'); assert.equal(result.product.variations[0].price, 112686);
  assert.equal(result.product.rating, 4.9); assert.equal(result.product.sold, 0); assert.equal(result.product.shopName, 'Shop thật');
  assert.equal(result.source.method, 'cached'); assert.equal(result.source.capturedAt, '2026-11-16T09:00:00.000Z');
  assert.deepEqual(result.images, [image]);
});

test('cached Shopee capture uses the current single price when range prices are unavailable', () => {
  // Operator capture: range markers are -1, current price is 53,000 VND, item/model prices start at 59,000 VND.
  const productUrl = 'https://shopee.vn/product/1338941959/52168604861';
  for (const unavailable of [-1, '-1']) {
    const result = intake().parseShopeeCapture(JSON.stringify({ _: 'musestudio-shopee', v: 1, kind: 'get_pc', url: productUrl, data: {
      item: { item_id: 52168604861, shop_id: 1338941959, title: 'Dép xỏ ngón', currency: 'VND', price: 5900000000, price_min: 5900000000, price_max: 6599900000,
        models: [{ name: 'Đen,4-6（34-35）', price: 5900000000 }, { name: 'Hồng,6-8（38-39）', price: 6599900000 }] },
      product_price: { price: { single_value: 5300000000, range_min: unavailable, range_max: unavailable } },
      product_images: { images: ['cn-11134207-820l4-mtqe1njbwmbu4f'] },
      product_review: { rating_star: 4.646017699115045, total_rating_count: 113, historical_sold: null, global_sold: null }, shop_detailed: { name: 'lalafas.vn' }
    } }), productUrl);
    assert.equal(result.product.priceMin, 53000); assert.equal(result.product.priceMax, 53000);
    assert.equal(result.product.price, (53000).toLocaleString('vi-VN') + '₫');
    assert.deepEqual(result.product.variations.map((model: { price: number }) => model.price), [59000, 65999]);
    assert.equal(result.product.ratingCount, 113); assert.equal(result.product.sold, undefined);
    assert.equal(result.product.shopName, 'lalafas.vn'); assert.equal(result.source.capturedAt, undefined);
  }
});

test('cached price markers fall back to supplied item prices without fabricating a missing price', () => {
  const capture = (item: Record<string, unknown> = {}, prices: Record<string, unknown> = {}) => JSON.stringify({ _: 'maistudio-shopee', v: 1, kind: 'get_pc', url, data: {
    item: { item_id: 456, shop_id: 123, title: 'Provided product', ...item }, product_price: { price: { range_min: -1, range_max: -1, single_value: -1, ...prices } }
  } });
  const fallback = intake().parseShopeeCapture(capture({ price_min: 5900000000, price_max: 6599900000 }), url);
  assert.equal(fallback.product.priceMin, 59000); assert.equal(fallback.product.priceMax, 65999);
  const missing = intake().parseShopeeCapture(capture(), url);
  assert.equal(missing.product.price, ''); assert.equal(missing.product.priceMin, undefined); assert.equal(missing.product.priceMax, undefined);
  assert.ok(missing.source.missingFields.includes('price'));
  const zero = intake().parseShopeeCapture(capture({}, { single_value: 0 }), url);
  assert.equal(zero.product.priceMin, 0); assert.equal(zero.product.priceMax, 0);
  for (const invalid of [-2, '-2', '53.000₫', {}, 9007199254740992, 1.5]) {
    assert.throws(() => intake().parseShopeeCapture(capture({}, { range_min: invalid }), url), /numeric|price units/i);
  }
  assert.throws(() => intake().parseShopeeCapture(capture({ item_rating: { rating_star: -1 } }), url), /numeric/i);
  assert.throws(() => intake().shopeeOffer({ itemId: 456, shopId: 123, productName: 'Provided product', price: -1 }, url), /numeric/i);
});

test('capture rejects mismatched identities, unknown envelopes, private image URLs and oversized facts', () => {
  for (const value of [page({ url: 'https://shopee.vn/product/123/999' }), page({ _: 'foreign' }), page({ title: '' }), page({ images: ['https://evil.test/secret.png'] }), page({ images: ['https://down-vn.img.susercontent.com.evil.test/file/a'] }), page({ description: 'x'.repeat(40000) }), { ...page(), kind: 'get_pc', data: { item: { item_id: 999, shop_id: 123, title: 'Wrong' } } }]) assert.throws(() => intake().parseShopeeCapture(JSON.stringify(value), url), /product|Shopee|capture|image|limit|bytes|identity|name|title/i);
  for (const value of ['not JSON', '[]', '{"_":"maistudio-shopee","__proto__":{"polluted":true}}']) assert.throws(() => intake().parseShopeeCapture(value, url), /JSON|capture|product|prototype|object/i);
});

test('official API result maps offer fields without treating absent description or variants as available', () => {
  const result = intake().shopeeOffer({ itemId: 456, shopId: 123, productName: 'Áo xanh', imageUrl: image, priceMin: '112686', priceMax: '120000', ratingStar: '4.9', sales: 20, shopName: 'Shop thật', productLink: url }, url);
  assert.equal(result.product.name, 'Áo xanh'); assert.equal(result.product.priceMin, 112686); assert.equal(result.source.method, 'api');
  assert.ok(result.source.missingFields.includes('description')); assert.ok(result.source.missingFields.includes('variations'));
  assert.throws(() => intake().shopeeOffer({ itemId: 999, shopId: 123, productName: 'Wrong', imageUrl: image }, url), /identity|product/i);
});

test('product image download accepts actual bounded PNG bytes and rejects bad MIME, redirects and over-limit bodies', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=', 'base64');
  const result = await intake().downloadShopeeImage(image, new AbortController().signal, async (_url: string, options: RequestInit) => {
    assert.equal(options.redirect, 'manual'); assert.equal(new Headers(options.headers).has('authorization'), false); assert.equal(new Headers(options.headers).has('cookie'), false);
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  });
  assert.deepEqual(result.buffer, png); assert.equal(result.extension, '.png');
  for (const response of [new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } }), new Response(png, { headers: { 'content-type': 'image/svg+xml' } }), new Response(png, { headers: { 'content-type': 'image/png', 'content-length': '99999999' } }), new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/a' } })]) await assert.rejects(intake().downloadShopeeImage(image, new AbortController().signal, async () => response), /image|HTTP|limit|bytes|URL|Shopee/i);
});

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04sAAAAASUVORK5CYII=', 'base64');
async function finish(studio: StudioService, task: Task): Promise<Task> {
  for (let index = 0; index < 1000; index++) { const current = studio.store.task(task.id); if (!['draft', 'queued', 'running'].includes(current.status)) return current; await delay(10); }
  throw new Error('Product intake did not settle');
}
async function serviceFixture(t: import('node:test').TestContext, run: (studio: StudioService, fixture: { base: string; requests: string[]; setMode(mode: string): void }) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'mai-shopee-')), studio = new StudioService(root); let mode = 'ok'; const requests: string[] = [];
  const server = createServer(async (request, response) => {
    requests.push(request.url!);
    if (request.url === '/graphql') { for await (const _chunk of request) { /* Drain the signed fixture query. */ } response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ data: { productOfferV2: { nodes: [{ itemId: 456, shopId: 123, productName: 'API cup', imageUrl: image, priceMin: '100', priceMax: '100' }] } } })); return; }
    if (mode === 'all-fail' || mode === 'partial' && request.url === '/file/second-image') { response.writeHead(404); response.end('missing'); return; }
    if (mode === 'slow' && request.url === '/file/second-image') { response.writeHead(200, { 'content-type': 'image/png' }); response.write(png.subarray(0, 8)); return; }
    response.setHeader('content-type', 'image/png'); response.end(png);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = 'http://127.0.0.1:' + address.port;
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (value: string | URL, options?: RequestInit) => { const target = String(value); return realFetch(target.startsWith('https://down-vn.img.susercontent.com/') ? base + new URL(target).pathname : target, options); });
  try { await run(studio, { base, requests, setMode(value) { mode = value; } }); }
  finally { await studio.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
}
async function sampleProject(studio: StudioService): Promise<Project> {
  return studio.invoke<Project>('project.save', { name: 'Owned intake', kind: 'affiliate', data: { product: { name: 'Previous product' }, script: 'Keep my script', production: { oldOutput: 'retained' } } });
}

test('desktop intake commands open only validated links and copy only the generated product reader', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mai-shopee-actions-')); const opened: string[] = [], copied: string[] = [];
  const studio = new StudioService(root, { actions: { openExternal: async value => { opened.push(value); }, copyText: async value => { copied.push(value); } } });
  try {
    await studio.invoke('shopee.open', { url: 'https://shopee.vn/ao-i.123.456?tracking=1' }); assert.deepEqual(opened, [url]);
    await assert.rejects(studio.invoke('shopee.open', { url: 'https://evil.test/' })); assert.equal(opened.length, 1);
    const result = await studio.invoke<{ code: string; copied: boolean }>('shopee.bookmarklet', {}); assert.equal(result.code, shopeeBookmarklet()); assert.equal(result.copied, true); assert.deepEqual(copied, [result.code]);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});

test('queued capture imports real image bytes, records provenance and preserves old outputs', async t => {
  await serviceFixture(t, async studio => {
    const project = await sampleProject(studio);
    const task = await studio.invoke<Task>('shopee.import', { projectId: project.id, url, text: JSON.stringify(page({ capturedAt: '2026-11-16T09:00:00.000Z' })) });
    const done = await finish(studio, task); assert.equal(done.status, 'succeeded', done.error); assert.equal(done.outputIds.length, 1);
    const data = studio.store.project(project.id).data as any;
    assert.equal(data.product.name, 'Áo xanh'); assert.equal(data.product.price, '112.686₫ – 120.000₫'); assert.deepEqual(data.productAssetIds, done.outputIds);
    assert.equal(studio.store.asset(done.outputIds[0]).mime, 'image/png'); assert.equal(data.productSource.method, 'page'); assert.equal(data.productSource.capturedAt, '2026-11-16T09:00:00.000Z');
    assert.equal(data.productSource.taskId, task.id); assert.equal(data.productSource.url, url); assert.equal(data.production.oldOutput, 'retained'); assert.equal(data.script, 'Keep my script'); assert.equal(data.productionStale, true);
    assert.equal(data.planningNeedsUpdate, true); assert.ok(data.productSource.missingFields.includes('variations'));
  });
});

test('partial images are visible, while all-image failure leaves the previous product untouched', async t => {
  for (const mode of ['partial', 'all-fail']) await serviceFixture(t, async (studio, fixture) => {
    fixture.setMode(mode); const project = await sampleProject(studio);
    const task = await studio.invoke<Task>('shopee.import', { projectId: project.id, url, text: JSON.stringify(page({ images: [image, 'https://down-vn.img.susercontent.com/file/second-image'] })) });
    const done = await finish(studio, task), data = studio.store.project(project.id).data as any;
    if (mode === 'partial') { assert.equal(done.status, 'succeeded', done.error); assert.equal(done.outputIds.length, 1); assert.equal(data.productSource.imageErrors.length, 1); assert.equal(data.productSource.importedImageCount, 1); assert.equal(data.productSource.imageCount, 2); assert.match(done.message, /1\/2/); }
    else { assert.equal(done.status, 'waiting_input', done.error); assert.deepEqual(data, project.data); assert.equal(done.outputIds.length, 0); }
  });
});

test('cancel retains imported checkpoints and retry downloads only the missing image before applying', async t => {
  await serviceFixture(t, async (studio, fixture) => {
    fixture.setMode('slow'); const project = await sampleProject(studio), capture = JSON.stringify(page({ images: [image, 'https://down-vn.img.susercontent.com/file/second-image'] }));
    const task = await studio.invoke<Task>('shopee.import', { projectId: project.id, url, text: capture });
    for (let index = 0; index < 500 && !fixture.requests.includes('/file/second-image'); index++) await delay(10);
    assert.ok(fixture.requests.includes('/file/second-image')); await studio.invoke('task.action', { action: 'cancel', ids: [task.id] });
    assert.equal(studio.store.task(task.id).status, 'cancelled'); assert.deepEqual(studio.store.project(project.id).data, project.data);
    const first = (studio.store.task(task.id).checkpoint.productImages as any)[image]; assert.ok(first);
    fixture.setMode('ok'); await studio.invoke('task.action', { action: 'retry', ids: [task.id] });
    const done = await finish(studio, task); assert.equal(done.status, 'succeeded', done.error); assert.equal(done.outputIds[0], first);
    assert.equal(fixture.requests.filter(path => path === '/file/vn-product-photo').length, 1); assert.equal(done.outputIds.length, 2);
  });
});

test('a content edit during download cannot be overwritten by a late product import', async t => {
  await serviceFixture(t, async (studio, fixture) => {
    fixture.setMode('slow'); const project = await sampleProject(studio);
    const task = await studio.invoke<Task>('shopee.import', { projectId: project.id, url, text: JSON.stringify(page({ images: [image, 'https://down-vn.img.susercontent.com/file/second-image'] })) });
    for (let index = 0; index < 500 && !fixture.requests.includes('/file/second-image'); index++) await delay(10);
    await studio.invoke('task.action', { action: 'cancel', ids: [task.id] });
    const edited = await studio.invoke<Project>('project.save', { ...project, data: { ...project.data, product: { name: 'New manual product' } } });
    fixture.setMode('ok'); await studio.invoke('task.action', { action: 'retry', ids: [task.id] });
    assert.equal((await finish(studio, task)).status, 'waiting_input'); assert.deepEqual(studio.store.project(project.id).data, edited.data); assert.equal(studio.store.assets().length, 2);
  });
});

test('official API intake signs its read, imports the offer image, and marks unavailable detailed facts', async t => {
  await serviceFixture(t, async (studio, fixture) => {
    await studio.invoke('settings.save', { providers: { shopee: { baseUrl: fixture.base, model: '' } } });
    await studio.invoke('secret.save', { key: 'shopee.key', value: JSON.stringify({ appId: '123', secret: 'fixture-only' }) });
    const project = await sampleProject(studio), task = await studio.invoke<Task>('shopee.import', { projectId: project.id, url });
    const done = await finish(studio, task); assert.equal(done.status, 'succeeded', done.error);
    assert.equal(fixture.requests.filter(path => path === '/graphql').length, 1);
    const data = studio.store.project(project.id).data as any; assert.equal(data.product.name, 'API cup'); assert.equal(data.productSource.method, 'api'); assert.ok(data.productSource.missingFields.includes('description')); assert.equal(done.outputIds.length, 1);
  });
});

test('browser reader prefers exact product structured data and never captures cookies, account state or recommendation images', async () => {
  const browser = await chromium.launch({ executablePath: browserExecutable(), headless: true, chromiumSandbox: true });
  try {
    const page = await browser.newPage(); const requests: string[] = [];
    await page.route('**/*', route => { requests.push(route.request().url()); return route.fulfill({ contentType: 'text/html', body: '<meta charset="utf-8"><h1>Áo xanh</h1><main><div data-testid="product-price">100.000₫</div><div data-testid="product-description">Mô tả thật</div><div data-testid="product-gallery"><img src="' + image + '"></div></main><script type="application/ld+json">' + JSON.stringify({ '@type': 'Product', name: 'Wrong recommendation', url: 'https://shopee.vn/product/123/1456', image: 'https://down-vn.img.susercontent.com/file/wrong-photo', offers: { price: 999 } }) + '</script>' }); });
    await page.goto(url); await page.evaluate(() => { document.cookie = 'login=fixture-private'; (window as any).privateAccount = 'private-token'; });
    const count = requests.length, captured = await page.evaluate(captureShopeeProduct);
    assert.equal(captured.title, 'Áo xanh'); assert.equal(captured.price, '100.000₫'); assert.deepEqual(captured.images, [image]); assert.equal(requests.length, count);
    assert.ok(!JSON.stringify(captured).includes('fixture-private')); assert.ok(!JSON.stringify(captured).includes('private-token')); assert.ok(!JSON.stringify(captured).includes('wrong-photo'));
    const normalized = intake().parseShopeeCapture(JSON.stringify(captured), url); assert.equal(normalized.product.name, 'Áo xanh');
    await page.setContent('<main><section><header><h1>Áo khác</h1></header><div>119.000₫ – 129.000₫</div><div data-testid="product-gallery"><img src="' + image + '"></div></section><aside>Sản phẩm tương tự 9.000₫</aside></main>');
    const visible = await page.evaluate(captureShopeeProduct); assert.equal(visible.price, '119.000₫ – 129.000₫');
    await page.setContent('<main><section><h1>Áo hết giá</h1><div data-testid="product-gallery"><img src="' + image + '"></div></section><aside>SẢN PHẨM TƯƠNG TỰ 9.000₫</aside></main>');
    assert.equal((await page.evaluate(captureShopeeProduct)).price, '');
  } finally { await browser.close(); }
});

test('browser reader uses cache-only product data and exports only allowed product fields', async () => {
  const browser = await chromium.launch({ executablePath: browserExecutable(), headless: true, chromiumSandbox: true });
  try {
    const page = await browser.newPage(); await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<h1>Cache fixture</h1>' })); await page.goto(url);
    await page.evaluate(() => {
      performance.getEntriesByType = () => [{ name: location.origin + '/api/v4/pdp/get_pc?item_id=456&shop_id=123' }] as PerformanceEntry[];
      window.fetch = async (_input, options) => { if (options?.cache !== 'only-if-cached' || options?.mode !== 'same-origin') throw Error('New network request is forbidden'); return new Response(JSON.stringify({ data: { item: { item_id: 456, shop_id: 123, title: 'Cached shirt', description: 'Cached facts', cookie: 'private-cookie', price: 10000000 }, product_images: { images: ['vn-product-photo'] }, account: { token: 'private-token' } } }), { headers: { 'content-type': 'application/json' } }); };
    });
    const captured = await page.evaluate(captureShopeeProduct); assert.equal(captured.kind, 'get_pc'); assert.ok(!JSON.stringify(captured).includes('private-cookie')); assert.ok(!JSON.stringify(captured).includes('private-token'));
    const normalized = intake().parseShopeeCapture(JSON.stringify(captured), url); assert.equal(normalized.product.priceMin, 100);
  } finally { await browser.close(); }
});
