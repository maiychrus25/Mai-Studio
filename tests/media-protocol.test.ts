import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mediaResponse } from '../electron/media';

test('media previews serve full files and exact seek ranges with HTTP metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'maistudio-media-'));
  try {
    const path = join(root, 'clip.mp4'); await writeFile(path, '0123456789');
    for (const [range, status, body, contentRange] of [
      [null, 200, '0123456789', null], ['bytes=2-5', 206, '2345', 'bytes 2-5/10'],
      ['bytes=7-', 206, '789', 'bytes 7-9/10'], ['bytes=-3', 206, '789', 'bytes 7-9/10'],
      ['bytes=8-99', 206, '89', 'bytes 8-9/10'], ['bytes=-99', 206, '0123456789', 'bytes 0-9/10'],
    ] as const) {
      const response = await mediaResponse(path, 'video/mp4', new Request('https://asset.test/', { headers: range ? { Range: range } : {} }));
      assert.equal(response.status, status, range ?? 'full file');
      assert.equal(response.headers.get('content-type'), 'video/mp4');
      assert.equal(response.headers.get('accept-ranges'), 'bytes');
      assert.equal(response.headers.get('content-length'), String(body.length));
      assert.equal(response.headers.get('content-range'), contentRange);
      assert.equal(await response.text(), body);
    }
    for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'items=0-2', 'bytes=99999999999999999999-']) {
      const response = await mediaResponse(path, 'video/mp4', new Request('https://asset.test/', { headers: { Range: range } }));
      assert.equal(response.status, 416, range); assert.equal(response.headers.get('content-range'), 'bytes */10');
      assert.equal(await response.text(), '');
    }
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(mediaResponse(path, 'video/mp4', new Request('https://asset.test/', { signal: aborted.signal })), /abort/i);
    await assert.rejects(mediaResponse(root, 'video/mp4', new Request('https://asset.test/')), /file/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
