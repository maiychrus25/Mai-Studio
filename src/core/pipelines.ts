import type { Character, Project, Shot } from '../shared/studio';
import { parseSrt } from './media';
import { readAffiliateSettings, affiliateMode } from '../shared/affiliate';

const MAX_ITEMS = 1000;
const MAX_TEXT = 32768;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}: expected an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = MAX_TEXT): string {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > max || value.includes('\0')) throw new Error(`Invalid ${label}: nonempty text required, limit ${max} UTF-8 bytes`);
  return value;
}

function list(value: unknown, label: string, allowEmpty = false): unknown[] {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.length > MAX_ITEMS) throw new Error(`Invalid ${label}: array required, limit ${MAX_ITEMS}`);
  return value;
}

function unique<T extends { id: string }>(items: T[], label: string): T[] {
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error(`Duplicate ${label} id`);
  return items;
}

export function buildShots(input: { script?: string; subtitle?: string; shots?: unknown; product?: Record<string, unknown>; episodeCount?: number; visualGrouped?: boolean }): Shot[] {
  record(input, 'shot input');
  if (input.episodeCount !== undefined && (!Number.isInteger(input.episodeCount) || input.episodeCount < 1 || input.episodeCount > MAX_ITEMS)) throw new Error('Invalid episodeCount: expected 1–1000');
  if (input.shots !== undefined) {
    const items = list(input.shots, 'shots');
    const cues = input.subtitle === undefined || input.visualGrouped === true ? undefined : parseSrt(text(input.subtitle, 'subtitle', 10 * 1024 * 1024));
    if (cues && cues.length !== items.length) throw new Error('Shot count must match subtitle cue count');
    let end = 0;
    return unique(items.map((value, index) => {
      const item = record(value, 'shot');
      const duration = item.duration;
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0.001 || duration > 3600) throw new Error('Invalid shot duration: expected 0.001–3600 seconds');
      const shot: Shot = { id: item.id === undefined ? `shot-${index + 1}` : text(item.id, 'shot id', 256), prompt: text(item.prompt, 'shot prompt'), duration };
      const start = item.start === undefined ? cues?.[index].start : item.start;
      if (start !== undefined) {
        if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) throw new Error('Invalid shot start: expected finite nonnegative seconds');
        if (start < end - 1e-9) throw new Error('Invalid shot timeline: overlapping or reversed starts');
        shot.start = start;
      }
      end = (shot.start ?? end) + duration;
      for (const key of ['dialogue', 'speaker', 'assetId', 'videoAssetId', 'voiceId'] as const) {
        if (item[key] !== undefined) shot[key] = text(item[key], `shot ${key}`);
      }
      for (const key of ['sceneId', 'shotType', 'videoPrompt'] as const) if (item[key] !== undefined) shot[key] = text(item[key], `shot ${key}`);
      for (const key of ['caption', 'beat'] as const) if (item[key] !== undefined && item[key] !== '') shot[key] = text(item[key], `shot ${key}`, key === 'caption' ? 512 : 256);
      if (item.outfitIndex !== undefined) { if (!Number.isInteger(item.outfitIndex) || Number(item.outfitIndex) < 0 || Number(item.outfitIndex) > 3) throw new Error('Invalid shot outfit index'); shot.outfitIndex = Number(item.outfitIndex); }
      if (item.transition !== undefined) { if (!['cut', 'flash', 'whip'].includes(String(item.transition))) throw new Error('Invalid shot transition'); shot.transition = item.transition as Shot['transition']; }
      for (const key of ['action', 'acting', 'camera', 'environment'] as const) if (item[key] !== undefined) shot[key] = text(item[key], `shot ${key}`, 4000);
      for (const key of ['characterIds', 'listenerIds'] as const) if (item[key] !== undefined) shot[key] = list(item[key], key, true).map(value => text(value, key, 256));
      return shot;
    }), 'shot');
  }
  if (input.subtitle !== undefined) return parseSrt(text(input.subtitle, 'subtitle', 10 * 1024 * 1024)).map(cue => {
    const duration = cue.end - cue.start;
    if (duration > 3600) throw new Error('Invalid derived shot duration: limit 3600 seconds');
    return { id: `shot-${cue.index}`, prompt: text(cue.text, 'cue text'), duration, start: cue.start, dialogue: cue.text };
  });
  let source: string;
  if (input.script !== undefined) source = text(input.script, 'script', MAX_ITEMS * MAX_TEXT);
  else if (input.product !== undefined) {
    const product = record(input.product, 'product');
    if (!Object.keys(product).length) throw new Error('Invalid product: facts required');
    source = Object.entries(product).map(([key, value]) => {
      text(key, 'product field', 256);
      let serialized: string | undefined;
      try {
        serialized = JSON.stringify(value, (_key, part: unknown) => {
          if (typeof part === 'number' && !Number.isFinite(part) || ['undefined', 'function', 'symbol', 'bigint'].includes(typeof part)) throw new Error('Non-JSON fact');
          return part;
        });
      } catch { throw new Error(`Invalid product fact: ${key}`); }
      return `${key}: ${typeof value === 'string' ? value : serialized}`;
    }).join('\n');
  } else throw new Error('Script, subtitle, shots or product facts required');
  return list(source.replace(/\r\n?/g, '\n').split(/\n\s*\n/).filter(part => part.trim()), 'shots').map((part, index) => ({ id: `shot-${index + 1}`, prompt: text(part, 'shot prompt'), duration: 5 }));
}

export function validateCharacters(value: unknown): Character[] {
  if (value === undefined) return [];
  return unique(list(value, 'characters', true).map(value => {
    const item = record(value, 'character');
    const character: Character = { id: text(item.id, 'character id', 256), name: text(item.name, 'character name', 256), description: text(item.description, 'character description') };
    for (const key of ['assetId', 'voiceId', 'voiceProfile'] as const) if (item[key] !== undefined) character[key] = text(item[key], `character ${key}`, key === 'voiceProfile' ? 4000 : 256);
    return character;
  }), 'character');
}

export function validateEpisodes(value: unknown): Array<{ id: string; name: string; script: string }> {
  return unique(list(value, 'episodes').map(value => {
    const item = record(value, 'episode');
    return { id: text(item.id, 'episode id', 256), name: text(item.name, 'episode name', 256), script: text(item.script, 'episode script', MAX_ITEMS * MAX_TEXT) };
  }), 'episode');
}

export function affiliateDubbing(project: Pick<Project, 'kind' | 'data'>): { voiceId: string; speed: number } | undefined {
  if (project.kind !== 'affiliate' || project.data.affiliate === undefined) return;
  const data = project.data;
  if (data.affiliateDub !== undefined && typeof data.affiliateDub !== 'boolean') throw new Error('Invalid Affiliate dub: expected boolean');
  const speed = data.affiliateVoiceSpeed ?? 1;
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.8 || speed > 1.25) throw new Error('Invalid Affiliate voice speed: expected 0.8–1.25');
  if (data.voiceVolume !== undefined && (typeof data.voiceVolume !== 'number' || !Number.isFinite(data.voiceVolume) || data.voiceVolume < 0 || data.voiceVolume > 1)) throw new Error('Invalid Affiliate voiceVolume: expected 0–1');
  if (data.affiliateDub !== true) return;
  if (!affiliateMode(readAffiliateSettings(data.affiliate)).spoken) throw new Error('Affiliate dubbing requires spoken mode; silent and ASMR cannot be dubbed');
  if (data.renderMode === 'slideshow') throw new Error('Affiliate dubbing requires video clips');
  return { voiceId: text(data.voiceId, 'Affiliate voice ID', 256), speed };
}

export function pipelineSteps(project: Project, options: { speech?: boolean } = {}): Array<{ id: string; kind: 'image' | 'video' | 'speech'; prompt: string; duration: number; start?: number; refIds: string[]; voiceId?: string; dialogue?: string; speaker?: string; shotType?: string; videoAssetId?: string }> {
  const data = record(project.data, 'project data');
  const characters = new Map(validateCharacters(data.characters).map(character => [character.id, character]));
  const productRefs = data.productAssetIds === undefined ? [] : list(data.productAssetIds, 'product references', true).map(id => text(id, 'product reference ID', 256));
  const affiliate = project.kind === 'affiliate' && data.affiliate !== undefined ? readAffiliateSettings(data.affiliate) : undefined;
  const mode = affiliate ? affiliateMode(affiliate) : undefined;
  const dubbing = affiliateDubbing(project);
  const style = [data.style, data.styleText].filter(value => typeof value === 'string' && value.trim()).join('. ');
  const steps: ReturnType<typeof pipelineSteps> = [];
  function addShots(source: Record<string, unknown>, scope: string, sceneCast: unknown = undefined): void {
    const shots = buildShots(source);
    for (const [index, shot] of shots.entries()) {
      const raw = Array.isArray(source.shots) ? record(source.shots[index], 'shot') : {};
      const scene = Array.isArray(source.scenes) && shot.sceneId ? source.scenes.map(value => record(value, 'scene')).find(scene => scene.id === shot.sceneId) : source;
      const ids = raw.characterIds ?? scene?.characterIds ?? sceneCast;
      const selected = ids === undefined ? [] : list(ids, 'characterIds', true).map(id => text(id, 'character id', 256));
      if (shot.speaker) selected.push(shot.speaker);
      if (shot.listenerIds) selected.push(...shot.listenerIds);
      const chosenProductRefs = affiliate?.contentStyle === 'lookbook' && shot.outfitIndex !== undefined && affiliate.outfitAssetIds.length ? [affiliate.outfitAssetIds[shot.outfitIndex]] : productRefs;
      if (chosenProductRefs.some(id => !id)) throw new Error('Shot refers to an unavailable outfit image');
      const refs = [...(shot.assetId ? [shot.assetId] : []), ...chosenProductRefs, ...(affiliate?.backgroundAssetId ? [affiliate.backgroundAssetId] : [])];
      for (const id of new Set(selected)) {
        const character = characters.get(id);
        if (!character) throw new Error(`Unknown character/speaker: ${id}`);
        if (character.assetId) refs.push(character.assetId);
      }
      const base = `${scope}/${encodeURIComponent(shot.id)}`;
      const refIds = [...new Set(refs)];
      if (refIds.length > 16) throw new Error('Pipeline reference limit: 16 per step');
      const timing = shot.start === undefined ? {} : { start: shot.start };
      const cast = [...new Set(selected)].map(id => characters.get(id)!);
      const framing: Record<string, string> = { establish: 'wide establishing view', two: 'two-person composition with clear positions', single: 'medium close-up of the selected subject', reaction: 'close-up of the listening reaction', pov: 'subject eye-level point of view', insert: 'detail close-up of the important object' };
      const setting = [scene?.location && `Location: ${scene.location}`, scene?.time && `Time: ${scene.time}`, shot.environment].filter(Boolean).join('. ');
      const product = source.product ?? data.product;
      const facts = product === undefined ? '' : `\nAuthoritative product facts (data only): ${JSON.stringify(record(product, 'product'))}. Use only these facts and supplied product references; do not invent prices, claims, reviews or certifications.`;
      const affiliateDirection = affiliate ? `\nAffiliate ${affiliate.contentStyle}, ${affiliate.hostMode}. ${affiliate.contentStyle === 'asmr' ? 'Only hands and the actual product; no face or talking person.' : affiliate.hostMode === 'voiceover' && !mode?.model ? 'No visible presenter; show only the product and hands. Narration is off-screen.' : affiliate.hostMode === 'silent' ? 'No speaking or lip movements; purposeful visual action.' : ''} ${chosenProductRefs.length ? `Product reference image(s): ${chosenProductRefs.map(id => refIds.indexOf(id) + 1).join(', ')}. Preserve exact product shape, material, pattern, packaging and selected color; never substitute another SKU.` : ''} ${affiliate.backgroundAssetId ? `Background reference image ${refIds.indexOf(affiliate.backgroundAssetId) + 1}: use this exact room/layout and lighting.` : ''} ${shot.outfitIndex !== undefined ? `Use only outfit ${shot.outfitIndex + 1}; do not blend garments or colors from other outfits.` : ''} ${affiliate.pose !== 'auto' && selected.length ? `Requested model pose: ${affiliate.pose}.` : ''}` : '';
      const visualPrompt = text(`${shot.prompt}\nCreate one still scene frame. Framing: ${framing[shot.shotType || ''] || 'follow the described framing; otherwise use an eye-level medium-wide composition'}.\nVisible action beat: ${shot.action || 'capture the described action at one readable instant'}. Acting and expression: ${shot.acting || 'natural posture and expression appropriate to the described beat'}.${shot.camera ? `\nCamera plan: ${shot.camera}; compose a still instant of this shot.` : ''}\nScene location, time and environment: ${setting || 'retain the setting and time in the visual description; do not invent a different scene'}.\nSelected characters:\n${cast.length ? cast.map(character => `${character.name}: ${character.description}`).join('\n') : 'Only the subjects described in the visual plan; do not add people.'}\nUse this visual style for the whole frame: ${style || 'the supplied visual description and references; keep it coherent'}. No extra people. ${affiliate ? 'No added on-screen text, subtitles, watermarks or invented logos; preserve real labels printed on the product.' : 'No on-screen text, subtitles or logos.'}${facts}`, 'image prompt');
      if (!shot.assetId && !shot.videoAssetId) steps.push({ id: `${base}/image`, kind: 'image', prompt: text(visualPrompt + affiliateDirection, 'image prompt'), duration: shot.duration, ...timing, refIds });
      let clipPrompt = `Animate the supplied single scene anchor frame. Use that exact image as the first frame; lock each face, hair, outfit, background, composition and visual style to the anchor. Do not redesign or replace them.\nMotion and action: ${shot.action || 'continue the visible action established in the anchor naturally'}.${shot.videoPrompt || !shot.action ? ` Motion plan: ${shot.videoPrompt || shot.prompt}.` : ''}\nActing: ${shot.acting || 'natural expression and body mechanics consistent with the anchored pose'}.\nCamera: ${shot.camera || 'follow any camera movement in the motion plan; otherwise hold the camera steady'}.\nEnvironment: ${setting || 'preserve the anchored location and time; allow only natural ambient motion consistent with it'}.\nMaintain natural continuity from the anchored pose with coherent movement and object contact through one continuous take. No extra people. No cuts, transitions or scene changes. ${affiliate ? 'No added on-screen text, subtitles or watermarks; keep genuine product labels and branding.' : 'No on-screen text, subtitles or logos.'}${style ? `\nKeep the anchored ${style} style throughout.` : ''}${facts}`;
      if (source.nativeAudio === true || data.nativeAudio === true) {
        clipPrompt += `\nPreserve the reference frame and character identities.\n${cast.map(character => `${character.name}: ${character.description}.${shot.dialogue || !affiliate ? ` Stable voice: ${character.voiceProfile || 'keep the same voice throughout the film'}.` : ''}`).join('\n')}`;
        if (affiliate) clipPrompt += shot.dialogue
          ? `\nThe edit uses ${shot.duration.toFixed(3)} seconds. Start the requested action and dialogue immediately and complete them together within this window. No opening wait, filler, repetition or off-script speech. Leave time for the final spoken word and action to finish naturally; never clip words.`
          : `\nThe edit uses ${shot.duration.toFixed(3)} seconds. Start the requested visible action immediately and complete it within this window. No opening static hold; preserve natural action/handling sounds.`;
        clipPrompt += shot.dialogue ? `\n${shot.speaker ? characters.get(shot.speaker)?.name || shot.speaker : 'Narrator'} speaks exactly: ${JSON.stringify(shot.dialogue)}. ${shot.listenerIds?.length ? `Listeners: ${shot.listenerIds.map(id => characters.get(id)!.name).join(', ')} react naturally and remain silent.` : ''}` : '\nSilent visual action; no invented speech.';
        clipPrompt += affiliate ? `\nNo added subtitles, watermarks or background music. Preserve real product labels, natural scene sound${shot.dialogue ? ' and the requested dialogue' : ''}.` : '\nNo subtitles, logos or background music. Keep natural scene sound and the requested dialogue.';
      } else clipPrompt += `\nThe edit uses the first ${shot.duration.toFixed(3)} seconds. Start the requested visible action immediately and make it readable within that interval; continue naturally afterward. Do not spend the opening interval on an unrequested static hold. No invented speech or background music.`;
      if (affiliate) clipPrompt += `\nAffiliate audio and host direction: ${affiliate.contentStyle === 'asmr' ? 'Record only natural close-mic handling/packaging/assembly sounds synchronized to the visible hands. No human voice, humming, narration or music.' : mode?.spoken && shot.dialogue ? `${affiliate.hostMode === 'voiceover' ? 'Use one stable off-screen narrator; no lip movement or talking face.' : 'Only the intended host speaks; everyone else remains silent.'} Voice: ${affiliate.gender}, ${affiliate.age}, ${affiliate.accent} accent when speaking Vietnamese; language ${data.language || 'vi'}.` : 'No human speech, humming, narration, lip-sync or invented voices. Preserve only natural action/handling sounds.'} Product identity remains locked to the scene anchor. ${shot.transition === 'whip' ? 'Finish with a brief motivated lateral camera pan for the edit; keep one continuous take.' : ''}`;
      steps.push({ id: `${base}/video`, kind: 'video', prompt: text(clipPrompt, 'video prompt'), duration: shot.duration, ...timing, refIds: shot.assetId ? [shot.assetId] : [],
        ...(shot.dialogue ? { dialogue: shot.dialogue } : {}), ...(shot.speaker ? { speaker: shot.speaker } : affiliate?.hostMode === 'voiceover' && shot.dialogue ? { speaker: 'affiliate-voice' } : {}), ...(shot.shotType ? { shotType: shot.shotType } : {}), ...(shot.videoAssetId ? { videoAssetId: shot.videoAssetId } : {}) });
      if (shot.dialogue && options.speech !== false && (dubbing || source.nativeAudio !== true && data.nativeAudio !== true && !['none', 'source'].includes(String(source.narrationMode ?? data.narrationMode)))) {
        const voiceId = dubbing?.voiceId ?? shot.voiceId ?? (shot.speaker ? characters.get(shot.speaker)?.voiceId : undefined) ?? source.voiceId ?? data.voiceId;
        if (!voiceId) throw new Error(`Speech voice required for shot ${shot.id}`);
        steps.push({ id: `${base}/speech`, kind: 'speech', prompt: shot.dialogue, duration: shot.duration, ...timing, refIds: [], voiceId: text(voiceId, 'voice id', 256) });
      }
      if (steps.length > MAX_ITEMS) throw new Error('Pipeline step limit: 1000');
    }
  }
  function addScenes(source: Record<string, unknown>, scope: string): void {
    if (source.shots !== undefined || source.scenes === undefined) addShots(source, scope);
    else {
      const scenes: Array<Record<string, unknown> & { id: string }> = list(source.scenes, 'scenes').map((value, index) => {
        const scene = record(value, 'scene');
        return { ...scene, id: scene.id === undefined ? `scene-${index + 1}` : text(scene.id, 'scene id', 256) };
      });
      for (const scene of unique(scenes, 'scene')) {
        if (scene.shots === undefined && scene.script === undefined && scene.subtitle === undefined) throw new Error('Scene shots or script required');
        addShots(scene, `${scope}/${encodeURIComponent(scene.id)}`, scene.characterIds);
      }
    }
  }
  const scope = encodeURIComponent(text(project.id, 'project id', 256));
  if (project.kind === 'series') {
    for (const [index, episode] of validateEpisodes(data.episodes).entries()) {
      const original = record((data.episodes as unknown[])[index], 'episode');
      addScenes({ ...original, ...episode }, `${scope}/${encodeURIComponent(episode.id)}`);
    }
  } else addScenes(data, scope);
  return steps;
}
