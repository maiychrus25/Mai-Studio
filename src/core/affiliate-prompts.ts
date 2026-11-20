export type AffiliateTemplateGroup = 'talk' | 'fashion' | 'lookbook';
export type AffiliateCamera = 'locked' | 'push' | 'arc';
export interface AffiliatePromptContext {
  group: AffiliateTemplateGroup;
  hostMode: 'presenter' | 'voiceover' | 'silent';
  ratio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
  language: string;
  accent: 'north' | 'south' | 'central';
  style: string;
  place: string;
  productTitle: string;
  productLook: string;
  host?: { name: string; look: string; voice: string };
  narratorVoice?: string;
  outfitLooks?: Array<{ name: string; description: string }>;
}
export interface AffiliatePromptShot {
  index: number;
  kind: 'product' | 'presenter';
  beat: string;
  scene: string;
  motion: string;
  line: string;
  emotion: string;
  productVisible: boolean;
  camera: AffiliateCamera;
  outfitIndex?: number;
  hasProductPhotos: boolean;
}

const RATIO_WORDS = { '9:16': 'Vertical 9:16', '16:9': 'Horizontal 16:9', '1:1': 'Square 1:1', '3:4': 'Vertical 3:4', '4:3': 'Horizontal 4:3' };
const LANGUAGE_NAMES: Record<string, string> = { vi: 'Vietnamese', en: 'English' };
const ACCENT_PHRASES = { north: 'standard Northern Vietnamese (Hà Nội) accent', south: 'standard Southern Vietnamese (Sài Gòn) accent', central: 'standard Central Vietnamese (Huế) accent' };
const CAMERA_LINES: Record<AffiliateCamera, (subject: string) => string> = {
  locked: () => 'Camera: LOCKED-OFF tripod shot — the camera does not move at all (no push-in, no zoom, no pan, no tilt); the framing stays exactly as in the first frame for the whole clip.',
  push: () => 'Camera: very subtle, very slow push-in — the camera glides forward only slightly, so the framing tightens by only about 10% over the whole clip; no other camera movement.',
  arc: subject => `Camera: slow arc shot — the camera travels smoothly about 30 degrees around the ${subject}, keeping the ${subject} centered, in focus and in the frame; the background slides sideways behind. No zoom.`,
};
const CLOSING = ['Bright, clean, believable natural lighting; realistic proportions; true-to-life colors.', 'Keep it tasteful and suitable for all audiences.'];
const NO_ADDED_TEXT = 'Do not add any captions, subtitles, price tags, stickers, watermarks or extra logos';
const PRODUCT_FRAMING = "Framing: follow the scene's product/hands/body detail, with no recognizable human face. If hands or body are shown, they belong to the same host with the same sleeves, outfit and skin tone; crop all faces out, no new person and no background people.";
const GARMENT_LOCK = 'it must look EXACTLY like the garment(s) in the attached product photo(s): same cut, length, fit, neckline, colors, fabric texture, pattern and details';
const OUTFIT_LOCK = 'wears exactly the same outfit for the whole clip — same garments, cut, length, fit, colors, pattern and details; no costume change, nothing added or removed.';
const VISUAL_MEANING = (scene: string) => `VISUAL MEANING: preserve this opening scene and the SAME place throughout: ${scene}. During the spoken line (if any), visibly develop the planned event, pose, reaction or object detail that expresses its meaning. Keep the first-frame identity, outfit, product appearance and lighting; do not introduce another person, scene, medical graphic or unsupported result.`;
const PRODUCT_VISUAL_TAIL = " Keep faces outside the frame; any visible hands/body retain the established host's sleeves, outfit and skin tone. No new or background people.";

export function cleanMotion(motion: string): string {
  const clauses = motion.trim().replace(/\.$/, '').replace(/ (?:while|as) /g, ', ').split(', ').filter(clause => !/\bcamera\b/i.test(clause));
  if (clauses[0] && /ing$/.test(clauses[0].split(' ')[0])) clauses.shift();
  return clauses.length ? `${clauses.join(', ')}.` : '';
}

export function affiliateCamera(group: AffiliateTemplateGroup, shot: Pick<AffiliatePromptShot, 'index' | 'kind' | 'beat' | 'line'>): AffiliateCamera {
  if (group === 'lookbook') return shot.beat === 'wear' ? 'locked' : shot.beat === 'detail' ? 'arc' : shot.beat === 'hanger' || shot.beat === 'final' || shot.beat === 'intro' ? 'push' : shot.index % 2 ? 'push' : 'arc';
  if (shot.kind === 'presenter' && (group === 'fashion' || shot.line)) return 'locked';
  return shot.index % 2 ? 'push' : 'arc';
}

const ratioWord = (context: AffiliatePromptContext) => RATIO_WORDS[context.ratio] ?? RATIO_WORDS['9:16'];
const languageName = (context: AffiliatePromptContext) => LANGUAGE_NAMES[context.language] ?? context.language;
const voiceLock = (context: AffiliatePromptContext) => context.language === 'vi' ? `VOICE LOCK — ${ACCENT_PHRASES[context.accent]}. ` : '';
const hostName = (context: AffiliatePromptContext) => context.host?.name ?? (context.group === 'talk' ? 'the presenter' : 'the model');
const quoted = (line: string) => `"${line.replace(/\s+/g, ' ').trim().replace(/"/g, '”')}"`;
// Capped so a long line still leaves the closing 9–10 s segment of the 10-second clip.
const speechEnd = (context: AffiliatePromptContext, line: string) => context.group === 'lookbook' ? 3 : context.group === 'fashion' ? 4 : Math.min(9, Math.round(1.6 + 0.3 * line.trim().split(/\s+/).length));
const isSpoken = (context: AffiliatePromptContext, shot: AffiliatePromptShot) => !!shot.line.trim() && context.hostMode !== 'silent';
const lookOf = (context: AffiliatePromptContext, shot: AffiliatePromptShot) => {
  const index = shot.outfitIndex ?? 0, look = context.outfitLooks?.[index];
  return { number: index + 1, text: look ? `LOOK ${index + 1} — ${look.name}: ${look.description}.` : '', lock: look ? ` The outfit is LOOK ${index + 1} (${look.name}): ${look.description}.` : '' };
};

export function affiliateHostRefPrompt(context: AffiliatePromptContext): string {
  const host = context.host, plain = context.group === 'talk';
  return [
    `Photorealistic portrait photo of a real person — ${host?.name ?? ''}, the ${plain ? 'presenter' : 'model'} of a short product video: ${host?.look ?? ''}`,
    `Waist-up, facing the camera, friendly natural expression, mouth closed, plain light background, soft natural light, true-to-life skin texture. Only this one person. No text, no letters, no watermark.${plain ? '' : ' For this reference photo only, the model wears a plain, simple, solid neutral-colored fitted top — the face and hair are what matter here (the outfit in the video comes from the product photos).'}`,
  ].join('\n');
}

function productBlock(context: AffiliatePromptContext, shot: AffiliatePromptShot): string[] {
  if (!shot.productVisible) return ['The product is absent from this shot; preserve that absence so the planned event stays clear.'];
  return [
    `PRODUCT: ${context.productTitle} — ${context.productLook}. It must look EXACTLY like the product in the attached product photo(s): same packaging, shape, proportions, colors and label design, at a realistic size. Use the photos only for the product itself (ignore their background, banners and text). Do not redesign it and do not invent new text or logos on it.`,
    "PRODUCT SHAPE LOCK: copy the product's silhouette, proportions, parts, material finish, colors and its OWN printed brand name / logo from the attached product photos — the photos decide what it looks like, NOT its name or category words (a gadget shaped like a gun, an animal or a fruit stays exactly that gadget from the photos, never a real one). The product photos are attached FIRST, before any person photo.",
  ];
}

function lookbookImageBlock(context: AffiliatePromptContext, shot: AffiliatePromptShot, name: string): string[] {
  const look = lookOf(context, shot), tail = shot.hasProductPhotos ? 'It must look EXACTLY like the garment(s) in the attached product photo(s): same cut, length, fit, neckline, colors, fabric texture, pattern and details.' : 'Show it realistically, with no invented text or logo.';
  const product = (middle: string) => `PRODUCT: ${context.productTitle} — ${context.productLook}. ${look.text ? `${look.text} ` : ''}${middle} ${tail} Show only this one look — never mix it with another look.`;
  const model = [
    `MODEL = the person in the attached presenter photo (${name}): draw exactly this same person — same face shape, eyes, eyebrows, nose, lips, skin tone and hairstyle (the same person, not a look-alike). Take ONLY the face and hair from that photo — never copy its clothes; the clothes of this shot are described below.`,
    `Presenter ${name}: ${context.host?.look ?? ''}`,
  ];
  const wears = `${name} WEARS this outfit, worn naturally on the body at a realistic size.`;
  if (shot.beat === 'detail') return [PRODUCT_FRAMING, product('Close-up of this outfit worn on the body (fabric, neckline, waist, lace, buttons or hem) at a realistic scale, no face in the frame.')];
  if (shot.beat === 'hanger') return [...model,
    `Framing: ${name} stands in the home dressing area facing the camera, waist-up or knees-up, holding ONE wooden hanger with the outfit in front of the body so the whole garment is visible and in focus; face clear, delighted playful smile. ${name} wears a plain heather-gray soft cotton loungewear set (short-sleeve top and shorts) with no pattern and no logo — never the product.`,
    product(`The garment hangs on a wooden hanger held by ${name} — shown, not worn, at a realistic size, the whole piece visible.`)];
  if (shot.beat === 'final') return [...model,
    `Framing: ${name} relaxes in the outing place in the outfit (for example seated at a table with a drink), facing the camera, face clear and in focus, warm smile; the outfit clearly visible.`, product(wears)];
  return [...model,
    `Framing: ${name} is the model, in a confident natural pose in the outing place, facing the camera, full-body or knees-up so the WHOLE outfit is visible (top, bottom, shoes if in frame), face clear and in focus. The outfit is worn, never held in the hands.`, product(wears)];
}

export function affiliateImagePrompt(context: AffiliatePromptContext, shot: AffiliatePromptShot): string {
  const name = hostName(context), motion = cleanMotion(shot.motion), lookbook = context.group === 'lookbook', model = context.group === 'fashion' && shot.kind === 'presenter';
  const lines = [`${ratioWord(context)} frame from a short social-media product video. Look: ${context.style}.`, `Scene: ${shot.scene}`];
  if (shot.line.trim()) lines.push(`Spoken meaning (context only, NEVER render these words as text): ${quoted(shot.line)}. The opening frame must visibly establish this line's concrete subject/event, using the planned pose, expression, prop or detail; do not substitute a generic sales pose.`);
  if (motion) lines.push(`Action to prepare in this FIRST FRAME: ${motion} Show a plausible starting pose with the relevant hands/objects visible; the clip will develop this same event.`);
  if (shot.line.trim() && shot.emotion) lines.push(`Expression and body language: ${shot.emotion}; match the line, without forcing a smile.`);
  lines.push(`Place: ${context.place}`);
  let longClosing = false;
  if (lookbook) lines.push(...lookbookImageBlock(context, shot, name));
  else if (model) {
    longClosing = true;
    lines.push(
      `MODEL = the person in the attached presenter photo (${name}): draw exactly this same person — same face shape, eyes, eyebrows, nose, lips, skin tone and hairstyle (the same person, not a look-alike). Take ONLY the face and hair from that photo — the clothes come from the product photo(s), never from the presenter photo.`,
      `Presenter ${name}: ${context.host?.look ?? ''}`,
      `Framing: ${name} is the model, mid-dance in a natural pose, facing the camera, full-body or knees-up so the WHOLE outfit is visible (top, bottom, shoes if in frame), face clear and in focus, confident playful expression. The outfit is the product — never hold it in the hands.`,
      `PRODUCT: ${context.productTitle} — ${context.productLook}. ${name} WEARS this outfit — ${GARMENT_LOCK}, worn naturally on the body at a realistic size. Use the photos only for the garment itself (ignore their background, mannequin, banners and text); do not redesign it.`);
  } else {
    if (shot.kind === 'presenter') lines.push(
      `PRESENTER = the person in the attached presenter photo (${name}): draw exactly this same person — same face shape, eyes, eyebrows, nose, lips, skin tone, hairstyle and outfit (the same person, not a look-alike).`,
      `Presenter ${name}: ${context.host?.look ?? ''}`,
      `Framing: ${name} faces the camera in medium or waist-up framing as needed for the action, face and mouth clearly visible and in focus, mouth closed and relaxed (about to speak). Keep the scene's relevant posture, hands or objects in frame and its line-matching expression; do not force a smile or a product-holding pose.`);
    else lines.push(PRODUCT_FRAMING);
    lines.push(...productBlock(context, shot));
    longClosing = shot.productVisible;
  }
  if (shot.index === 0) lines.push('This is the opening hook frame: make it eye-catching and dynamic, and keep the top fifth of the frame as plain, calm background (wall / sky / soft blur) with no face or product there.');
  lines.push(...CLOSING, `${NO_ADDED_TEXT}${longClosing ? " (the product's OWN printed brand name / logo from the photos stays exactly as printed)" : ''}.`);
  return lines.join('\n');
}

function talkClip(context: AffiliatePromptContext, shot: AffiliatePromptShot): string {
  const name = hostName(context), motion = cleanMotion(shot.motion), camera = CAMERA_LINES[shot.camera]('product'), end = speechEnd(context, shot.line);
  const emotion = shot.emotion || 'Natural, clear';
  const presenterHead = `Create ONE continuous 10-second ${ratioWord(context).toLowerCase()} video from the attached image, using it as the exact first frame. Keep ${name}'s face, hair, outfit, the place and the lighting exactly as in the image. If the PRODUCT is visible, match its initial placement, scale, packaging, shape, colors and label, then allow only its planned movement in the action below; never teleport or redesign it, and keep its exact shape and printed brand name from the first frame (never turn it into a real object of the same kind). If absent, do not add it. Real-time speed, no slow motion, no cuts; natural smartphone-video feel.`;
  const presenterMeaning = `${VISUAL_MEANING(shot.scene)}${shot.productVisible ? '' : ' The product is absent from this shot; do not add it.'}`;
  if (isSpoken(context, shot) && context.hostMode === 'presenter' && shot.kind === 'presenter') return [
    presenterHead,
    `IDENTITY LOCK: ${name} stays exactly the same person as in the first frame for the whole clip — same face shape, eyes, eyebrows, nose, lips, skin tone and hairstyle while talking and moving; no morphing, no face change.`,
    CAMERA_LINES.locked(''),
    `0–0.5 s: ${name} looks into the camera, mouth closed${shot.productVisible ? ", matching the product's initial placement in the image before the planned action" : ''}.`,
    `0.5–${end} s: ONLY ${name} speaks, directly to the viewer. ${name} says this exact line ONCE in ${languageName(context)}, clearly and completely, with accurate lip-sync on ${name}'s mouth: ${quoted(shot.line)}`,
    `Delivery: ${emotion} — brisk and clear, no long pauses; follow the specified emotion without forcing a cheerful mood, every word clear.`,
    `During the spoken words, ${name} performs this gentle line-matching action: ${motion || "preserve the scene's meaningful posture and expression."} Keep the planned posture/expression visible while speaking, face and mouth clear; no swallowing, drinking or covering the mouth during speech. Do not postpone the action until after the line.`,
    `${end}–10 s: ${name} stops talking and settles naturally in the same scene; nobody speaks.`,
    `${voiceLock(context)}${name}'s voice (host_v1): ${context.host?.voice ?? ''}. The same voice in every clip of this video.`,
    'Sound: the voice is clear and in front; only very quiet room tone. No background music, no singing, no other voices. No subtitles, no text, no logos, no watermark, no new people.',
    presenterMeaning,
  ].join('\n');
  // No Muse sample: a line-less presenter shot (keepScript) keeps the presenter's identity instead of the faceless product template.
  if (!isSpoken(context, shot) && shot.kind === 'presenter' && context.host) return [presenterHead, identityLock(name), CAMERA_LINES.locked(''),
    `Action: ${motion || "preserve the scene's meaningful posture and expression."}`,
    'Nobody speaks. Sound: only quiet natural ambient sound. No music, no voices, no subtitles, no text, no logos, no watermark.', presenterMeaning].join('\n');
  const head = `Create ONE continuous 10-second ${ratioWord(context).toLowerCase()} video from the attached image, using it as the exact first frame. Keep the place, lighting and identities in the image the same. If the PRODUCT is visible, match its initial placement, scale, packaging, shape, colors and label, then allow only its planned movement in the action below; never teleport or redesign it, and keep its exact shape and printed brand name from the first frame (never turn it into a real object of the same kind). If absent, do not add it.`;
  if (!isSpoken(context, shot)) return [`${head} Real-time speed, no cuts.`, camera, `Action: ${(motion || "preserve the scene's meaningful pose and object detail.").replace(/\.$/, '')}`,
    'Nobody speaks. Sound: only quiet natural ambient sound. No music, no voices, no subtitles, no text, no logos, no watermark.', `${VISUAL_MEANING(shot.scene)}${PRODUCT_VISUAL_TAIL}`].join('\n');
  const voice = context.host ? `the same voice as presenter ${name} (host_v1): ${context.host.voice}` : `the same off-screen narrator voice (narrator_v1): ${context.narratorVoice ?? ''}`;
  return [
    `${head} Never add text. Real-time speed, no cuts.`, camera,
    `Action: ${motion || "preserve the scene's meaningful pose and object detail."} Anyone visible in the image does NOT talk (mouth closed).`,
    `0.5–${end} s: an off-screen voice (nobody visible speaks) says this exact line ONCE in ${languageName(context)}, clearly and completely, at a brisk clear pace with no long pauses; match the meaning without forcing cheerfulness: ${quoted(shot.line)}`,
    `${voiceLock(context)}Voice: ${voice}. The same voice in every clip of this video.`,
    'Sound: the voice is clear and in front; only very quiet ambient sound. No background music, no singing, no other voices. No subtitles, no text, no logos, no watermark.',
    `${VISUAL_MEANING(shot.scene)}${PRODUCT_VISUAL_TAIL}`, `Delivery emotion: ${emotion}; match the spoken meaning.`,
  ].join('\n');
}

const identityLock = (name: string) => `IDENTITY LOCK: ${name} stays exactly the same person for the whole clip — same face shape, eyes, eyebrows, nose, lips, skin tone and hairstyle; no morphing, no face change.`;
function offscreenVoice(context: AffiliatePromptContext, shot: AffiliatePromptShot, name: string, tone: string): string {
  const voice = context.host ? `the same voice as model ${name} (host_v1): ${context.host.voice}` : `the same off-screen narrator voice (narrator_v1): ${context.narratorVoice ?? ''}`;
  return `Nobody visible speaks — ${name} keeps the mouth closed or smiling${context.group === 'fashion' ? ' while dancing' : ''}. From 0.5 to ${speechEnd(context, shot.line)} s an off-screen voice — ${voice} — says this exact line ONCE in ${languageName(context)}, ${tone}: ${quoted(shot.line)}. ${voiceLock(context)}Under the voice only quiet room tone (the music is added later): no music, no singing, no other voices.`;
}
const SILENT_TONE = (what: string) => `Sound: only quiet room tone (the ${what} is added later in editing): no music, no singing, no voices.`;

function fashionClip(context: AffiliatePromptContext, shot: AffiliatePromptShot): string {
  const name = hostName(context), motion = cleanMotion(shot.motion), spoken = isSpoken(context, shot);
  if (shot.kind === 'product') return [
    `Create ONE continuous 10-second ${ratioWord(context).toLowerCase()} video from the attached image, using it as the exact first frame. Keep the place, lighting and identities in the image the same. If the PRODUCT is visible, match its initial placement, scale, packaging, shape, colors and label, then allow only its planned movement in the action below; never teleport or redesign it, and keep its exact shape and printed brand name from the first frame (never turn it into a real object of the same kind). If absent, do not add it. Real-time speed, no cuts.`,
    CAMERA_LINES[shot.camera]('product'), `Action: ${(motion || "preserve the scene's meaningful pose and object detail.").replace(/\.$/, '')}`,
    'Nobody speaks. Sound: only quiet natural ambient sound. No music, no voices, no subtitles, no text, no logos, no watermark.', `${VISUAL_MEANING(shot.scene)}${PRODUCT_VISUAL_TAIL}`].join('\n');
  return [
    `Create ONE continuous 10-second ${ratioWord(context).toLowerCase()} video from the attached image, using it as the exact first frame. Keep ${name}'s face, hair, makeup, the outfit, the place and the lighting exactly as in the image. Real-time speed, natural smartphone-video feel, no slow motion, no cuts.`,
    identityLock(name), `OUTFIT LOCK: ${name} ${OUTFIT_LOCK}`, CAMERA_LINES.locked(''),
    `DANCE: ${name} shows off the outfit with a short, catchy TikTok-style fashion dance on the spot, energetic but light and graceful, in rhythm with an upbeat 4/4 beat: ${motion || 'sway and bounce to the beat.'} Small rhythmic moves — swaying hips, shoulder bounces, light steps, arm waves, cute hand gestures (heart hands, framing the face) — and one playful half-turn to show the side or back of the outfit, then back to the camera with a confident smile and eye contact. Keep the whole outfit (head to at least the knees) inside the frame the entire time.`,
    spoken ? offscreenVoice(context, shot, name, 'upbeat and clear') : SILENT_TONE('dance music'),
    'No subtitles, no text, no logos, no watermark, no new people.', VISUAL_MEANING(shot.scene)].join('\n');
}

function lookbookClip(context: AffiliatePromptContext, shot: AffiliatePromptShot): string {
  const name = hostName(context), look = lookOf(context, shot), planned = cleanMotion(shot.motion), spoken = isSpoken(context, shot);
  const action = (text: string) => `ACTION: ${text}${planned ? ` Planned moment: ${planned}` : ''}`;
  const beat = shot.beat === 'detail' ? [
    'IDENTITY LOCK: no face is visible — keep the frame on the outfit worn on the body; the same skin tone, arms and body for the whole clip; no new person.',
    `OUTFIT LOCK: the outfit keeps exactly the same fabric, colors, pattern and details for the whole clip; nothing added or removed.${look.lock}`,
    CAMERA_LINES.arc('outfit'),
    action('a slow, gentle movement that shows the fabric texture, the fit and the details of the outfit on the body (a hand lightly brushing the fabric, a small turn of the waist so the hem moves); keep the face outside the frame.'),
  ] : shot.beat === 'hanger' ? [
    identityLock(name),
    `OUTFIT LOCK: ${name} wears the same plain base outfit for the whole clip and is never dressed in the garment on the hanger; the garment on the hanger stays exactly the same piece (same cut, colors, pattern and details) — it is shown, never put on, never swapped.${look.lock}`,
    CAMERA_LINES.push(''),
    action(`${name} holds the wooden hanger with the outfit in front of the body and proudly shows it to the camera with a delighted, playful smile — lifts it slightly, sways it gently to the rhythm so the fabric moves, glances at it and back at the camera; the whole garment stays visible and in focus.`),
  ] : shot.beat === 'final' ? [
    identityLock(name), `OUTFIT LOCK: ${name} ${OUTFIT_LOCK}${look.lock}`, CAMERA_LINES.push(''),
    action(`${name} relaxes naturally in the place in the outfit (for example sits at the table with a drink, takes a small sip, tilts the head), then smiles warmly at the camera; the outfit stays clearly visible.`),
  ] : [
    identityLock(name), `OUTFIT LOCK: ${name} ${OUTFIT_LOCK}${look.lock}`, CAMERA_LINES.locked(''),
    action(`${name} shows off the outfit with confident model energy: a few graceful steps toward the camera, then a playful twirl that makes the skirt / hem flare, a look over the shoulder, and a confident smile with eye contact; keep the whole outfit (head to at least the knees) inside the frame.`),
  ];
  return [
    `Create ONE continuous 10-second ${ratioWord(context).toLowerCase()} video from the attached image, using it as the exact first frame. Keep the people, the clothes, the place and the lighting exactly as in the image. Real-time speed, natural smartphone-video feel, no slow motion, no cuts.`,
    ...beat, spoken ? offscreenVoice(context, shot, name, 'upbeat and clear') : SILENT_TONE('music'),
    'No subtitles, no text, no logos, no watermark, no new people.',
    shot.beat === 'detail' ? `${VISUAL_MEANING(shot.scene)}${PRODUCT_VISUAL_TAIL}` : VISUAL_MEANING(shot.scene)].join('\n');
}

export function affiliateClipPrompt(context: AffiliatePromptContext, shot: AffiliatePromptShot): string {
  return context.group === 'fashion' ? fashionClip(context, shot) : context.group === 'lookbook' ? lookbookClip(context, shot) : talkClip(context, shot);
}
