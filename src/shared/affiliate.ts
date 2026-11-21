export const AFFILIATE_STYLES = [
  { id: 'review', vi: 'Review tính năng', en: 'Feature review', hintVi: 'Giới thiệu, thao tác và chứng minh 2–3 tính năng có thật.', hintEn: 'Introduce and demonstrate two or three verified features.' },
  { id: 'story', vi: 'Kể chuyện bán hàng', en: 'Everyday story', hintVi: 'Tình huống đời thường dẫn tới sản phẩm và cách giải quyết.', hintEn: 'An everyday situation leads naturally to a product and resolution.' },
  { id: 'problem', vi: 'Vấn đề → Giải pháp', en: 'Problem → Solution', hintVi: 'Nỗi khó chịu, sản phẩm, cách dùng và kết quả có thể quan sát.', hintEn: 'Show a frustration, the product, its use and an observable result.' },
  { id: 'unbox', vi: 'Cận cảnh · đập hộp', en: 'Unboxing', hintVi: 'Mở hộp theo thứ tự, xem chất liệu rồi dùng thử.', hintEn: 'Open the package in order, inspect the material, then demonstrate use.' },
  { id: 'howto', vi: 'Hướng dẫn dùng', en: 'How to use', hintVi: 'Chuẩn bị và làm từng bước theo thông tin shop cung cấp.', hintEn: 'Prepare and follow ordered steps supported by the shop information.' },
  { id: 'top3', vi: '3 lý do nên mua', en: 'Three reasons', hintVi: 'Ba lý do riêng biệt có bằng chứng từ thông tin sản phẩm.', hintEn: 'Three distinct reasons grounded in the supplied product facts.' },
  { id: 'fashion', vi: 'Thời trang · nhảy', en: 'Fashion dance', hintVi: 'Người mẫu mặc đúng sản phẩm, chuyển động và xoay khoe chi tiết.', hintEn: 'A model wears the actual product, moves to the beat and reveals details.' },
  { id: 'snack', vi: 'Review ăn vặt dí dỏm', en: 'Playful snack review', hintVi: 'Bóc gói, bẻ và cận chi tiết; hài hước nhưng không bịa trải nghiệm.', hintEn: 'Open, break and inspect a snack with playful delivery and no invented experience.' },
  { id: 'lookbook', vi: 'Thời trang · thay đồ', en: 'Outfit lookbook', hintVi: '1–4 mẫu: cầm trên móc, chuyển sang mặc rồi quay chi tiết.', hintEn: 'One to four outfits: hanger reveal, wearing reveal, then detail.' },
  { id: 'asmr', vi: 'Đập hộp ASMR · không lời', en: 'Silent ASMR unboxing', hintVi: 'Chỉ tay thao tác theo thứ tự, tiếng thật và một caption xuyên suốt.', hintEn: 'Ordered hands-only actions, realistic foley and one persistent caption.' },
  { id: 'pov', vi: 'POV · caption + nhạc', en: 'POV with caption and music', hintVi: 'Góc nhìn thứ nhất dùng sản phẩm, một caption và cắt theo nhịp.', hintEn: 'First-person product use with one caption and cuts on the beat.' },
] as const;
export const AFFILIATE_HOSTS = [
  { id: 'presenter', vi: 'Người dẫn', en: 'Presenter' }, { id: 'voiceover', vi: 'Giọng đọc', en: 'Voiceover' }, { id: 'silent', vi: 'Không lời', en: 'Silent' },
] as const;
export const AFFILIATE_HOOKS = [
  { id: 'auto', vi: 'Tự chọn', en: 'Automatic' }, { id: 'problem', vi: 'Nêu vấn đề', en: 'Problem' }, { id: 'curiosity', vi: 'Gây tò mò', en: 'Curiosity' },
  { id: 'result', vi: 'Kết quả trước', en: 'Result first' }, { id: 'price', vi: 'Giá / ưu đãi', en: 'Price / offer' }, { id: 'demo', vi: 'Thao tác ngay', en: 'Immediate demo' },
] as const;
export const AFFILIATE_POSES = [
  { id: 'auto', vi: 'Tự chọn', en: 'Automatic' }, { id: 'stand', vi: 'Đứng', en: 'Standing' }, { id: 'sit', vi: 'Ngồi ghế', en: 'Seated' },
  { id: 'lie', vi: 'Nằm', en: 'Lying down' }, { id: 'floor', vi: 'Ngồi sàn', en: 'On the floor' }, { id: 'walk', vi: 'Đi bộ', en: 'Walking' },
] as const;
export const AFFILIATE_LANGUAGES = [
  { id: 'vi', vi: 'Tiếng Việt', en: 'Vietnamese' }, { id: 'en', vi: 'Tiếng Anh', en: 'English' }, { id: 'zh', vi: 'Tiếng Trung phổ thông', en: 'Mandarin Chinese' },
  { id: 'ja', vi: 'Tiếng Nhật', en: 'Japanese' }, { id: 'ko', vi: 'Tiếng Hàn', en: 'Korean' }, { id: 'th', vi: 'Tiếng Thái', en: 'Thai' },
  { id: 'id', vi: 'Tiếng Indonesia', en: 'Indonesian' }, { id: 'es', vi: 'Tiếng Tây Ban Nha', en: 'Spanish' }, { id: 'pt', vi: 'Tiếng Bồ Đào Nha – Brazil', en: 'Brazilian Portuguese' },
  { id: 'fr', vi: 'Tiếng Pháp', en: 'French' }, { id: 'de', vi: 'Tiếng Đức', en: 'German' }, { id: 'it', vi: 'Tiếng Ý', en: 'Italian' },
  { id: 'ru', vi: 'Tiếng Nga', en: 'Russian' }, { id: 'tr', vi: 'Tiếng Thổ Nhĩ Kỳ', en: 'Turkish' }, { id: 'hi', vi: 'Tiếng Hindi', en: 'Hindi' }, { id: 'ar', vi: 'Tiếng Ả Rập', en: 'Arabic' },
] as const;
export const AFFILIATE_LANGUAGES16 = AFFILIATE_LANGUAGES;
export const AFFILIATE_PACES = [{ id: 'fast', vi: 'Nhanh kiểu TikTok — cắt khoảng lặng', en: 'Fast — cut silences' }, { id: 'plain', vi: 'Gọn — giữ nguyên clip', en: 'Plain — keep clips whole' }] as const;
export const AFFILIATE_SPEECH_SPEEDS = [{ id: 1, vi: '1,0×', en: '1.0×' }, { id: 1.1, vi: '1,1× (khuyên dùng)', en: '1.1× (recommended)' }, { id: 1.2, vi: '1,2×', en: '1.2×' }] as const;
export const AFFILIATE_AGES = [{ id: 'young', vi: '20–25 tuổi', en: '20–25 years' }, { id: 'adult', vi: '26–35 tuổi', en: '26–35 years' }, { id: 'middle', vi: '36–50 tuổi', en: '36–50 years' }] as const;
export const AFFILIATE_GENDERS = [{ id: 'female', vi: 'Nữ', en: 'Female' }, { id: 'male', vi: 'Nam', en: 'Male' }] as const;
export const AFFILIATE_ACCENTS = [{ id: 'north', vi: 'Bắc (Hà Nội)', en: 'Northern (Hanoi)' }, { id: 'south', vi: 'Nam (Sài Gòn)', en: 'Southern (Saigon)' }, { id: 'central', vi: 'Trung (Huế)', en: 'Central (Hue)' }] as const;

export const MAX_AFFILIATE_REFERENCES = 15;
export interface AffiliateSettings {
  contentStyle: typeof AFFILIATE_STYLES[number]['id']; hostMode: typeof AFFILIATE_HOSTS[number]['id']; seconds: 15 | 30 | 45 | 60;
  hookStyle: typeof AFFILIATE_HOOKS[number]['id']; pose: typeof AFFILIATE_POSES[number]['id'];
  gender: typeof AFFILIATE_GENDERS[number]['id']; age: typeof AFFILIATE_AGES[number]['id']; accent: typeof AFFILIATE_ACCENTS[number]['id'];
  notes: string; caption: string; cta: string; affiliateUrl: string;
  showPrice: boolean; screenText: boolean; aiLabel: boolean; adLabel: boolean; endCard: boolean;
  presenterAssetId: string; backgroundAssetId: string; outfitAssetIds: string[];
  pace: typeof AFFILIATE_PACES[number]['id']; speechSpeed: typeof AFFILIATE_SPEECH_SPEEDS[number]['id'];
}

function bounded(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || new TextEncoder().encode(value).length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(`Invalid Affiliate ${field}: limit ${max} UTF-8 bytes`);
  return value.trim();
}
function option<T extends string>(value: unknown, fallback: T, options: ReadonlyArray<{ id: T }>, field: string): T {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !options.some(item => item.id === value)) throw new Error(`Invalid Affiliate ${field}`);
  return value as T;
}
function asset(value: unknown, field: string): string {
  const id = bounded(value === undefined ? '' : value, field, 100);
  if (id && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) throw new Error(`Invalid Affiliate ${field}`);
  return id;
}
function affiliateUrl(value: unknown): string {
  const source = bounded(value === undefined ? '' : value, 'URL', 2048); if (!source) return '';
  let url: URL; try { url = new URL(source); } catch { throw new Error('Affiliate URL must be public HTTPS'); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  // Only public DNS names are accepted; the browser-safe settings reader cannot resolve IP ranges.
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !host.includes('.') || /[:\[\]]/.test(host) || /^[\d.]+$/.test(host)
    || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)$/.test(host)
    || !host.split('.').every(part => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(part))) throw new Error('Affiliate URL must use a public HTTPS hostname without credentials or a custom port');
  return url.href;
}

export function readAffiliateSettings(value?: unknown): AffiliateSettings {
  const raw = value === undefined ? {} : value;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new Error('Invalid Affiliate configuration');
  const input = raw as Record<string, unknown>;
  const allowed = new Set(['contentStyle', 'hostMode', 'seconds', 'hookStyle', 'pose', 'gender', 'age', 'accent', 'notes', 'caption', 'cta', 'affiliateUrl', 'showPrice', 'screenText', 'aiLabel', 'adLabel', 'endCard', 'presenterAssetId', 'backgroundAssetId', 'outfitAssetIds', 'pace', 'speechSpeed']);
  if (Reflect.ownKeys(input).some(key => typeof key !== 'string' || !allowed.has(key))) throw new Error('Invalid Affiliate configuration key or prototype key');
  const seconds = input.seconds === undefined ? 30 : input.seconds;
  if (typeof seconds !== 'number' || ![15, 30, 45, 60].includes(seconds)) throw new Error('Invalid Affiliate seconds: expected 15, 30, 45 or 60');
  const speechSpeed = input.speechSpeed === undefined ? 1.1 : input.speechSpeed;
  if (!AFFILIATE_SPEECH_SPEEDS.some(item => item.id === speechSpeed)) throw new Error('Invalid Affiliate speechSpeed: expected 1, 1.1 or 1.2');
  const boolean = (field: string): boolean => { if (input[field] === undefined) return true; if (typeof input[field] !== 'boolean') throw new Error(`Invalid Affiliate ${field}`); return input[field]; };
  const outfits = input.outfitAssetIds === undefined ? [] : input.outfitAssetIds;
  if (!Array.isArray(outfits) || outfits.length > 4) throw new Error('Invalid Affiliate outfitAssetIds: limit 4');
  const outfitAssetIds = [...new Set(Array.from(outfits, value => { const id = asset(value, 'outfitAssetIds'); if (!id) throw new Error('Invalid Affiliate outfitAssetIds'); return id; }))];
  return {
    contentStyle: option(input.contentStyle, 'review', AFFILIATE_STYLES, 'contentStyle'), hostMode: option(input.hostMode, 'presenter', AFFILIATE_HOSTS, 'hostMode'), seconds: seconds as AffiliateSettings['seconds'],
    hookStyle: option(input.hookStyle, 'auto', AFFILIATE_HOOKS, 'hookStyle'), pose: option(input.pose, 'auto', AFFILIATE_POSES, 'pose'),
    gender: option(input.gender, 'female', AFFILIATE_GENDERS, 'gender'), age: option(input.age, 'adult', AFFILIATE_AGES, 'age'), accent: option(input.accent, 'north', AFFILIATE_ACCENTS, 'accent'),
    notes: bounded(input.notes === undefined ? '' : input.notes, 'notes', 4000), caption: bounded(input.caption === undefined ? '' : input.caption, 'caption', 512),
    cta: bounded(input.cta === undefined ? 'Xem chi tiết sản phẩm tại liên kết bên dưới.' : input.cta, 'cta', 512), affiliateUrl: affiliateUrl(input.affiliateUrl),
    showPrice: boolean('showPrice'), screenText: boolean('screenText'), aiLabel: boolean('aiLabel'), adLabel: boolean('adLabel'), endCard: boolean('endCard'),
    presenterAssetId: asset(input.presenterAssetId, 'presenterAssetId'), backgroundAssetId: asset(input.backgroundAssetId, 'backgroundAssetId'), outfitAssetIds,
    pace: option(input.pace, 'fast', AFFILIATE_PACES, 'pace'), speechSpeed: speechSpeed as AffiliateSettings['speechSpeed'],
  };
}

export function affiliateSceneCount(settings: AffiliateSettings): number {
  if (settings.contentStyle === 'lookbook') return Math.max(4, Math.min(16, Math.round(settings.seconds / 2.4)));
  if (['asmr', 'pov'].includes(settings.contentStyle)) return Math.max(5, Math.min(16, Math.round(settings.seconds / 1.9)));
  return Math.max(3, Math.min(16, Math.round(settings.seconds / 3.4)));
}
export const AFFILIATE_BEATS = ['hook', 'problem', 'intro', 'benefit', 'demo', 'proof', 'offer', 'cta'] as const;
export const AFFILIATE_LOOK_BEATS = ['intro', 'hanger', 'wear', 'detail', 'final'] as const;
export function affiliateTemplateGroup(contentStyle: AffiliateSettings['contentStyle']): 'talk' | 'fashion' | 'lookbook' | undefined {
  return contentStyle === 'fashion' || contentStyle === 'lookbook' ? contentStyle : contentStyle === 'asmr' || contentStyle === 'pov' ? undefined : 'talk';
}
// The single test for "this project uses the Muse v2 flow": a stale marker on asmr/pov never counts.
export function affiliateV2(project: { kind: string; data: Record<string, unknown> }): boolean {
  return project.kind === 'affiliate' && project.data.affiliate !== undefined && project.data.affiliatePlanVersion === 2 && affiliateTemplateGroup(readAffiliateSettings(project.data.affiliate).contentStyle) !== undefined;
}
export function affiliateMode(settings: AffiliateSettings): { model: boolean; spoken: boolean; handsOnly: boolean; nativeAudio: boolean } {
  const asmr = settings.contentStyle === 'asmr';
  const model = !asmr && (['fashion', 'lookbook'].includes(settings.contentStyle) || settings.hostMode === 'presenter');
  const spoken = !asmr && settings.hostMode !== 'silent';
  return { model, spoken, handsOnly: asmr || settings.contentStyle === 'pov' && !model, nativeAudio: spoken || asmr };
}
