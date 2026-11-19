import { parseProducts } from './products';
import { object, text } from './store';

export const MAX_SHOPEE_IMAGES = 9;
export const MAX_SHOPEE_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_SHOPEE_CAPTURE_BYTES = 8 * 1024 * 1024;
const PRODUCT_HOSTS = ['shopee.vn', 'www.shopee.vn'];
const SHORT_HOSTS = ['s.shopee.vn', 'vn.shp.ee', 'shope.ee'];
type Request = (url: string, options?: RequestInit) => Promise<Response>;
export interface ShopeeLink { inputUrl: string; url: string; short: boolean; shopId?: string; itemId?: string }
export interface ShopeeCapture {
  product: Record<string, unknown>; images: string[];
  source: { method: 'page' | 'cached' | 'api'; url: string; shopId: string; itemId: string; capturedAt?: string; missingFields: string[]; warnings: string[] };
}

function sourceUrl(value: unknown): URL {
  const url = new URL(text(value, 'Shopee URL', 2048));
  if (url.protocol !== 'https:' || url.username || url.password || url.port || ![...PRODUCT_HOSTS, ...SHORT_HOSTS].includes(url.hostname)) throw new Error('Invalid Shopee URL; use a supported HTTPS Shopee Vietnam product link');
  return url;
}
export function shopeeLink(value: unknown): ShopeeLink {
  const url = sourceUrl(value);
  if (SHORT_HOSTS.includes(url.hostname)) {
    if (!/^\/[A-Za-z0-9_-]{1,128}\/?$/.test(url.pathname)) throw new Error('Invalid Shopee short link');
    return { inputUrl: url.href, url: url.href, short: true };
  }
  const ids = /^\/(?:universal-link\/)?product\/(\d+)\/(\d+)\/?$/.exec(url.pathname) || /-i\.(\d+)\.(\d+)\/?$/.exec(url.pathname);
  if (!ids || !ids.slice(1).every(id => Number.isSafeInteger(Number(id)) && Number(id) > 0)) throw new Error('Shopee product URL requires valid shop and item IDs');
  return { inputUrl: url.href, url: `https://shopee.vn/product/${ids[1]}/${ids[2]}`, shopId: ids[1], itemId: ids[2], short: false };
}
export async function resolveShopeeLink(value: unknown, signal?: AbortSignal, request: Request = fetch, redirects = 6): Promise<ShopeeLink> {
  signal?.throwIfAborted(); const original = shopeeLink(value); let current = original;
  for (let count = 0; current.short; count++) {
    if (count >= redirects) throw new Error('Shopee short link redirect limit reached; paste the full product URL from Chrome');
    const response = await request(current.url, { redirect: 'manual', credentials: 'omit', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    const location = response.headers.get('location'); await response.body?.cancel(); signal?.throwIfAborted();
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) throw new Error('Cannot resolve Shopee short link; open it in Chrome and paste the full product URL');
    current = shopeeLink(new URL(location, current.url).href);
  }
  return { ...current, inputUrl: original.inputUrl };
}

function numeric(value: unknown, max = Number.MAX_SAFE_INTEGER): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const number = typeof value === 'number' || typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < 0 || number > max) throw new Error('Invalid Shopee product numeric fact'); return number;
}
export function shopeeImageUrl(value: unknown): string {
  const source = text(value, 'Shopee image', 2048);
  const url = new URL(/^[A-Za-z0-9_-]{6,256}$/.test(source) ? 'https://down-vn.img.susercontent.com/file/' + source : source);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !/^(?:(?:down|down-zl)-vn\.img\.susercontent\.com|cf\.shopee\.vn)$/.test(url.hostname) || !/^\/file\/[A-Za-z0-9_@.=-]+$/.test(url.pathname)) throw new Error('Invalid Shopee product image URL');
  return url.href;
}
function captureResult(product: Record<string, unknown>, images: unknown, url: string, method: ShopeeCapture['source']['method'], capturedAt?: unknown): ShopeeCapture {
  const identity = shopeeLink(url); if (identity.short) throw new Error('Captured product requires a full Shopee URL');
  if (!Array.isArray(images) || images.length > 100) throw new Error('Invalid Shopee product images');
  const all = [...new Set(images.map(shopeeImageUrl))], selected = all.slice(0, MAX_SHOPEE_IMAGES);
  const normalized: Record<string, unknown> = { ...product, url: identity.url, shopId: identity.shopId, itemId: identity.itemId, source: 'shopee' };
  parseProducts(JSON.stringify(normalized), 'json');
  const missingFields = ['price', 'description', 'attributes', 'variations', 'rating', 'ratingCount', 'sold', 'shopName'].filter(key => { const value = normalized[key]; return value === undefined || value === '' || Array.isArray(value) && !value.length; });
  if (!selected.length) missingFields.push('images');
  let timestamp: string | undefined;
  if (capturedAt !== undefined) { timestamp = text(capturedAt, 'Product capture time', 64); if (!Number.isFinite(Date.parse(timestamp))) throw new Error('Invalid product capture time'); }
  return { product: normalized, images: selected, source: { method, url: identity.url, shopId: identity.shopId!, itemId: identity.itemId!, ...(timestamp ? { capturedAt: timestamp } : {}), missingFields,
    warnings: [...(all.length > selected.length ? [`Imported first ${selected.length} of ${all.length} supplied product images`] : []), ...(method === 'page' ? ['Visible-page capture: fields absent from the page remain unavailable; review the displayed price and images.'] : [])] } };
}
function sameProduct(captured: unknown, expected: string): string {
  const actual = shopeeLink(captured), wanted = shopeeLink(expected);
  if (actual.short || wanted.short || actual.shopId !== wanted.shopId || actual.itemId !== wanted.itemId) throw new Error('Shopee product identity does not match the requested link'); return actual.url;
}
function money(min: number | undefined, max: number | undefined): string {
  if (min === undefined && max === undefined) return '';
  const display = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 5 }) + '₫';
  return min !== undefined && max !== undefined && min !== max ? display(min) + ' – ' + display(max) : display(min ?? max!);
}
function entries(value: unknown, label: string, max = 200): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw new Error('Invalid Shopee ' + label + ' limit'); return value.map(object);
}
export function parseShopeeCapture(value: unknown, expected: string): ShopeeCapture {
  const source = text(value, 'Product capture JSON', MAX_SHOPEE_CAPTURE_BYTES); let decoded: Record<string, unknown>;
  try { decoded = object(JSON.parse(source)); } catch { throw new Error('Invalid product capture JSON object'); }
  const pending: unknown[] = [decoded];
  while (pending.length) { const item = pending.pop(); if (item && typeof item === 'object') for (const [key, part] of Object.entries(item)) { if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe product capture prototype key'); pending.push(part); } }
  if (!['maistudio-shopee', 'musestudio-shopee'].includes(String(decoded._)) || decoded.v !== 1) throw new Error('Unsupported product capture envelope');
  const url = sameProduct(decoded.url, expected);
  if (decoded.kind === 'page') {
    const name = text(decoded.title, 'Shopee product title', 2000);
    const product: Record<string, unknown> = { name, title: name, price: text(decoded.price ?? '', 'Product price', 256, true), description: text(decoded.description ?? '', 'Product description', 24000, true) };
    for (const key of ['attributes', 'variations']) if (decoded[key] !== undefined) product[key] = entries(decoded[key], key);
    return captureResult(product, decoded.images ?? [], url, 'page', decoded.capturedAt);
  }
  if (decoded.kind !== 'get_pc') throw new Error('Unsupported product capture kind');
  const data = object(decoded.data), item = object(data.item);
  const identity = shopeeLink(url);
  if (String(item.item_id) !== identity.itemId || String(item.shop_id) !== identity.shopId) throw new Error('Cached product identity does not match the requested link');
  const prices = object(object(data.product_price ?? {}).price ?? {}), reviews = object(data.product_review ?? {}), shop = object(data.shop_detailed ?? {});
  const units = (value: unknown) => {
    // Shopee uses -1 for an unavailable cached price, not a negative selling price.
    if (value === -1 || value === '-1') return undefined;
    const amount = numeric(value); if (amount !== undefined && !Number.isSafeInteger(amount)) throw new Error('Invalid cached product price units');
    return amount === undefined ? undefined : amount / 100000;
  };
  const priceMin = units(prices.range_min) ?? units(prices.single_value) ?? units(item.price_min) ?? units(item.price);
  const priceMax = units(prices.range_max) ?? units(prices.single_value) ?? units(item.price_max) ?? units(item.price);
  const name = text(item.title, 'Shopee product title', 2000);
  const product: Record<string, unknown> = { name, title: name, description: text(item.description ?? '', 'Product description', 24000, true), price: money(priceMin, priceMax),
    ...(priceMin === undefined ? {} : { priceMin }), ...(priceMax === undefined ? {} : { priceMax }),
    attributes: entries(item.attributes, 'attributes').map(attribute => ({ name: text(attribute.name, 'Attribute name', 256), value: text(typeof attribute.value === 'string' ? attribute.value : JSON.stringify(attribute.value), 'Attribute value', 2000, true) })),
    variations: entries(item.models, 'variations').map(model => ({ name: text(model.name, 'Variation name', 512), ...(model.price === undefined ? {} : { price: units(model.price) }), ...(model.image ? { image: shopeeImageUrl(model.image) } : {}) })) };
  if (item.tier_variations !== undefined) product.variationGroups = entries(item.tier_variations, 'variation groups', 4).map(group => {
    if (!Array.isArray(group.options) || group.options.length > 200) throw new Error('Invalid Shopee variation options');
    return { name: text(group.name, 'Variation group', 256), options: group.options.map(option => text(option, 'Variation option', 512)) };
  });
  for (const [key, value] of [['rating', reviews.rating_star ?? object(item.item_rating ?? {}).rating_star], ['ratingCount', reviews.total_rating_count], ['sold', reviews.historical_sold ?? reviews.global_sold]] as const) {
    const amount = numeric(value, key === 'rating' ? 5 : Number.MAX_SAFE_INTEGER); if (amount !== undefined) product[key] = amount;
  }
  for (const [key, value] of [['brand', item.brand], ['currency', item.currency], ['shopName', shop.name]] as const) if (typeof value === 'string' && value.trim()) product[key] = text(value, key, 512);
  const images = object(data.product_images ?? {}).images ?? (item.image ? [item.image] : []);
  return captureResult(product, images, url, 'cached', decoded.capturedAt);
}
export function shopeeOffer(value: unknown, expected: string): ShopeeCapture {
  const offer = object(value), identity = shopeeLink(expected);
  if (String(offer.itemId) !== identity.itemId || String(offer.shopId) !== identity.shopId) throw new Error('Shopee API product identity does not match the requested link');
  const priceMin = numeric(offer.priceMin ?? offer.price), priceMax = numeric(offer.priceMax ?? offer.price), name = text(offer.productName, 'Shopee product name', 2000);
  const product: Record<string, unknown> = { name, title: name, price: money(priceMin, priceMax), ...(priceMin === undefined ? {} : { priceMin }), ...(priceMax === undefined ? {} : { priceMax }) };
  for (const [key, value] of [['rating', offer.ratingStar], ['sold', offer.sales]] as const) { const amount = numeric(value, key === 'rating' ? 5 : Number.MAX_SAFE_INTEGER); if (amount !== undefined) product[key] = amount; }
  if (typeof offer.shopName === 'string' && offer.shopName.trim()) product.shopName = text(offer.shopName, 'Shop name', 512);
  return captureResult(product, offer.imageUrl ? [offer.imageUrl] : [], identity.url, 'api');
}

export async function downloadShopeeImage(value: unknown, signal: AbortSignal, request: Request = fetch): Promise<{ buffer: Buffer; extension: string }> {
  signal.throwIfAborted(); let url = shopeeImageUrl(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await request(url, { redirect: 'manual', credentials: 'omit', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location || redirects === 3) throw new Error('Shopee image redirect limit'); url = shopeeImageUrl(new URL(location, url).href); continue;
    }
    if (!response.ok || !response.body) throw new Error('Shopee image HTTP ' + response.status);
    const mime = response.headers.get('content-type')?.split(';')[0];
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime || '') || Number(response.headers.get('content-length') || 0) > MAX_SHOPEE_IMAGE_BYTES) { await response.body.cancel(); throw new Error('Invalid Shopee image MIME or byte limit'); }
    const reader = response.body.getReader(), chunks: Buffer[] = []; let bytes = 0;
    try { while (true) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > MAX_SHOPEE_IMAGE_BYTES) throw new Error('Shopee image exceeds byte limit'); chunks.push(Buffer.from(part.value)); } }
    finally { await reader.cancel().catch(() => {}); }
    const buffer = Buffer.concat(chunks), extension = buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' ? '.png' : buffer.subarray(0, 3).toString('hex') === 'ffd8ff' ? '.jpg' : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' ? '.webp' : '';
    if (!extension) throw new Error('Invalid Shopee image bytes'); signal.throwIfAborted(); return { buffer, extension };
  }
  throw new Error('Shopee image redirect limit');
}
