import { describe, expect, it, vi } from 'vitest';
import { createModelCache } from './model-cache';
import type { LoadedModel } from './load-gltf';

function makeModel(id: string): LoadedModel {
  return {
    root: { __tag: id } as unknown as LoadedModel['root'],
    originalNames: new Map(),
    getNodePath: () => [],
  };
}

describe('model-cache', () => {
  it('делит одну модель между повторными запросами одного url', async () => {
    const fetchModel = vi.fn(async () => new ArrayBuffer(4));
    const parse = vi.fn(async () => makeModel('a'));
    const cache = createModelCache({ fetchModel, parse });

    const m1 = await cache.getOrLoad('u1', {});
    const m2 = await cache.getOrLoad('u1', {});

    expect(m1).toBe(m2);
    expect(fetchModel).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(cache.has('u1')).toBe(true);
  });

  it('параллельные запросы одного url делят один промис', async () => {
    const fetchModel = vi.fn(async () => new ArrayBuffer(4));
    const parse = vi.fn(async () => makeModel('b'));
    const cache = createModelCache({ fetchModel, parse });

    const [m1, m2] = await Promise.all([cache.getOrLoad('u2', {}), cache.getOrLoad('u2', {})]);

    expect(m1).toBe(m2);
    expect(fetchModel).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('разные url не делят загрузку', async () => {
    const fetchModel = vi.fn(async (url: string) => new TextEncoder().encode(url).buffer);
    const parse = vi.fn(async (buf: ArrayBuffer) => makeModel(String(buf.byteLength)));
    const cache = createModelCache({ fetchModel, parse });

    await cache.getOrLoad('one', {});
    await cache.getOrLoad('two', {});

    expect(fetchModel).toHaveBeenCalledTimes(2);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('onProgress прокидывается во fetchModel', async () => {
    const fetchModel = vi.fn(
      async (_url: string, opts: { onProgress?: (l: number, t: number) => void }) => {
        opts.onProgress?.(50, 100);
        opts.onProgress?.(100, 100);
        return new ArrayBuffer(0);
      },
    );
    const parse = vi.fn(async () => makeModel('c'));
    const cache = createModelCache({ fetchModel, parse });

    const seen: [number, number][] = [];
    await cache.getOrLoad('u3', { onProgress: (l, t) => seen.push([l, t]) });

    expect(seen).toEqual([
      [50, 100],
      [100, 100],
    ]);
  });

  it('ошибка fetchModel не записывается в кэш — повтор делает новый запрос', async () => {
    let first = true;
    const fetchModel = vi.fn(async () => {
      if (first) {
        first = false;
        throw new Error('boom');
      }
      return new ArrayBuffer(0);
    });
    const parse = vi.fn(async () => makeModel('d'));
    const cache = createModelCache({ fetchModel, parse });

    await expect(cache.getOrLoad('u4', {})).rejects.toThrow('boom');
    const m = await cache.getOrLoad('u4', {});
    expect(m).toBeDefined();
    expect(fetchModel).toHaveBeenCalledTimes(2);
    expect(parse).toHaveBeenCalledTimes(1);
  });
});
