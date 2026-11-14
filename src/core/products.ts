const MAX_PRODUCTS = 1000;
const MAX_PRODUCT_BYTES = 32 * 1024;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const NAME_KEYS = ['title', 'name', 'productName', 'product_name'];
const ID_KEYS = ['id', 'productId', 'product_id', 'itemId', 'item_id', 'sku'];
const URL_KEYS = ['url', 'link', 'productUrl', 'productURL', 'product_url', 'productLink', 'product_link'];
const IDENTITY_KEYS = new Set([...NAME_KEYS, ...ID_KEYS, ...URL_KEYS]);

function safeKey(key: string): void {
  if (key.includes('\0')) throw new Error('Product keys cannot contain NUL');
  if (key === 'prototype' || Object.hasOwn(Object.prototype, key)) throw new Error('Unsafe product prototype key');
}
function nonempty(value: unknown): value is string { return typeof value === 'string' && !!value.trim(); }
function product(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Each product must be a JSON object');
  const entry = value as Record<string, unknown>;
  const pending: unknown[] = [entry];
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === 'string' && current.includes('\0')) throw new Error('Product values cannot contain NUL');
    if (typeof current === 'number' && (!Number.isFinite(current) || (Number.isInteger(current) && !Number.isSafeInteger(current)))) throw new Error('Product number is not representable safely; quote large integer IDs/prices');
    if (current && typeof current === 'object') {
      for (const [key, item] of Object.entries(current)) { safeKey(key); pending.push(item); }
    }
  }
  const hasName = NAME_KEYS.some(key => Object.hasOwn(entry, key) && nonempty(entry[key]));
  const hasId = ID_KEYS.some(key => Object.hasOwn(entry, key) && (nonempty(entry[key]) || (typeof entry[key] === 'number' && Number.isFinite(entry[key]))));
  const hasUrl = URL_KEYS.some(key => {
    if (!Object.hasOwn(entry, key) || !nonempty(entry[key])) return false;
    try { const url = new URL(entry[key]); return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password; }
    catch { return false; }
  });
  if (!hasName && !hasId && !hasUrl) throw new Error('Product identity requires a supplied name/title, product URL or product ID');
  let encoded: string;
  try { encoded = JSON.stringify(entry); } catch { throw new Error('Product nesting cannot be serialized'); }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_PRODUCT_BYTES) throw new Error('Product exceeds the 32 KiB size limit');
  return entry;
}

function csvProducts(source: string): Array<Record<string, unknown>> {
  const products: Array<Record<string, unknown>> = [];
  const headerKeys = new Set<string>();
  let headers: string[] | undefined;
  let row: string[] = [], cell = '', state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  let active = false, rowChars = 0;
  const append = (value: string) => {
    rowChars += value.length;
    if (rowChars > MAX_PRODUCT_BYTES) throw new Error('CSV product/header exceeds the 32 KiB size limit');
    cell += value;
  };
  const finishCell = () => {
    if (!headers) {
      const key = cell.trim();
      if (!key) throw new Error('CSV header names must be non-empty');
      safeKey(key);
      if (headerKeys.has(key)) throw new Error('Duplicate CSV header');
      headerKeys.add(key); row.push(key);
    } else {
      if (row.length >= headers.length) throw new Error('CSV row has more fields than the header');
      row.push(cell);
    }
    cell = ''; state = 'start';
  };
  const finishRow = () => {
    if (!active && !row.length && !cell) return;
    finishCell();
    if (!headers) {
      if (!row.some(key => IDENTITY_KEYS.has(key))) throw new Error('CSV requires a header with a product identity column');
      headers = row;
    } else {
      if (row.length !== headers.length) throw new Error('CSV row field count does not match its header');
      if (products.length >= MAX_PRODUCTS) throw new Error('Product batch exceeds 1000 products');
      products.push(product(Object.fromEntries(headers.map((key, index) => [key, row[index]]))));
    }
    row = []; cell = ''; state = 'start'; active = false; rowChars = 0;
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (state === 'quoted') {
      if (char === '"') {
        if (source[i + 1] === '"') { append('"'); i++; }
        else state = 'closed';
      } else append(char);
    } else if (char === ',') { active = true; finishCell(); }
    else if (char === '\r' || char === '\n') { finishRow(); if (char === '\r' && source[i + 1] === '\n') i++; }
    else if (state === 'closed') throw new Error('Invalid CSV character after closing quote');
    else if (char === '"') {
      if (state !== 'start') throw new Error('Invalid CSV quote in an unquoted field');
      state = 'quoted'; active = true;
    } else { append(char); state = 'plain'; active = true; }
  }
  if (state === 'quoted') throw new Error('Unterminated CSV quoted field');
  finishRow();
  if (!headers || !products.length) throw new Error('CSV requires a header and at least one product row');
  return products;
}

/** Aff fields follow app.js afProductHtml/afProduct and shopee_grab.js page/get_pc envelopes;
 * affstudio.pyc AffStudio.update_product (line 1017) retains title/description/price/photos.
 * Batch CSV is the approved P4 extension, not a recovered original CSV export contract.
 * CSV headers are trimmed; cell strings and structured JSON values/keys remain unchanged.
 * The 32 KiB/product bound measures UTF-8 JSON serialization; source includes any leading BOM.
 * No URL is fetched and no claims, normalized prices or provenance are added.
 */
export function parseProducts(input: string, format: 'csv' | 'json'): Array<Record<string, unknown>> {
  if (typeof input !== 'string') throw new Error('Product import source must be a string');
  if (format !== 'csv' && format !== 'json') throw new Error('Unsupported product import format');
  if (Buffer.byteLength(input, 'utf8') > MAX_SOURCE_BYTES) throw new Error('Product import source exceeds 8 MiB');
  if (input.includes('\0')) throw new Error('Product import source cannot contain NUL');
  const source = input.startsWith('\uFEFF') ? input.slice(1) : input;
  if (format === 'csv') return csvProducts(source);
  let decoded: unknown;
  try { decoded = JSON.parse(source) as unknown; } catch { throw new Error('Invalid product JSON source'); }
  const entries = Array.isArray(decoded) ? decoded : [decoded];
  if (!entries.length || entries.length > MAX_PRODUCTS) throw new Error('Product batch must contain 1-1000 products');
  return entries.map(product);
}
