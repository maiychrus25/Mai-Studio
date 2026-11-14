import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderCards } from '../src/core/cards';
import { StudioService } from '../src/core/studio';
import type { Project, Task } from '../src/shared/studio';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

test('local Chromium renders title and transparent product cards as PNG without executing user text', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-cards-'));
  try {
    const files = [join(root, 'title.png'), join(root, 'overlay.png')];
    await renderCards([{ title: 'Một câu chuyện', body: '<script>throw new Error("must not execute")</script>', output: files[0], width: 320, height: 180 }, { title: 'Áo sơ mi', body: '250.000đ · Xem sản phẩm', output: files[1], width: 320, height: 180, overlay: true }], '', new AbortController().signal);
    for (const file of files) { const png = readFileSync(file); assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert.equal(png.readUInt32BE(16), 320); assert.equal(png.readUInt32BE(20), 180); }
    const abort = new AbortController(); abort.abort(); await assert.rejects(renderCards([], '', abort.signal));
    await assert.rejects(renderCards([{ title: 'Bad', output: files[0], width: -1, height: 180 }], '', new AbortController().signal), /dimensions/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('film title and end cards add real timeline clips rather than only metadata', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maistudio-title-')); const studio = new StudioService(root);
  try {
    const image = join(root, 'image.png'); assert.equal(spawnSync(require('ffmpeg-static') as string, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180', '-frames:v', '1', image]).status, 0);
    const [asset] = await studio.importFiles([image]);
    const p = await studio.invoke<Project>('project.save', { name: 'cards', kind: 'film', data: { renderMode: 'slideshow', width: 320, height: 180, titleCard: 'Xin chào', endCard: 'Hẹn gặp lại', shots: [{ id: 'one', prompt: 'one', duration: 0.2, assetId: asset.id }] } });
    const task = await studio.invoke<Task>('studio.run', { projectId: p.id });
    for (let n = 0; n < 1000 && ['queued', 'running', 'draft'].includes(studio.store.task(task.id).status); n++) await delay(20);
    const done = studio.store.task(task.id); assert.equal(done.status, 'succeeded', done.error);
    assert.ok(Math.abs(Number(studio.store.asset(done.outputIds[0]).duration) - 4.2) < 0.08);
  } finally { await studio.close(); rmSync(root, { recursive: true, force: true }); }
});
