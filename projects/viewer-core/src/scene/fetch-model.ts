import { ViewerError } from '../manifest/errors';

export type FetchModel = (
  url: string,
  opts: { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void },
) => Promise<ArrayBuffer>;

export const defaultFetchModel: FetchModel = async (url, opts) => {
  let response: Response;
  try {
    response = await fetch(url, { signal: opts.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new ViewerError('load-aborted', `aborted: ${url}`, err);
    throw new ViewerError('model-fetch-failed', `fetch failed: ${url}`, err);
  }
  if (!response.ok) {
    throw new ViewerError('model-fetch-failed', `fetch ${url}: HTTP ${response.status}`);
  }

  const totalHeader = response.headers.get('content-length');
  const total = totalHeader ? Number(totalHeader) : 0;

  if (!response.body || typeof response.body.getReader !== 'function') {
    const buf = await response.arrayBuffer();
    opts.onProgress?.(buf.byteLength, total || buf.byteLength);
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    opts.onProgress?.(loaded, total);
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged.buffer;
};
