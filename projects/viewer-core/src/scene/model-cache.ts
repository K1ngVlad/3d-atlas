import type { LoadedModel } from './load-gltf';
import { disposeModel } from './load-gltf';
import type { FetchModel } from './fetch-model';
import { ViewerError } from '../manifest/errors';

export interface ModelCache {
  getOrLoad(
    url: string,
    opts: { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void },
  ): Promise<LoadedModel>;
  has(url: string): boolean;
  dispose(): void;
}

export interface ModelCacheDeps {
  fetchModel: FetchModel;
  parse: (buffer: ArrayBuffer) => Promise<LoadedModel>;
}

export function createModelCache(deps: ModelCacheDeps): ModelCache {
  const entries = new Map<string, Promise<LoadedModel>>();
  const resolved = new Map<string, LoadedModel>();

  return {
    has(url) {
      return resolved.has(url);
    },
    getOrLoad(url, opts) {
      const cached = resolved.get(url);
      if (cached) {
        // ещё раз сообщаем, что всё уже готово — для согласованности прогресса
        opts.onProgress?.(1, 1);
        return Promise.resolve(cached);
      }
      const inflight = entries.get(url);
      if (inflight) return inflight;

      const promise = (async () => {
        let buffer: ArrayBuffer;
        try {
          buffer = await deps.fetchModel(url, opts);
        } catch (err) {
          entries.delete(url);
          throw err;
        }
        let model: LoadedModel;
        try {
          model = await deps.parse(buffer);
        } catch (err) {
          entries.delete(url);
          throw new ViewerError('model-parse-failed', `parse failed: ${url}`, err);
        }
        resolved.set(url, model);
        entries.delete(url);
        return model;
      })();

      entries.set(url, promise);
      return promise;
    },
    dispose() {
      for (const model of resolved.values()) disposeModel(model);
      resolved.clear();
      entries.clear();
    },
  };
}
