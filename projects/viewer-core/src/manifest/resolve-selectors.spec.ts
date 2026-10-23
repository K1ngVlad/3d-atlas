import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D } from 'three';
import { resolveManifest, findNodesBySelector, partKey } from './resolve-selectors';
import { ManifestError } from './errors';
import type { SceneManifest } from './schema';

function makeMesh(name: string): Mesh {
  const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  m.name = name;
  return m;
}

function makeScene(): { root: Group; names: Map<Object3D, string> } {
  const root = new Group();
  root.name = 'Root';
  const names = new Map<Object3D, string>();

  const nucleus = new Group();
  nucleus.name = 'Nucleus';
  const nucleolus = new Group();
  nucleolus.name = 'Nucleolus';
  const nucleolusMesh = makeMesh('Nucleolus_mesh');
  nucleolus.add(nucleolusMesh);
  nucleus.add(nucleolus);

  const mitochondria = new Group();
  mitochondria.name = 'Mitochondria';
  const m1 = new Group();
  m1.name = 'Mitochondrion.1';
  const m1Mesh = makeMesh('Mitochondrion.1_mesh');
  m1.add(m1Mesh);
  const m2 = new Group();
  m2.name = 'Mitochondrion.2';
  const m2Mesh = makeMesh('Mitochondrion.2_mesh');
  m2.add(m2Mesh);
  mitochondria.add(m1, m2);

  const ribo = new Group();
  ribo.name = 'Ribosomes';
  const r1 = makeMesh('Ribosome.0001');
  const r2 = makeMesh('Ribosome.0002');
  ribo.add(r1, r2);

  root.add(nucleus, mitochondria, ribo);

  const assignNames = (o: Object3D) => {
    names.set(o, o.name);
    o.children.forEach(assignNames);
  };
  assignNames(root);

  return { root, names };
}

describe('findNodesBySelector', () => {
  it('string selector finds exact node', () => {
    const { root, names } = makeScene();
    const r = findNodesBySelector(root, names, 'Nucleus');
    expect(r.map((o) => o.name)).toEqual(['Nucleus']);
  });

  it('array selector finds multiple nodes', () => {
    const { root, names } = makeScene();
    const r = findNodesBySelector(root, names, ['Nucleus', 'Mitochondria']);
    expect(r.map((o) => o.name).sort()).toEqual(['Mitochondria', 'Nucleus']);
  });

  it('match selector uses regex', () => {
    const { root, names } = makeScene();
    const r = findNodesBySelector(root, names, { match: '^Ribosome\\.' });
    expect(r).toHaveLength(2);
  });
});

describe('resolveManifest', () => {
  const base: Omit<SceneManifest, 'parts'> = {
    schemaVersion: 1,
    id: 't',
    model: { url: 'x.glb' },
  } as SceneManifest;

  it('captures node together with subtree', () => {
    const { root, names } = makeScene();
    const manifest: SceneManifest = {
      ...base,
      parts: [{ id: 'nucleus', nodes: 'Nucleus', pick: 'select' }],
    } as SceneManifest;
    const r = resolveManifest(manifest, root, names);
    const meshes = r.partMeshes.get('nucleus') ?? [];
    expect(meshes.map((m) => m.name)).toEqual(['Nucleolus_mesh']);
  });

  it('throws on selector that matches nothing, with similar hint', () => {
    const { root, names } = makeScene();
    const manifest: SceneManifest = {
      ...base,
      parts: [{ id: 'x', nodes: 'Nucleu', pick: 'select' }],
    } as SceneManifest;
    expect(() => resolveManifest(manifest, root, names)).toThrow(ManifestError);
    try {
      resolveManifest(manifest, root, names);
    } catch (e) {
      expect((e as Error).message).toContain('Nucleus');
    }
  });

  it('select: "each" tags instance by direct child name', () => {
    const { root, names } = makeScene();
    const manifest: SceneManifest = {
      ...base,
      parts: [{ id: 'mito', nodes: 'Mitochondria', pick: 'select', select: 'each' }],
    } as SceneManifest;
    const r = resolveManifest(manifest, root, names);
    const inst1 = r.partMeshes.get(partKey('mito', 'Mitochondrion.1')) ?? [];
    const inst2 = r.partMeshes.get(partKey('mito', 'Mitochondrion.2')) ?? [];
    expect(inst1.map((m) => m.name)).toEqual(['Mitochondrion.1_mesh']);
    expect(inst2.map((m) => m.name)).toEqual(['Mitochondrion.2_mesh']);
  });

  it('select: "each" с несколькими найденными узлами — экземпляр каждый узел', () => {
    // Повторы не сгруппированы под общим родителем (как granule_0000…0006 в митохондрии).
    const root = new Group();
    root.name = 'Root';
    const names = new Map<Object3D, string>();
    for (let i = 0; i < 7; i++) {
      const g = new Group();
      const idx = String(i).padStart(4, '0');
      g.name = `granule_${idx}`;
      const mesh = makeMesh(`granule_${idx}_mesh`);
      g.add(mesh);
      root.add(g);
    }
    const assignNames = (o: Object3D) => {
      names.set(o, o.name);
      o.children.forEach(assignNames);
    };
    assignNames(root);

    const manifest: SceneManifest = {
      ...base,
      parts: [{ id: 'granules', nodes: { match: '^granule_\\d+$' }, pick: 'select', select: 'each' }],
    } as SceneManifest;
    const r = resolveManifest(manifest, root, names);
    const instanceNames = r.orderedKeys
      .filter((k) => k.startsWith('granules::'))
      .map((k) => k.slice('granules::'.length))
      .sort();
    expect(instanceNames).toEqual([
      'granule_0000', 'granule_0001', 'granule_0002', 'granule_0003',
      'granule_0004', 'granule_0005', 'granule_0006',
    ]);
    const sample = r.partMeshes.get(partKey('granules', 'granule_0003')) ?? [];
    expect(sample.map((m) => m.name)).toEqual(['granule_0003_mesh']);
  });

  it('select: "each" с одним найденным узлом — экземпляры его дети (поведение не изменилось)', () => {
    const { root, names } = makeScene();
    const manifest: SceneManifest = {
      ...base,
      parts: [{ id: 'mito', nodes: 'Mitochondria', pick: 'select', select: 'each' }],
    } as SceneManifest;
    const r = resolveManifest(manifest, root, names);
    expect(r.partMeshes.get(partKey('mito', 'Mitochondrion.1'))).toBeDefined();
    expect(r.partMeshes.get(partKey('mito', 'Mitochondrion.2'))).toBeDefined();
  });

  it('deeper node wins over ancestor', () => {
    const { root, names } = makeScene();
    const manifest: SceneManifest = {
      ...base,
      parts: [
        { id: 'outer', nodes: 'Nucleus', pick: 'select' },
        { id: 'inner', nodes: 'Nucleolus', pick: 'select' },
      ],
    } as SceneManifest;
    const r = resolveManifest(manifest, root, names);
    const outer = r.partMeshes.get('outer') ?? [];
    const inner = r.partMeshes.get('inner') ?? [];
    expect(outer).toHaveLength(0);
    expect(inner.map((m) => m.name)).toEqual(['Nucleolus_mesh']);
  });

  it('ignore excludes a subtree', () => {
    const { root, names } = makeScene();
    const manifest: SceneManifest = {
      ...base,
      ignore: [{ match: '^Ribosomes$' }],
      parts: [{ id: 'all', nodes: { match: '^Root$' }, pick: 'select' }],
    } as SceneManifest;
    const r = resolveManifest(manifest, root, names);
    const meshes = r.partMeshes.get('all') ?? [];
    expect(meshes.map((m) => m.name).sort()).toEqual([
      'Mitochondrion.1_mesh',
      'Mitochondrion.2_mesh',
      'Nucleolus_mesh',
    ]);
  });
});
