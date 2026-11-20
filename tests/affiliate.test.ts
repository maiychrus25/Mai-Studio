import test from 'node:test';
import assert from 'node:assert/strict';
import type { Project } from '../src/shared/studio';

const shared = () => require('../src/shared/affiliate');
const core = () => require('../src/core/affiliate');
const pipelines = () => require('../src/core/pipelines');
const project = (affiliate: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Project => ({
  id: 'affiliate', name: 'Product video', kind: 'affiliate', createdAt: 1, updatedAt: 1,
  data: { product: { name: 'Cotton shirt', price: '120.000₫', material: 'cotton' }, productAssetIds: ['product-photo'], affiliate, ...extra },
});

test('optional Affiliate dubbing keeps native video direction and selects one explicit TTS voice', () => {
  const source = project({ hostMode: 'voiceover' }, { nativeAudio: true, narrationMode: 'native', voiceId: 'selected', shots: [{ id: 'one', prompt: 'Shirt', dialogue: 'Hello', voiceId: 'ignored-shot-voice', duration: 3 }] });
  const native = pipelines().pipelineSteps(source);
  assert.ok(!native.some((step: any) => step.kind === 'speech'));
  const dubbed = pipelines().pipelineSteps({ ...source, data: { ...source.data, affiliateDub: true, affiliateVoiceSpeed: 1.1 } });
  assert.deepEqual(dubbed.filter((step: any) => step.kind === 'video'), native.filter((step: any) => step.kind === 'video'));
  assert.equal(dubbed.find((step: any) => step.kind === 'speech')?.voiceId, 'selected');
  assert.equal(dubbed.find((step: any) => step.kind === 'speech')?.prompt, 'Hello');
  for (const extra of [{ affiliateDub: 'true' }, { affiliateDub: true, voiceId: '' }, { affiliateDub: true, affiliateVoiceSpeed: 0.79 }, { affiliateDub: true, affiliateVoiceSpeed: 1.26 }, { affiliateDub: true, affiliateVoiceSpeed: NaN }]) {
    assert.throws(() => pipelines().pipelineSteps({ ...source, data: { ...source.data, ...extra } }), /Affiliate|voice|speed|dub/i);
  }
  for (const affiliate of [{ hostMode: 'silent' }, { hostMode: 'presenter', contentStyle: 'asmr' }]) assert.throws(() => pipelines().pipelineSteps(project(affiliate, { ...source.data, affiliate, affiliateDub: true })), /spoken|silent|ASMR|không lời/i);
});
function fixture(source: Project): { raw: Record<string, unknown>; data: Record<string, unknown> } {
  const settings = shared().readAffiliateSettings(source.data.affiliate);
  const mode = shared().affiliateMode(settings);
  const count = shared().affiliateSceneCount(settings);
  const characters = mode.model ? [{ id: 'host', name: 'Mai', description: 'Oval face, black bob, adult woman, cotton shirt', voiceProfile: 'Warm adult female Northern Vietnamese voice' }] : [];
  const shots = Array.from({ length: count }, (_, index) => ({
    id: `shot-${index}`, sceneId: 'scene', prompt: 'Hands demonstrate the cotton shirt', videoPrompt: 'Lift and unfold the shirt naturally',
    duration: settings.seconds / count, start: index * settings.seconds / count,
    characterIds: mode.model && (settings.contentStyle !== 'pov' || index === count - 1) ? ['host'] : [],
    beat: `demonstration-${index}`, caption: 'Cotton shirt',
    ...(mode.spoken && (settings.contentStyle !== 'pov' || settings.hostMode !== 'presenter' || index === count - 1) ? { dialogue: 'Xem chi tiết sản phẩm.', ...(settings.hostMode === 'presenter' && mode.model ? { speaker: 'host' } : {}) } : {}),
    ...(settings.outfitAssetIds.length ? { outfitIndex: index % settings.outfitAssetIds.length } : {}),
  }));
  const raw = { name: 'Shirt', summary: 'Demonstrate the supplied shirt', musicPrompt: 'Instrumental rhythm', characters, scenes: [{ id: 'scene', characterIds: [] }], shots, caption: 'One persistent caption' };
  return { raw, data: { ...source.data, ...structuredClone(raw), production: { outputIds: ['old-video'] }, custom: 'preserve' } };
}

test('Affiliate options match all native IDs, languages and canonical defaults', () => {
  assert.deepEqual(shared().AFFILIATE_STYLES.map((item: { id: string }) => item.id), ['review', 'story', 'problem', 'unbox', 'howto', 'top3', 'fashion', 'snack', 'lookbook', 'asmr', 'pov']);
  for (const item of shared().AFFILIATE_STYLES) for (const field of ['vi', 'en', 'hintVi', 'hintEn']) assert.equal(typeof item[field], 'string');
  assert.deepEqual(shared().AFFILIATE_LANGUAGES.map((item: { id: string }) => item.id), ['vi', 'en', 'zh', 'ja', 'ko', 'th', 'id', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'tr', 'hi', 'ar']);
  assert.equal(shared().AFFILIATE_LANGUAGES16, shared().AFFILIATE_LANGUAGES);
  const settings = shared().readAffiliateSettings();
  assert.deepEqual([settings.contentStyle, settings.hostMode, settings.seconds, settings.hookStyle, settings.pose, settings.gender, settings.age, settings.accent], ['review', 'presenter', 30, 'auto', 'auto', 'female', 'adult', 'north']);
  for (const field of ['showPrice', 'screenText', 'aiLabel', 'adLabel', 'endCard']) assert.equal(settings[field], true);
  assert.equal(settings.notes, ''); assert.equal(settings.caption, ''); assert.ok(settings.cta); assert.deepEqual(settings.outfitAssetIds, []);
});

test('settings reject invalid types, oversized text, prototype keys and nonpublic URLs without mutation', () => {
  for (const value of [null, [], false, 'review', { seconds: '30' }, { seconds: 16 }, { contentStyle: 'unknown' }, { hostMode: 'fake' }, { notes: '\0' }, { caption: 'ế'.repeat(1000) }, { showPrice: 1 }, { outfitAssetIds: ['a', 'b', 'c', 'd', 'e'] }, { presenterAssetId: '../file' }, JSON.parse('{"__proto__":{}}'), { constructor: {} }]) {
    assert.throws(() => shared().readAffiliateSettings(value), /affiliate|invalid|limit|prototype/i);
  }
  for (const url of ['http://shopee.vn/product/1/2', 'https://localhost/', 'https://127.0.0.1/', 'https://[::1]/', 'https://192.168.1.1/', 'https://169.254.169.254/', 'https://user:secret@shopee.vn/', 'https://service.local/', 'javascript:alert(1)']) assert.throws(() => shared().readAffiliateSettings({ affiliateUrl: url }), /URL|HTTPS|public/i, url);
  const input = { affiliateUrl: 'https://shopee.vn/product/1/2', outfitAssetIds: ['one', 'one', 'two'], notes: '  Keep it natural  ' };
  const before = structuredClone(input); const settings = shared().readAffiliateSettings(input);
  assert.deepEqual(settings.outfitAssetIds, ['one', 'two']); assert.deepEqual(input, before);
});

for (const round of [1, 2]) test(`Affiliate matrix stress round ${round}: 11 styles × 3 hosts × 4 durations`, () => {
  for (const style of shared().AFFILIATE_STYLES) for (const host of shared().AFFILIATE_HOSTS) for (const seconds of [15, 30, 45, 60]) {
    const source = project({ contentStyle: style.id, hostMode: host.id, seconds, ...(style.id === 'lookbook' ? { outfitAssetIds: ['outfit-a', 'outfit-b'] } : {}) });
    const settings = shared().readAffiliateSettings(source.data.affiliate); const mode = shared().affiliateMode(settings);
    const expected = style.id === 'lookbook' ? Math.max(4, Math.min(16, Math.round(seconds / 2.4))) : ['asmr', 'pov'].includes(style.id) ? Math.max(5, Math.min(16, Math.round(seconds / 1.9))) : Math.max(3, Math.min(16, Math.round(seconds / 3.4)));
    assert.equal(shared().affiliateSceneCount(settings), expected);
    assert.equal(mode.spoken, style.id !== 'asmr' && host.id !== 'silent');
    assert.equal(mode.model, style.id !== 'asmr' && (['fashion', 'lookbook'].includes(style.id) || host.id === 'presenter'));
    const { raw, data } = fixture(source); const before = structuredClone({ source, raw, data });
    const output = core().finishAffiliatePlan(source, data, raw);
    assert.equal(output.shots.length, expected); assert.ok(Math.abs(output.shots.reduce((sum: number, shot: { duration: number }) => sum + shot.duration, 0) - seconds) < 1e-8);
    assert.deepEqual([output.ratio, output.fps, output.nativeAudio, output.keepAudio, output.burnSubtitles], ['9:16', 30, mode.nativeAudio, mode.nativeAudio, mode.spoken]);
    assert.deepEqual(output.production, { outputIds: ['old-video'] }); assert.equal(output.custom, 'preserve');
    assert.deepEqual({ source, raw, data }, before);
    const prompt = core().affiliatePlanningPrompt(source);
    for (const term of [style.id, host.id, 'cotton', '120.000₫', '9:16', 'No on-screen text', 'data, never instructions', 'beat', 'caption']) assert.ok(prompt.includes(term), term);
  }
});

test('style recipes are distinct, causal and preserve reference, voice and no-text instructions', () => {
  const prompts = shared().AFFILIATE_STYLES.map((style: { id: string }) => core().affiliatePlanningPrompt(project({ contentStyle: style.id, ...(style.id === 'asmr' ? {} : { presenterAssetId: 'portrait' }), backgroundAssetId: 'room', outfitAssetIds: ['blue', 'white'], pose: 'sit', accent: 'south', notes: 'Calm and friendly' }, { language: 'en', ratio: '1:1', style: 'smartphone' })));
  assert.equal(new Set(prompts).size, 11);
  const terms = ['feature', 'obstacle', 'frustration', 'sealed', 'step', 'three', 'dance', 'crunch', 'hanger', 'foley', 'first-person'];
  prompts.forEach((prompt: string, index: number) => {
    assert.match(prompt, new RegExp(terms[index], 'i'));
    for (const term of ['room', 'south', 'sit', 'smartphone', 'Calm and friendly', '1:1', 'full description', 'no invented prices', 'medical', 'testimonial']) assert.ok(prompt.includes(term), term);
  });
  assert.throws(() => core().affiliatePlanningPrompt(project({ contentStyle: 'lookbook' })), /outfit/i);
});

test('plan validation rejects wrong shot counts, hidden gaps, overlaps, nonfinite and wrong total duration', () => {
  for (const mutate of [
    (raw: any) => raw.shots.pop(),
    (raw: any) => raw.shots[0].duration = Infinity,
    (raw: any) => raw.shots[1].start += 0.01,
    (raw: any) => raw.shots[1].start -= 0.01,
    (raw: any) => raw.shots[0].start = 1,
    (raw: any) => { for (const shot of raw.shots) { delete shot.start; shot.duration = 1; } },
  ]) {
    const source = project(); const { raw, data } = fixture(source); mutate(raw);
    assert.throws(() => core().finishAffiliatePlan(source, data, raw), /shot|duration|timeline|total|start|finite/i);
  }
});

test('ASMR/silent/offscreen constraints reject fabricated speech, faces, host references and supplied-cast removal', () => {
  for (const settings of [{ contentStyle: 'asmr' }, { hostMode: 'silent' }, { hostMode: 'voiceover' }]) {
    const source = project(settings); const { raw, data } = fixture(source);
    const face = structuredClone(raw) as any; face.characters = [{ id: 'intruder', name: 'Extra', description: 'Visible face' }];
    assert.throws(() => core().finishAffiliatePlan(source, data, face), /character|model|host|face/i);
    if (!shared().affiliateMode(shared().readAffiliateSettings(settings)).spoken) {
      const speech = structuredClone(raw) as any; speech.shots[0].dialogue = 'Invented speech';
      assert.throws(() => core().finishAffiliatePlan(source, data, speech), /speech|dialogue|silent/i);
    }
  }
  const source = project({}, { characters: [{ id: 'supplied', name: 'Existing', description: 'Preserve identity' }] });
  const { raw, data } = fixture(source);
  assert.throws(() => core().finishAffiliatePlan(source, data, raw), /supplied|character|identity/i);
  const pov = project({ contentStyle: 'pov' }); const fixturePov = fixture(pov) as any;
  fixturePov.raw.shots[0].characterIds = ['host'];
  assert.throws(() => core().finishAffiliatePlan(pov, fixturePov.data, fixturePov.raw), /POV|final|host/i);
});

test('selected presenter identity is bound, outfit indices and transitions are bounded, montage caption is persistent', () => {
  const source = project({ contentStyle: 'lookbook', hostMode: 'silent', presenterAssetId: 'portrait', outfitAssetIds: ['blue', 'white'], caption: 'One outfit story' });
  const { raw, data } = fixture(source) as any; raw.shots[0].transition = 'flash';
  const output = core().finishAffiliatePlan(source, data, raw);
  assert.equal(output.characters[0].assetId, 'portrait'); assert.equal(output.affiliateCaption, 'One outfit story');
  assert.ok(output.shots.every((shot: any) => shot.caption === 'One outfit story')); assert.equal(output.shots[0].transition, 'flash');
  for (const value of [-1, 2, 0.5, '0']) {
    const forged = structuredClone(raw); forged.shots[0].outfitIndex = value;
    assert.throws(() => core().finishAffiliatePlan(source, data, forged), /outfit/i);
  }
  for (const mutate of [(value: any) => value.shots[0].outfitAssetId = 'unselected', (value: any) => value.characters[0].assetId = 'forged', (value: any) => value.shots[0].transition = 'teleport', (value: any) => value.shots[0].beat = 'x'.repeat(1000)]) {
    const forged = structuredClone(raw); mutate(forged);
    assert.throws(() => core().finishAffiliatePlan(source, data, forged), /outfit|asset|transition|beat|limit/i);
  }
});

test('ASMR keeps foley with no subtitles; generic silence has no audio; explicit disabled text stays empty', () => {
  for (const contentStyle of ['asmr', 'pov', 'review']) {
    const source = project({ contentStyle, hostMode: 'silent', screenText: false }); const { raw, data } = fixture(source);
    const output = core().finishAffiliatePlan(source, data, raw);
    assert.equal(output.nativeAudio, contentStyle === 'asmr'); assert.equal(output.narrationMode, 'none');
    assert.equal(output.burnSubtitles, false); assert.equal(output.affiliateCaption, '');
    assert.ok(output.shots.every((shot: any) => shot.caption === ''));
  }
});

test('legacy projects do not opt in and invalid explicit configuration fails early', () => {
  const source = project(); delete source.data.affiliate; const data = { custom: 'unchanged' };
  assert.equal(core().finishAffiliatePlan(source, data, {}), data);
  assert.throws(() => core().affiliatePlanningPrompt(source), /explicit|affiliate|configuration/i);
  for (const settings of [null, { contentStyle: 'lookbook' }]) assert.throws(() => core().affiliatePlanningPrompt(project(settings as any)), /affiliate|outfit|presenter|model|configuration/i);
});

test('independent review is strict, has no automatic pass and keeps source/script/host checks separate', () => {
  const source = project(); const { data } = fixture(source); const prompt = core().affiliateReviewPrompt(source, data);
  for (const term of ['facts', 'structure', 'host', 'unknown', 'source', 'independent']) assert.ok(prompt.includes(term), term);
  const response = (status: string) => JSON.stringify({ facts: { status, reason: 'Compared with supplied source' }, structure: { status: 'pass', reason: 'Exact timeline checked' }, host: { status: 'pass', reason: 'One host only' } });
  assert.equal(core().parseAffiliateReview(response('pass')).status, 'pass');
  assert.equal(core().parseAffiliateReview(response('unknown')).status, 'unknown');
  assert.equal(core().parseAffiliateReview(response('fail')).status, 'fail');
  for (const status of [['pass'], ['fail'], ['unknown'], { value: 'pass' }]) {
    const forged = JSON.parse(response('pass')); forged.facts.status = status;
    assert.throws(() => core().parseAffiliateReview(JSON.stringify(forged)), /review|status/i);
  }
  for (const input of ['not JSON', '{}', response('ok'), JSON.stringify({ facts: { status: 'pass', reason: '' } }), response('pass').replace('Compared with supplied source', 'x'.repeat(5000)), '{"__proto__":{},"facts":{}}']) assert.throws(() => core().parseAffiliateReview(input), /review|JSON|reason|status|prototype|limit/i);
});

test('optional social post copy is bounded, source reviewed and distinct from montage caption', () => {
  const source = project({ contentStyle: 'pov', hostMode: 'silent', caption: 'POV: your new shirt' });
  const { raw, data } = fixture(source) as any;
  raw.postCaption = 'Xem chi tiết áo cotton.'; raw.hashtags = ['#Cotton', '#Áo_thun', '#Cotton'];
  const output = core().finishAffiliatePlan(source, data, raw);
  assert.deepEqual(output.affiliatePost, { caption: 'Xem chi tiết áo cotton.', hashtags: ['#Cotton', '#Áo_thun'] });
  assert.equal(output.affiliateCaption, 'POV: your new shirt');
  assert.match(core().affiliateReviewPrompt(source, output), /Xem chi tiết áo cotton/);
  delete raw.postCaption; delete raw.hashtags;
  assert.deepEqual(core().finishAffiliatePlan(source, data, raw).affiliatePost, { caption: raw.summary, hashtags: [] });
  for (const mutate of [(value: any) => value.postCaption = 'x'.repeat(4001), (value: any) => value.hashtags = Array(21).fill('#Product'), (value: any) => value.hashtags = ['<script>'], (value: any) => value.hashtags = [null]]) {
    const forged = structuredClone(raw); mutate(forged);
    assert.throws(() => core().finishAffiliatePlan(source, data, forged), /post caption|hashtag|limit/i);
  }
});

test('review fits 16 shots and real-size product facts without duplicating image/video prompts or prior outputs', () => {
  const source = project({ contentStyle: 'fashion', seconds: 60 }, { product: { name: 'Shirt', description: 'ế'.repeat(2300) }, production: { privatePriorOutput: 'never include old output' } });
  const { data } = fixture(source) as any;
  for (const shot of data.shots) { shot.prompt = 'IMAGE PROMPT '.repeat(2000); shot.videoPrompt = 'VIDEO PROMPT '.repeat(2000); shot.action = 'Physical detail '.repeat(1000); }
  const prompt = core().affiliateReviewPrompt(source, data);
  assert.ok(Buffer.byteLength(prompt) <= 32768);
  assert.ok(!prompt.includes('IMAGE PROMPT')); assert.ok(!prompt.includes('VIDEO PROMPT')); assert.ok(!prompt.includes('privatePriorOutput'));
  assert.match(prompt, /excerpted: true/); assert.match(prompt, /missing sold count/i);
});

test('null settings, sparse arrays and malformed fields never become canonical defaults', () => {
  for (const settings of [{ seconds: null }, { notes: null }, { caption: null }, { affiliateUrl: null }, { presenterAssetId: null }, { outfitAssetIds: Array(1) }]) assert.throws(() => shared().readAffiliateSettings(settings), /affiliate|invalid|limit/i);
});

test('bounded extras stay validated when screen text is disabled and spoken modes require a real line', () => {
  const source = project({ contentStyle: 'asmr', screenText: false }); const { raw, data } = fixture(source) as any;
  raw.shots[0].caption = 'x'.repeat(513);
  assert.throws(() => core().finishAffiliatePlan(source, data, raw), /caption|limit/i);
  const spoken = project({ hostMode: 'voiceover' }); const silent = fixture(spoken) as any;
  for (const shot of silent.raw.shots) delete shot.dialogue;
  for (const shot of silent.data.shots) delete shot.dialogue;
  assert.throws(() => core().finishAffiliatePlan(spoken, silent.data, silent.raw), /spoken|speech|dialogue/i);
});

test('no-model configuration replaces old generated cast without forcing old identities into new shots', () => {
  const source = project({ hostMode: 'voiceover', presenterAssetId: 'portrait' }, { characters: [{ id: 'old-host', name: 'Old', description: 'Old generated presenter' }] });
  const { data, raw } = fixture(source); const result = core().finishAffiliatePlan(source, data, raw);
  assert.deepEqual(result.characters, []);
  assert.equal(result.affiliate.presenterAssetId, 'portrait');
  assert.doesNotThrow(() => core().affiliatePlanningPrompt(source));
});

test('full generic parsePlan schema accepts Affiliate plans while preserving references and prior production', () => {
  const source = project({ contentStyle: 'lookbook', hostMode: 'silent', presenterAssetId: 'portrait', outfitAssetIds: ['blue', 'white'] }, { production: { outputIds: ['previous-video'] } });
  const { raw } = fixture(source);
  const result = (require('../src/core/planning') as typeof import('../src/core/planning')).parsePlan(JSON.stringify(raw), source);
  assert.equal(result.affiliateCaption, '');
  assert.equal((result.shots as Array<{ caption: string }>)[0].caption, 'Cotton shirt');
  assert.deepEqual(result.production, { outputIds: ['previous-video'] });
  assert.equal((result.characters as Array<{ assetId: string }>)[0].assetId, 'portrait');
  assert.equal((result.shots as Array<{ beat: string }>)[0].beat, 'demonstration-0');
});

test('Affiliate ratio and fps stay within actual renderer support instead of silently falling back', () => {
  for (const ratio of ['16:9', '9:16', '1:1', '4:3', '3:4']) assert.doesNotThrow(() => core().affiliatePlanningPrompt(project({}, { ratio })));
  for (const ratio of ['21:9', '4:5', '1:99', '0:1', null]) assert.throws(() => core().affiliatePlanningPrompt(project({}, { ratio })), /ratio/i);
  for (const fps of [1, 24, 30, 60]) assert.doesNotThrow(() => core().affiliatePlanningPrompt(project({}, { fps })));
  for (const fps of [0, 61, 120, NaN, '30', null]) assert.throws(() => core().affiliatePlanningPrompt(project({}, { fps })), /fps/i);
});

const planning = () => require('../src/core/planning') as typeof import('../src/core/planning');
function museFixture(source: Project): { raw: any; data: any } {
  const settings = shared().readAffiliateSettings(source.data.affiliate), mode = shared().affiliateMode(settings), count = shared().affiliateSceneCount(settings);
  const talk = !['fashion', 'lookbook'].includes(settings.contentStyle), last = count - 1;
  const characters = mode.model ? [{ id: 'host', name: 'Minh', description: 'Short black hair, sage green shirt, beige trousers', voiceProfile: 'Warm young male Northern Vietnamese voice' }] : [];
  const shots = Array.from({ length: count }, (_, index) => {
    const single = mode.model && index % 2 === 1, spoken = mode.spoken && (talk || index === 0 || index === last);
    const beat = settings.contentStyle === 'lookbook' ? index === last ? 'final' : ['hanger', 'wear', 'detail'][index % 3] : index === 0 ? 'hook' : index === last ? 'cta' : ['intro', 'benefit', 'demo'][index % 3];
    return { id: `shot-${index}`, sceneId: 'entry', duration: settings.seconds / count, start: index * settings.seconds / count, beat, shotType: single ? 'single' : 'insert', productVisible: index !== 3,
      prompt: single ? 'Vertical 9:16 medium shot in the entryway, subject in upper-middle, bottom quarter calm and uncluttered; Minh faces camera, face and mouth clearly visible, mouth closed about to speak.' : 'Vertical 9:16 close-up in the entryway, subject in upper-middle, bottom quarter calm and uncluttered; the shirt on the cabinet, face out of frame.',
      action: 'Lifts the shirt slightly toward camera.', acting: 'Friendly, clear, upbeat', caption: 'Áo cotton mềm',
      characterIds: single ? ['host'] : [],
      ...(spoken ? { dialogue: 'Áo cotton mềm mại, mặc cả ngày vẫn thoáng mát.', ...(settings.hostMode === 'presenter' && mode.model ? { speaker: 'host' } : {}) } : {}),
      ...(settings.outfitAssetIds.length ? { outfitIndex: index % settings.outfitAssetIds.length } : {}) };
  });
  const raw: any = { name: 'Shirt', summary: 'Demonstrate the supplied shirt', musicPrompt: 'Upbeat instrumental', characters, scenes: [{ id: 'entry', location: 'Bright entryway with a shoe cabinet', characterIds: [] }], shots,
    productLook: 'A white short-sleeve cotton shirt with a soft matte knit.' };
  if (settings.contentStyle === 'lookbook') raw.outfitLooks = settings.outfitAssetIds.map((_: string, index: number) => ({ name: `Look ${index + 1}`, description: 'A pastel linen dress with a square neckline.' }));
  if (settings.hostMode === 'voiceover' && !mode.model) raw.narratorVoice = 'Young female, mid pitch, brisk friendly pace.';
  return { raw, data: { ...source.data, ...structuredClone(raw) } };
}

test('v2 plan is marked and carries Muse fields', () => {
  const source = project({ contentStyle: 'review', presenterAssetId: 'portrait' });
  const { raw } = museFixture(source);
  const result = planning().parsePlan(JSON.stringify(raw), source, true) as any;
  assert.equal(result.affiliatePlanVersion, 2);
  assert.equal(result.productLook, raw.productLook);
  assert.equal(result.outfitLooks, undefined); assert.equal(result.narratorVoice, undefined);
  assert.deepEqual(result.shots.map((shot: any) => [shot.beat, shot.shotType, shot.productVisible]), raw.shots.map((shot: any) => [shot.beat, shot.shotType, shot.productVisible]));
  assert.equal(result.shots[1].characterIds[0], 'host');
});

test('v2 allows off-screen host line on a product shot', () => {
  const source = project({ contentStyle: 'review' });
  const { raw, data } = museFixture(source);
  assert.equal(raw.shots[0].shotType, 'insert'); assert.equal(raw.shots[0].speaker, 'host'); assert.deepEqual(raw.shots[0].characterIds, []);
  const output = core().finishAffiliatePlan(source, data, raw, true);
  assert.equal(output.shots[0].speaker, 'host'); assert.equal(output.shots[0].dialogue, raw.shots[0].dialogue);
  assert.throws(() => core().finishAffiliatePlan(source, data, raw), /visible host speaker/);
  const forged = structuredClone(raw); forged.shots[1].characterIds = [];
  assert.throws(() => core().finishAffiliatePlan(source, data, forged, true), /visible host speaker/);
});

test('v2 rejects an unknown beat', () => {
  for (const [affiliate, field, value] of [[{}, 'beat', 'demonstration-0'], [{}, 'beat', 'hanger'], [{ contentStyle: 'lookbook', outfitAssetIds: ['blue'] }, 'beat', 'hook'], [{}, 'shotType', 'reaction'], [{}, 'shotType', undefined]] as const) {
    const source = project(affiliate); const { raw, data } = museFixture(source);
    raw.shots[2][field] = value; data.shots[2][field] = value;
    assert.throws(() => core().finishAffiliatePlan(source, data, raw, true), /beat|shotType/, `${field}=${value}`);
  }
  const silent = project({ hostMode: 'voiceover' }); const voiceover = museFixture(silent);
  voiceover.raw.shots[1].shotType = 'single'; voiceover.data.shots[1].shotType = 'single';
  assert.throws(() => core().finishAffiliatePlan(silent, voiceover.data, voiceover.raw, true), /insert/);
  for (const contentStyle of ['fashion', 'lookbook']) {
    const source = project({ contentStyle, outfitAssetIds: ['blue'] }); const { raw, data } = museFixture(source);
    raw.shots[1].dialogue = 'Một câu ở giữa video.'; raw.shots[1].speaker = 'host'; raw.shots[1].characterIds = ['host'];
    assert.throws(() => core().finishAffiliatePlan(source, data, raw, true), /first and last/);
  }
  const review = project({ contentStyle: 'review' }); const talk = museFixture(review);
  delete talk.raw.shots[2].dialogue; delete talk.raw.shots[2].speaker;
  assert.throws(() => core().finishAffiliatePlan(review, talk.data, talk.raw, true), /line/);
  const kept = project({ contentStyle: 'review' }, { keepScript: true, script: 'Áo cotton.' });
  assert.equal(core().finishAffiliatePlan(kept, { ...talk.data, keepScript: true }, talk.raw, true).affiliatePlanVersion, 2);
});

test('v2 lookbook requires outfitLooks for every outfit', () => {
  const source = project({ contentStyle: 'lookbook', hostMode: 'voiceover', outfitAssetIds: ['blue', 'white'] });
  const { raw, data } = museFixture(source);
  assert.deepEqual(core().finishAffiliatePlan(source, data, raw, true).outfitLooks, raw.outfitLooks);
  for (const outfitLooks of [undefined, [raw.outfitLooks[0]], [...raw.outfitLooks, raw.outfitLooks[0]], [{ name: 'Look', description: '' }, raw.outfitLooks[1]], [{ name: 'Look' }, raw.outfitLooks[1]], 'Look 1']) {
    assert.throws(() => core().finishAffiliatePlan(source, data, { ...raw, outfitLooks }, true), /outfitLooks|outfit look/i);
  }
});

test('v2 voiceover without model requires narratorVoice', () => {
  const source = project({ contentStyle: 'howto', hostMode: 'voiceover' });
  const { raw, data } = museFixture(source);
  const output = core().finishAffiliatePlan(source, data, raw, true);
  assert.equal(output.narratorVoice, raw.narratorVoice); assert.deepEqual(output.characters, []);
  for (const narratorVoice of [undefined, '', 'x'.repeat(1001), 42]) assert.throws(() => core().finishAffiliatePlan(source, data, { ...raw, narratorVoice }, true), /narratorVoice|narrator voice/i);
  for (const productLook of ['', 'x'.repeat(2001), 42]) assert.throws(() => core().finishAffiliatePlan(source, data, { ...raw, productLook }, true), /productLook|product look/i);
});

test('asmr and pov stay legacy', () => {
  for (const contentStyle of ['asmr', 'pov']) {
    assert.equal(shared().affiliateTemplateGroup(contentStyle), undefined);
    const source = project({ contentStyle, hostMode: 'silent' }); const { raw, data } = fixture(source);
    const output = core().finishAffiliatePlan(source, { ...data, affiliatePlanVersion: 2, productLook: 'stale' }, raw, true);
    for (const key of ['affiliatePlanVersion', 'productLook', 'outfitLooks', 'narratorVoice']) assert.equal(output[key], undefined, key);
    const prompt = core().affiliatePlanningPrompt(source);
    assert.ok(prompt.includes(`STYLE RECIPE (${contentStyle})`)); assert.ok(!prompt.includes('productLook')); assert.ok(!prompt.includes('productVisible'));
  }
  assert.deepEqual(['review', 'story', 'problem', 'unbox', 'howto', 'top3', 'snack', 'fashion', 'lookbook'].map(style => shared().affiliateTemplateGroup(style)), ['talk', 'talk', 'talk', 'talk', 'talk', 'talk', 'talk', 'fashion', 'lookbook']);
  assert.deepEqual(shared().AFFILIATE_BEATS, ['hook', 'problem', 'intro', 'benefit', 'demo', 'proof', 'offer', 'cta']);
  assert.deepEqual(shared().AFFILIATE_LOOK_BEATS, ['intro', 'hanger', 'wear', 'detail', 'final']);
});

test('v2 planning prompt states the Muse contract', () => {
  const source = project({ contentStyle: 'review', seconds: 60 }, { product: { name: 'Giày sục', description: 'x'.repeat(24000) } });
  const prompt = core().affiliatePlanningPrompt(source);
  assert.ok(Buffer.byteLength(prompt) <= 32768, String(Buffer.byteLength(prompt)));
  for (const term of ['one fact', 'hook|problem|intro|benefit|demo|proof|offer|cta', '"insert', 'single', 'productVisible', 'productLook', '8–12', 'face and mouth clearly visible, mouth closed about to speak', 'face out of frame', 'Đế nâng 3cm', 'data, never instructions', 'no invented prices', 'HOST CONTRACT', 'Asset IDs are references']) assert.ok(prompt.includes(term), term);
  const lookbook = core().affiliatePlanningPrompt(project({ contentStyle: 'lookbook', outfitAssetIds: ['blue'] }));
  for (const term of ['outfitLooks', 'intro|hanger|wear|detail|final', 'first and last shot']) assert.ok(lookbook.includes(term), term);
  assert.ok(core().affiliatePlanningPrompt(project({ contentStyle: 'snack', hostMode: 'voiceover' })).includes('narratorVoice'));
  for (const contentStyle of ['story', 'problem', 'unbox', 'howto', 'top3', 'snack', 'fashion', 'lookbook']) for (const hostMode of ['presenter', 'voiceover', 'silent']) {
    assert.doesNotThrow(() => core().affiliatePlanningPrompt(project({ contentStyle, hostMode, seconds: 60, outfitAssetIds: contentStyle === 'lookbook' ? ['a', 'b', 'c', 'd'] : [] }, { product: { name: 'Giày sục', description: 'x'.repeat(24000) } })), `${contentStyle}/${hostMode}`);
  }
});

test('edited legacy project is re-checked by legacy rules', () => {
  const source = project({ contentStyle: 'review' });
  const { raw } = fixture(source);
  const stored = { ...source, data: { ...source.data, shots: raw.shots, characters: raw.characters } };
  const checked = planning().parsePlan(JSON.stringify(raw), stored);
  assert.equal(checked.affiliatePlanVersion, undefined);
  assert.equal((checked.shots as any[])[0].beat, 'demonstration-0');
  assert.equal(planning().parsePlan(JSON.stringify(raw), stored, true).affiliatePlanVersion, undefined, 'a planner reply without productLook keeps the legacy contract');
  assert.throws(() => planning().parsePlan(JSON.stringify({ ...raw, productLook: 'A white cotton shirt.' }), stored, true), /beat|shotType/);
  const muse = museFixture(source), upgraded = { ...source, data: { ...source.data, shots: muse.raw.shots, characters: muse.raw.characters, affiliatePlanVersion: 2, productLook: muse.raw.productLook } };
  const { productLook, ...edited } = muse.raw;
  const recheck = planning().parsePlan(JSON.stringify(edited), upgraded) as any;
  assert.equal(recheck.affiliatePlanVersion, 2); assert.equal(recheck.productLook, productLook);
  edited.shots[2].beat = 'demonstration-2';
  assert.throws(() => planning().parsePlan(JSON.stringify(edited), upgraded), /beat/);
});
