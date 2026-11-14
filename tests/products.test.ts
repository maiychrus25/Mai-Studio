import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProducts } from '../src/core/products';

const PRODUCT_LIMIT = 32 * 1024;
const SOURCE_LIMIT = 8 * 1024 * 1024;

test('CSV preserves quoted commas, newlines, escaped quotes, BOM/CRLF, price strings and every column', () => {
  // Field names follow app.js afProductHtml/afProduct; synthetic CSV, not an original CSV export.
  const csv = '\uFEFFtitle,price,description,url,custom\r\n"Áo, xanh"," 001.299.000 ₫ - 1.599.000 ₫ ","Dòng một\r\nDòng ""hai""",https://shopee.vn/product/12/34,"=unchanged"\r\n';
  assert.deepEqual(parseProducts(csv, 'csv'), [{ title: 'Áo, xanh', price: ' 001.299.000 ₫ - 1.599.000 ₫ ', description: 'Dòng một\r\nDòng "hai"', url: 'https://shopee.vn/product/12/34', custom: '=unchanged' }]);
  assert.deepEqual(parseProducts(' name ,price,notes\nMug,,\n\nBottle,0012.50,\n', 'csv'), [{ name: 'Mug', price: '', notes: '' }, { name: 'Bottle', price: '0012.50', notes: '' }]);
  assert.deepEqual(parseProducts('id,title\rSKU-001,\rSKU-002,Named', 'csv'), [{ id: 'SKU-001', title: '' }, { id: 'SKU-002', title: 'Named' }]);
});

test('JSON accepts one product or a batch and preserves original Aff bookmark envelopes and structured facts', () => {
  // Source: artifacts/musestudio/web/shopee_grab.js, page/get_pc payloads. All values here are synthetic.
  const page = { _: 'musestudio-shopee', v: 1, kind: 'page', url: 'https://shopee.vn/product/12/34', title: 'Bình nước', price: '001.299.000₫', description: 'Dòng một\nDòng hai', images: ['https://example.test/provided-image.png'] };
  const cached = { _: 'musestudio-shopee', v: 1, kind: 'get_pc', url: 'https://shopee.vn/product/12/35', data: { item: { item_id: 35, shop_id: 12, title: 'Áo xanh', price: 1299000, attributes: [{ name: 'Material', value: 'Cotton' }], models: [{ name: 'Blue', price: 1299000, extinfo: { tier_index: [0, 1] } }] }, product_price: { price: { range_min: 1299000, range_max: 1599000 } }, product_images: { images: ['original-image-id'] }, product_review: { rating_star: 4.5, historical_sold: 20 } }, provenance: { method: 'user-captured', capturedAt: 'provided timestamp', verified: false } };
  assert.deepEqual(parseProducts('\uFEFF' + JSON.stringify(page), 'json'), [page]);
  assert.deepEqual(parseProducts(JSON.stringify([page, cached]), 'json'), [page, cached]);
  const minimal = { name: 'Plain supplied product', price: '12,50', optional: null, variants: [{ selected: false }] };
  assert.deepEqual(parseProducts(JSON.stringify(minimal), 'json'), [minimal]);
  assert.deepEqual(Object.keys(parseProducts('{"id":"00012345678901234567890"}', 'json')[0]), ['id']);
});

test('product identity must be a supplied name/title, product URL or product ID, not a fabricated default', () => {
  for (const record of [{ title: 'Provided' }, { name: 'Provided' }, { productName: 'Provided' }, { url: 'https://example.test/product' }, { productUrl: 'http://example.test/p' }, { product_url: 'https://example.test/p' }, { productLink: 'https://example.test/p' }, { link: 'https://example.test/p' }, { id: 'SKU-0001' }, { product_id: '0001' }, { productId: 12 }, { item_id: 34 }, { itemId: 35 }]) {
    assert.deepEqual(parseProducts(JSON.stringify(record), 'json'), [record]);
  }
  for (const record of [{}, { price: '129.000₫', description: 'No identity' }, { title: '  ' }, { name: 42 }, { title: {} }, { url: 'not a product URL' }, { url: 'javascript:alert(1)' }, { id: [] }, { shop_id: 'shop-only' }]) assert.throws(() => parseProducts(JSON.stringify(record), 'json'), /identity|name|title|product/i);
});

test('CSV requires distinct safe headers and exact field counts, with strict quoting', () => {
  for (const csv of ['', '\uFEFF', '\n\r\n', 'title', 'title\n', 'Mug,12\nBottle,13', 'title,title\nOne,Two', 'title, title \nOne,Two', 'title,\nOne,Two', ',title\nOne,Two', 'title,price\nOne', 'title,price\nOne,2,extra', 'title,price\n,2', 'title\n"unterminated', 'title\nnot"quoted', 'title\n"valid"junk', 'title\n"valid" ', 'title\n""']) {
    assert.throws(() => parseProducts(csv, 'csv'), /CSV|header|row|quote|product|identity/i, JSON.stringify(csv));
  }
  assert.deepEqual(parseProducts('title,description\n"""Quoted""","Comma, quote "" and newline\ninside"', 'csv'), [{ title: '"Quoted"', description: 'Comma, quote " and newline\ninside' }]);
});

test('JSON rejects non-object products, malformed input and non-representable numeric facts', () => {
  for (const input of ['', 'null', 'true', '42', '"name"', '[]', '[null]', '["name"]', '[[{"title":"Nested list"}]]', '{', '{"title":"One",}', '{"title":"One","price":1e400}', '{"id":9007199254740993}']) assert.throws(() => parseProducts(input, 'json'), /JSON|product|number|integer|batch/i, input);
  assert.throws(() => parseProducts('title\nOne', 'xml' as 'csv'), /format/i);
  assert.throws(() => parseProducts(null as unknown as string, 'json'), /source|input/i);
});

test('prototype keys and NUL are rejected in CSV headers, raw source and every nested JSON property/value', () => {
  for (const key of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', '__defineGetter__']) {
    assert.throws(() => parseProducts(`title,${key}\nOne,unsafe`, 'csv'), /key|header|prototype/i);
    const escaped = JSON.stringify(key);
    for (const json of [`{"title":"One",${escaped}:{"polluted":true}}`, `{"title":"One","attributes":[{${escaped}:"unsafe"}]}`]) assert.throws(() => parseProducts(json, 'json'), /key|prototype/i);
  }
  for (const input of ['title\nNa\0me', 'ti\0tle\nName']) assert.throws(() => parseProducts(input, 'csv'), /NUL/i);
  for (const input of ['{"title":"Na\u0000me"}', '{"title":"Name","nested":{"key\\u0000":"value"}}', '{"title":"Name","nested":["value\\u0000"]}', '{"title":"Name","nested":{"\\u005f\\u005fproto__":{}}}']) assert.throws(() => parseProducts(input, 'json'), /NUL|key|prototype/i);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('product count and UTF-8 byte bounds accept exact limits and reject oversized source/records', () => {
  const count = 1000;
  assert.equal(parseProducts('title,price\n' + Array.from({ length: count }, (_, i) => `Product ${i},00${i}`).join('\n'), 'csv').length, count);
  assert.equal(parseProducts(JSON.stringify(Array.from({ length: count }, (_, i) => ({ id: String(i) }))), 'json').length, count);
  assert.throws(() => parseProducts('title\n' + 'Product\n'.repeat(1001), 'csv'), /1000|count|batch/i);
  assert.throws(() => parseProducts(JSON.stringify(Array.from({ length: 1001 }, (_, i) => ({ id: String(i) }))), 'json'), /1000|count|batch/i);
  const empty = JSON.stringify({ title: '' }).length;
  const exact = 'x'.repeat(PRODUCT_LIMIT - empty);
  assert.equal(Buffer.byteLength(JSON.stringify({ title: exact })), PRODUCT_LIMIT);
  assert.deepEqual(parseProducts(JSON.stringify({ title: exact }), 'json'), [{ title: exact }]);
  assert.deepEqual(parseProducts('title\n' + exact, 'csv'), [{ title: exact }]);
  assert.throws(() => parseProducts(JSON.stringify({ title: exact + 'x' }), 'json'), /32|size|large|limit/i);
  assert.throws(() => parseProducts('title\n' + exact + 'x', 'csv'), /32|size|large|limit/i);
  assert.throws(() => parseProducts(JSON.stringify({ title: '界'.repeat(12000) }), 'json'), /32|size|large|limit/i);
  assert.throws(() => parseProducts('title\n' + '界'.repeat(12000), 'csv'), /32|size|large|limit/i);
  const valid = '{"title":"Product"}';
  assert.deepEqual(parseProducts(valid + ' '.repeat(SOURCE_LIMIT - Buffer.byteLength(valid)), 'json'), [{ title: 'Product' }]);
  assert.throws(() => parseProducts(valid + ' '.repeat(SOURCE_LIMIT - Buffer.byteLength(valid) + 1), 'json'), /8|source|large|limit/i);
  assert.throws(() => parseProducts('界'.repeat(Math.floor(SOURCE_LIMIT / 3) + 1), 'csv'), /8|source|large|limit/i);
});

test('stress: repeated 1000-product CSV/JSON batches preserve ordering, all structured facts and original prices', () => {
  const records = Array.from({ length: 1000 }, (_, i) => ({ title: `Tên ${i}, "x"\nNext`, price: `00${i}.000 ₫`, extra: { index: i, attributes: ['retained', null, false] } }));
  const quote = (value: string) => '"' + value.replace(/"/g, '""') + '"';
  const csv = 'title,price\r\n' + records.map(p => [p.title, p.price].map(quote).join(',')).join('\r\n');
  const json = JSON.stringify(records);
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(parseProducts(json, 'json'), records);
    assert.deepEqual(parseProducts(csv, 'csv'), records.map(({ title, price }) => ({ title, price })));
  }
});

test('identity must be an own supplied field even if another module has modified Object.prototype', () => {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'name');
  Object.defineProperty(Object.prototype, 'name', { value: 'Not supplied in product JSON', configurable: true, writable: true });
  try { assert.throws(() => parseProducts('{}', 'json'), /identity|name|title|product/i); }
  finally { if (previous) Object.defineProperty(Object.prototype, 'name', previous); else Reflect.deleteProperty(Object.prototype, 'name'); }
});
