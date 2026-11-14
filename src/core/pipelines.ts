import type { Character, Project, Shot } from '../shared/studio';
import { parseSrt } from './media';

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

export function pipelineSteps(project: Project, options: { speech?: boolean } = {}): Array<{ id: string; kind: 'image' | 'video' | 'speech'; prompt: string; duration: number; start?: number; refIds: string[]; voiceId?: string; dialogue?: string; speaker?: string; shotType?: string; videoAssetId?: string }> {
  const data = record(project.data, 'project data');
  const characters = new Map(validateCharacters(data.characters).map(character => [character.id, character]));
  const productRefs = data.productAssetIds === undefined ? [] : list(data.productAssetIds, 'product references', true).map(id => text(id, 'product reference ID', 256));
  const style = [data.style, data.styleText].filter(value => typeof value === 'string' && value.trim()).join('. ');
  const steps: ReturnType<typeof pipelineSteps> = [];
  function addShots(source: Record<string, unknown>, scope: string, cast: unknown = undefined): void {
    const shots = buildShots(source);
    for (const [index, shot] of shots.entries()) {
      const raw = Array.isArray(source.shots) ? record(source.shots[index], 'shot') : {};
      const scene = Array.isArray(source.scenes) && shot.sceneId ? source.scenes.map(value => record(value, 'scene')).find(scene => scene.id === shot.sceneId) : undefined;
      const ids = raw.characterIds ?? scene?.characterIds ?? cast;
      const selected = ids === undefined ? [] : list(ids, 'characterIds', true).map(id => text(id, 'character id', 256));
      if (shot.speaker) selected.push(shot.speaker);
      if (shot.listenerIds) selected.push(...shot.listenerIds);
      const refs = [...(shot.assetId ? [shot.assetId] : []), ...productRefs];
      for (const id of new Set(selected)) {
        const character = characters.get(id);
        if (!character) throw new Error(`Unknown character/speaker: ${id}`);
        if (character.assetId) refs.push(character.assetId);
      }
      const base = `${scope}/${encodeURIComponent(shot.id)}`;
      const refIds = [...new Set(refs)];
      if (refIds.length > 16) throw new Error('Pipeline reference limit: 16 per step');
      const timing = shot.start === undefined ? {} : { start: shot.start };
      const visualPrompt = text(`${shot.prompt}${style ? `\nUse this visual style for the whole frame: ${style}.` : ''}`, 'image prompt');
      if (!shot.assetId && !shot.videoAssetId) steps.push({ id: `${base}/image`, kind: 'image', prompt: visualPrompt, duration: shot.duration, ...timing, refIds });
      let clipPrompt = shot.videoPrompt || shot.prompt;
      if (style) clipPrompt += `\nUse this visual style throughout: ${style}.`;
      if (source.nativeAudio === true || data.nativeAudio === true) {
        const cast = [...new Set(selected)].map(id => characters.get(id)!);
        clipPrompt += `\nPreserve the reference frame and character identities. ${scene ? `Location: ${scene.location || ''}; time: ${scene.time || ''}.` : ''}\n${cast.map(character => `${character.name}: ${character.description}. Stable voice: ${character.voiceProfile || 'keep the same voice throughout the film'}.`).join('\n')}`;
        clipPrompt += shot.dialogue ? `\n${shot.speaker ? characters.get(shot.speaker)?.name || shot.speaker : 'Narrator'} speaks exactly: ${JSON.stringify(shot.dialogue)}. ${shot.listenerIds?.length ? `Listeners: ${shot.listenerIds.map(id => characters.get(id)!.name).join(', ')} react naturally and remain silent.` : ''}` : '\nSilent visual action; no invented speech.';
        clipPrompt += '\nNo subtitles, logos or background music. Keep natural scene sound and the requested dialogue.';
      }
      steps.push({ id: `${base}/video`, kind: 'video', prompt: text(clipPrompt, 'video prompt'), duration: shot.duration, ...timing, refIds,
        ...(shot.dialogue ? { dialogue: shot.dialogue } : {}), ...(shot.speaker ? { speaker: shot.speaker } : {}), ...(shot.shotType ? { shotType: shot.shotType } : {}), ...(shot.videoAssetId ? { videoAssetId: shot.videoAssetId } : {}) });
      if (shot.dialogue && options.speech !== false && source.nativeAudio !== true && data.nativeAudio !== true && !['none', 'source'].includes(String(source.narrationMode ?? data.narrationMode))) {
        const voiceId = shot.voiceId ?? (shot.speaker ? characters.get(shot.speaker)?.voiceId : undefined) ?? source.voiceId ?? data.voiceId;
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
