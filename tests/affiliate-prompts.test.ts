import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AffiliateCamera, AffiliatePromptContext, AffiliatePromptShot, AffiliateTemplateGroup } from '../src/core/affiliate-prompts';

const api = () => require('../src/core/affiliate-prompts') as {
  cleanMotion(motion: string): string;
  affiliateCamera(group: AffiliateTemplateGroup, shot: Pick<AffiliatePromptShot, 'index' | 'kind' | 'beat' | 'line'>): AffiliateCamera;
  affiliateHostRefPrompt(context: AffiliatePromptContext): string;
  affiliateImagePrompt(context: AffiliatePromptContext, shot: AffiliatePromptShot): string;
  affiliateClipPrompt(context: AffiliatePromptContext, shot: AffiliatePromptShot): string;
};
interface Case { name: string; kind: 'image' | 'clip' | 'hostRef'; context: AffiliatePromptContext; shot?: AffiliatePromptShot; expected: string }
const cases = JSON.parse(readFileSync(join(__dirname, '../../tests/fixtures/muse-affiliate-prompts.json'), 'utf8')) as Case[];

const context = (patch: Partial<AffiliatePromptContext> = {}): AffiliatePromptContext => ({
  group: 'talk', hostMode: 'presenter', ratio: '9:16', language: 'vi', accent: 'north', style: 'Real people', place: 'A kitchen',
  productTitle: 'Mug', productLook: 'White ceramic mug', host: { name: 'Minh', look: 'Young man', voice: 'Warm voice' }, ...patch,
});
const shot = (patch: Partial<AffiliatePromptShot> = {}): AffiliatePromptShot => ({
  index: 3, kind: 'presenter', beat: '', scene: 'Vertical 9:16 waist-up shot.', motion: 'Holds the mug up.', line: 'Cốc này rất đẹp.', emotion: 'Warm',
  productVisible: true, camera: 'locked', hasProductPhotos: false, ...patch,
});
const render = (kind: Case['kind'], ctx: AffiliatePromptContext, s: AffiliatePromptShot) =>
  kind === 'hostRef' ? api().affiliateHostRefPrompt(ctx) : kind === 'image' ? api().affiliateImagePrompt(ctx, s) : api().affiliateClipPrompt(ctx, s);

test('reproduces Muse prompts line by line', () => {
  assert.ok(cases.length >= 90);
  for (const item of cases) {
    const actual = render(item.kind, item.context, item.shot as AffiliatePromptShot);
    assert.equal(actual, item.expected, item.name);
  }
});

test('cleanMotion follows the observed rule', () => {
  const clean = api().cleanMotion;
  assert.equal(clean('Raises the shoe slightly toward camera, then turns it to show the rounded toe.'), 'then turns it to show the rounded toe.');
  assert.equal(clean('Taps the thick sole once with his palm while keeping eye contact.'), 'Taps the thick sole once with his palm, keeping eye contact.');
  assert.equal(clean('Spins lightly with arms open, smiling as the shirt moves freely.'), 'Spins lightly with arms open, smiling, the shirt moves freely.');
  assert.equal(clean('Presents the shoe steadily to camera and gives a small inviting nod.'), '');
  assert.equal(clean('Takes three small steps toward the camera, pointing lightly to his collar.'), '');
});

test('camera-only motion uses fallbacks', () => {
  const outputs = [
    api().affiliateImagePrompt(context(), shot({ motion: 'Waves at the camera.' })),
    api().affiliateClipPrompt(context(), shot({ motion: 'Waves at the camera.' })),
    api().affiliateClipPrompt(context(), shot({ kind: 'product', motion: 'Waves at the camera.' })),
    api().affiliateClipPrompt(context({ group: 'fashion' }), shot({ motion: 'Waves at the camera.', line: '' })),
    api().affiliateClipPrompt(context({ group: 'lookbook', outfitLooks: [{ name: 'Set', description: 'Blue.' }] }), shot({ beat: 'wear', motion: 'Waves at the camera.', line: '' })),
  ];
  assert.ok(!outputs[0].includes('Action to prepare in this FIRST FRAME'));
  assert.ok(outputs[1].includes("action: preserve the scene's meaningful posture and expression. Keep the planned"));
  assert.ok(outputs[2].includes("Action: preserve the scene's meaningful pose and object detail. Anyone visible"));
  assert.ok(outputs[3].includes('beat: sway and bounce to the beat. Small rhythmic moves'));
  assert.ok(!outputs[4].includes('Planned moment'));
  for (const output of outputs) assert.ok(!/undefined|  |: \./.test(output), output);
});

test('line with quotes stays one quoted span', () => {
  const line = 'He said "wow"\nnow';
  for (const prompt of [api().affiliateImagePrompt(context(), shot({ line })), api().affiliateClipPrompt(context(), shot({ line }))])
    assert.ok(prompt.includes('"He said ”wow” now"'), prompt);
});

test('extrapolated wording', () => {
  const ratios = { '9:16': 'Vertical 9:16', '16:9': 'Horizontal 16:9', '1:1': 'Square 1:1', '3:4': 'Vertical 3:4', '4:3': 'Horizontal 4:3' } as const;
  for (const [ratio, word] of Object.entries(ratios)) {
    assert.ok(api().affiliateImagePrompt(context({ ratio: ratio as keyof typeof ratios }), shot()).startsWith(`${word} frame from a short`), ratio);
    assert.ok(api().affiliateClipPrompt(context({ ratio: ratio as keyof typeof ratios }), shot()).includes(`10-second ${word.toLowerCase()} video`), ratio);
  }
  const english = api().affiliateClipPrompt(context({ language: 'en' }), shot());
  assert.ok(english.includes('in English'));
  assert.ok(!/Vietnamese|accent/.test(english));
  assert.ok(api().affiliateClipPrompt(context({ language: 'fr' }), shot()).includes('in fr,'));
  assert.ok(api().affiliateClipPrompt(context({ accent: 'south' }), shot()).includes('standard Southern Vietnamese (Sài Gòn) accent'));
  assert.ok(api().affiliateClipPrompt(context({ accent: 'central' }), shot()).includes('standard Central Vietnamese (Huế) accent'));
  const silent = api().affiliateClipPrompt(context({ hostMode: 'silent' }), shot());
  assert.ok(silent.includes('Nobody speaks.') && !silent.includes('says this exact line'));
  const narrator = api().affiliateClipPrompt(context({ host: undefined, hostMode: 'voiceover', narratorVoice: 'Deep calm voice' }), shot({ kind: 'product' }));
  assert.ok(narrator.includes('the same off-screen narrator voice (narrator_v1): Deep calm voice. The same voice in every clip of this video.'));
  const look = { outfitLooks: [{ name: 'Blue set', description: 'Blue top and skirt.' }] };
  const withPhotos = api().affiliateImagePrompt(context({ group: 'lookbook', ...look }), shot({ beat: 'wear', hasProductPhotos: true }));
  assert.ok(withPhotos.includes('must look EXACTLY like the garment(s)') && !withPhotos.includes('Show it realistically'));
  assert.ok(api().affiliateImagePrompt(context({ group: 'lookbook', ...look }), shot({ beat: 'wear' })).includes('LOOK 1 — Blue set: Blue top and skirt.. '));
  assert.ok(api().affiliateImagePrompt(context({ group: 'lookbook', ...look }), shot({ beat: 'wear', outfitIndex: 0 })).includes('LOOK 1 —'));
});

test('affiliateCamera applies the rotation', () => {
  const camera = api().affiliateCamera;
  const base = { index: 0, kind: 'product' as const, beat: '', line: '' };
  assert.equal(camera('talk', { ...base, kind: 'presenter', line: 'x' }), 'locked');
  assert.equal(camera('fashion', { ...base, kind: 'presenter' }), 'locked');
  assert.equal(camera('lookbook', { ...base, kind: 'presenter', beat: 'wear' }), 'locked');
  for (const beat of ['hanger', 'final', 'intro']) assert.equal(camera('lookbook', { ...base, beat }), 'push');
  assert.equal(camera('lookbook', { ...base, beat: 'detail' }), 'arc');
  assert.equal(camera('talk', { ...base, index: 2 }), 'arc');
  assert.equal(camera('talk', { ...base, index: 3 }), 'push');
  assert.equal(camera('fashion', { ...base, index: 4 }), 'arc');
  assert.equal(camera('fashion', { ...base, index: 5 }), 'push');
});

test('speech window is capped at 9 seconds', () => {
  const line = Array.from({ length: 30 }, (_, index) => `chữ${index}`).join(' ');
  for (const kind of ['presenter', 'product'] as const) {
    const clip = api().affiliateClipPrompt(context(), shot({ kind, line, camera: kind === 'presenter' ? 'locked' : 'arc' }));
    assert.match(clip, /0\.5–9 s:/);
    if (kind === 'presenter') assert.match(clip, /\n9–10 s:/);
    for (const [, start, end] of clip.matchAll(/(\d+(?:\.\d+)?)–(\d+(?:\.\d+)?) s/g)) assert.ok(Number(start) <= Number(end), `${start}–${end}`);
  }
  assert.match(api().affiliateClipPrompt(context(), shot({ line: 'Cốc này rất đẹp.' })), /0\.5–3 s:/, 'short lines keep the observed formula');
});

test('silent presenter shot keeps identity instead of the product template', () => {
  const clip = api().affiliateClipPrompt(context(), shot({ line: '', motion: 'Holds the mug up.' }));
  assert.match(clip, /IDENTITY LOCK/); assert.match(clip, /Nobody speaks\./); assert.match(clip, /Camera: LOCKED-OFF/); assert.match(clip, /Action: Holds the mug up\./);
  assert.ok(!clip.includes('Keep faces outside the frame')); assert.ok(!clip.includes('says this exact line'));
  const absent = api().affiliateClipPrompt(context(), shot({ line: '', motion: 'Takes a few steps toward the camera.', productVisible: false }));
  assert.match(absent, /The product is absent from this shot; do not add it\./); assert.match(absent, /Action: preserve the scene's meaningful posture and expression\./);
});
