import { describe, expect, it } from 'vitest';
import { parseManifest } from './schema';
import { ManifestError } from './errors';

const minimal = {
  schemaVersion: 1,
  id: 'test',
  model: { url: 'x.glb' },
  parts: [{ id: 'a', nodes: 'NodeA' }],
};

describe('parseManifest', () => {
  it('accepts minimal manifest', () => {
    const m = parseManifest(minimal);
    expect(m.id).toBe('test');
    expect(m.parts).toHaveLength(1);
  });

  it('accepts nodes as string, array, and match', () => {
    for (const nodes of ['A', ['A', 'B'], { match: '^Rib' }]) {
      expect(() => parseManifest({ ...minimal, parts: [{ id: 'p', nodes }] })).not.toThrow();
    }
  });

  it('rejects invalid pick value', () => {
    const bad = { ...minimal, parts: [{ id: 'a', nodes: 'A', pick: 'nope' }] };
    expect(() => parseManifest(bad)).toThrow(ManifestError);
    try {
      parseManifest(bad);
    } catch (e) {
      expect((e as ManifestError).message).toContain('parts.0.pick');
    }
  });

  it('passes through unknown part fields', () => {
    const m = parseManifest({
      ...minimal,
      parts: [{ id: 'a', nodes: 'A', explode: { order: 5 }, label: { anchor: 'auto' } }],
    });
    expect((m.parts[0] as unknown as { explode: { order: number } }).explode.order).toBe(5);
  });

  it('types explode: order, stay, with, direction, offset', () => {
    const m = parseManifest({
      ...minimal,
      parts: [
        { id: 'a', nodes: 'A', explode: { order: 1, direction: [0, -1, 0], offset: 2.5 } },
        { id: 'b', nodes: 'B', explode: { stay: true } },
        { id: 'c', nodes: 'C', explode: { with: 'a' } },
      ],
    });
    const [a, b, c] = m.parts;
    expect(a.explode?.direction).toEqual([0, -1, 0]);
    expect(a.explode?.offset).toBe(2.5);
    expect(b.explode?.stay).toBe(true);
    expect(c.explode?.with).toBe('a');
  });

  it('rejects invalid explode shape', () => {
    expect(() =>
      parseManifest({ ...minimal, parts: [{ id: 'a', nodes: 'A', explode: { direction: [0, 1] } }] }),
    ).toThrow(/parts\.0\.explode/);
  });

  it('reports path on missing required field', () => {
    expect(() => parseManifest({ ...minimal, model: {} })).toThrow(/model\.url/);
  });
});
