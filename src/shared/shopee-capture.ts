// Self-contained so the same product-only reader runs in a user bookmark and browser tests.
export async function captureShopeeProduct(): Promise<Record<string, unknown>> {
  if (location.protocol !== 'https:' || !['shopee.vn', 'www.shopee.vn'].includes(location.hostname)) throw new Error('Mở trang chi tiết sản phẩm Shopee Việt Nam trước khi lấy dữ liệu.');
  const ids = /^\/(?:universal-link\/)?product\/(\d+)\/(\d+)\/?$/.exec(location.pathname) || /-i\.(\d+)\.(\d+)\/?$/.exec(location.pathname);
  if (!ids) throw new Error('Trang hiện tại chưa phải trang chi tiết sản phẩm.');
  const url = 'https://shopee.vn/product/' + ids[1] + '/' + ids[2], capturedAt = new Date().toISOString();
  const pick = (value: Record<string, unknown> | undefined, keys: string[]) => Object.fromEntries(keys.filter(key => value && Object.hasOwn(value, key)).map(key => [key, value![key]]));
  const resources = performance.getEntriesByType('resource').map(entry => entry.name).reverse();
  const cached = resources.find(value => { try { const entry = new URL(value); return entry.origin === location.origin && entry.pathname === '/api/v4/pdp/get_pc' && entry.searchParams.get('item_id') === ids[2]; } catch { return false; } });
  if (cached) {
    try {
      const response = await fetch(cached, { cache: 'only-if-cached', mode: 'same-origin', credentials: 'include', signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        const data = (await response.json()).data;
        if (data?.item && String(data.item.item_id) === ids[2] && String(data.item.shop_id) === ids[1]) {
          const item = pick(data.item, ['item_id', 'shop_id', 'title', 'image', 'brand', 'currency', 'description', 'price', 'price_min', 'price_max', 'item_rating']);
          item.attributes = (data.item.attributes || []).map((value: Record<string, unknown>) => pick(value, ['name', 'value']));
          item.models = (data.item.models || []).map((value: Record<string, unknown>) => pick(value, ['name', 'price', 'image']));
          item.tier_variations = (data.item.tier_variations || []).map((value: Record<string, unknown>) => pick(value, ['name', 'options']));
          return { _: 'maistudio-shopee', v: 1, kind: 'get_pc', url, capturedAt, data: { item, product_images: pick(data.product_images, ['images']), product_price: pick(data.product_price, ['price']), product_review: pick(data.product_review, ['rating_star', 'total_rating_count', 'historical_sold', 'global_sold']), shop_detailed: pick(data.shop_detailed, ['name']) } };
        }
      }
    } catch { /* Cache-only miss must not turn into a new authenticated product request. */ }
  }
  const products: Record<string, any>[] = [];
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const pending = [JSON.parse(script.textContent || '')];
      while (pending.length) {
        const value = pending.pop(); if (!value || typeof value !== 'object') continue;
        if (Array.isArray(value)) { pending.push(...value); continue; }
        if (value['@graph']) pending.push(value['@graph']);
        if ([value['@type']].flat().includes('Product')) products.push(value);
      }
    } catch { /* Invalid unrelated structured data does not invalidate visible product data. */ }
  }
  const heading = document.querySelector('h1')?.textContent?.trim() || '';
  const matches = (product: Record<string, any>) => {
    try {
      const value = new URL(product.url, location.href);
      const identity = /^\/product\/(\d+)\/(\d+)\/?$/.exec(value.pathname) || /-i\.(\d+)\.(\d+)\/?$/.exec(value.pathname);
      return ['shopee.vn', 'www.shopee.vn'].includes(value.hostname) && identity?.[1] === ids[1] && identity?.[2] === ids[2];
    } catch { return false; }
  };
  const structured = products.find(matches) || products.find(product => !product.url && product.name === heading) || (products.length === 1 && !products[0].url ? products[0] : undefined);
  const title = heading || structured?.name || '';
  if (!title || /^(?:đăng nhập|đăng ký|log ?in|sign ?in|access denied|shopee)$/i.test(title)) throw new Error('Chưa thấy sản phẩm. Đăng nhập Shopee và mở trang sản phẩm đã tải đầy đủ rồi bấm lại.');
  const offer = Array.isArray(structured?.offers) ? structured?.offers[0] : structured?.offers;
  const priceElement = document.querySelector('[data-testid="product-price"], [itemprop="price"], .product-price, [class*="product-price"]');
  let visiblePrice = '';
  for (let node = document.querySelector('h1')?.parentElement, depth = 0; node && depth < 6 && !['BODY', 'HTML'].includes(node.tagName); node = node.parentElement, depth++) {
    const text = node.innerText.slice(0, 16000), start = text.indexOf(heading);
    const details = text.slice(Math.max(0, start + heading.length)).split(/MÔ TẢ SẢN PHẨM|ĐÁNH GIÁ SẢN PHẨM|SẢN PHẨM TƯƠNG TỰ/i)[0];
    visiblePrice = details.match(/(?:₫\s*\d[\d.,]*|\d[\d.,]*\s*₫)(?:\s*[–-]\s*(?:₫\s*\d[\d.,]*|\d[\d.,]*\s*₫))?/)?.[0] || '';
    if (visiblePrice) break;
  }
  const price = offer?.price !== undefined ? String(offer.price) + (offer.priceCurrency === 'VND' ? '₫' : offer.priceCurrency ? ' ' + offer.priceCurrency : '') : priceElement?.getAttribute('content') || priceElement?.textContent?.trim() || visiblePrice;
  let description = structured?.description || document.querySelector('[itemprop="description"], [data-testid="product-description"], #product-description, .product-description')?.textContent?.trim() || '';
  if (!description) {
    const body = document.body.innerText, start = body.search(/MÔ TẢ SẢN PHẨM/i);
    if (start >= 0) description = body.slice(start).replace(/^MÔ TẢ SẢN PHẨM\s*/i, '').split(/ĐÁNH GIÁ SẢN PHẨM|SẢN PHẨM TƯƠNG TỰ/i)[0].trim();
  }
  const suppliedImages = [structured?.image].flat().filter(Boolean).map(value => typeof value === 'string' ? value : value.url).filter(Boolean);
  const gallery = document.querySelector('[data-testid="product-gallery"], .product-images, [class*="product-image"], [class*="image-carousel"]');
  const candidates = suppliedImages.length ? suppliedImages : Array.from((gallery || document.querySelector('main') || document).querySelectorAll('img')).map(image => image.currentSrc || image.getAttribute('src') || '');
  const images = [...new Set(candidates.filter(value => { try { const image = new URL(value, location.href); return image.protocol === 'https:' && /^(?:(?:down|down-zl)-vn\.img\.susercontent\.com|cf\.shopee\.vn)$/.test(image.hostname) && image.pathname.startsWith('/file/'); } catch { return false; } }))].slice(0, 16);
  if (!images.length) throw new Error('Chưa thấy ảnh sản phẩm. Mở phần ảnh chính và đợi ảnh tải xong rồi bấm lại.');
  const attributes = Array.isArray(structured?.additionalProperty) ? structured.additionalProperty.filter((value: any) => typeof value.name === 'string' && value.value !== undefined).map((value: any) => ({ name: value.name, value: String(value.value) })) : [];
  return { _: 'maistudio-shopee', v: 1, kind: 'page', url, capturedAt, title, price, description, images, attributes };
}

export function shopeeBookmarklet(): string {
  const run = `(${captureShopeeProduct.toString()})().then(async data=>{const text=JSON.stringify(data);if(new TextEncoder().encode(text).length>8388608)throw Error('Dữ liệu sản phẩm quá lớn');let copied=false;try{await navigator.clipboard.writeText(text);copied=true}catch{}const old=document.getElementById('mai-studio-product-capture');if(old)old.remove();const box=document.createElement('section');box.id='mai-studio-product-capture';box.style.cssText='position:fixed;right:16px;top:16px;z-index:2147483647;width:min(420px,90vw);padding:16px;background:#191d2a;color:#edf0f8;font:14px/1.5 Arial;border-radius:12px;box-shadow:0 8px 32px #0008';const title=document.createElement('strong');title.textContent='MaiStudio — dữ liệu sản phẩm';const note=document.createElement('p');note.textContent=copied?'Đã chép. Quay lại MaiStudio, dán dữ liệu rồi bấm Nhập sản phẩm.':'Chọn nội dung bên dưới và sao chép, rồi dán vào MaiStudio.';const field=document.createElement('textarea');field.readOnly=true;field.value=text;field.style.cssText='width:100%;height:100px';field.onclick=()=>field.select();const close=document.createElement('button');close.type='button';close.textContent='Đóng';close.onclick=()=>box.remove();box.append(title,note,field,close);document.body.appendChild(box);if(!copied)field.select()}).catch(error=>alert('MaiStudio: '+error.message))`;
  return 'javascript:' + encodeURIComponent(run);
}
