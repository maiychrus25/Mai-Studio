import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

export async function mediaResponse(path: string, mime: string, request: Request): Promise<Response> {
  request.signal.throwIfAborted();
  const file = await stat(path); if (!file.isFile()) throw new Error('Media must be a file');
  const headers = new Headers({ 'Content-Type': mime, 'Accept-Ranges': 'bytes' });
  const range = request.headers.get('range'); let start = 0; let end = file.size - 1;
  if (range !== null) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      if (!Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[2]))) start = -1;
    } else start = -1;
    if (start < 0 || start > end) {
      headers.set('Content-Range', `bytes */${file.size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${file.size}`);
  }
  headers.set('Content-Length', String(Math.max(0, end - start + 1)));
  // Electron file fetch omits the 206/Content-Range metadata required for seeking.
  const body = file.size ? Readable.toWeb(createReadStream(path, { start, end, signal: request.signal })) as ReadableStream<Uint8Array> : null;
  return new Response(body, { status: range === null ? 200 : 206, headers });
}
