import { describe, expect, it } from 'vitest';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
} from 'three';
import { pickPart } from './raycast';
import { resolveManifest } from '../manifest/resolve-selectors';
import type { PickMode, SceneManifest } from '../manifest/schema';

function makeMesh(name: string, z: number): Mesh {
  const m = new Mesh(new BoxGeometry(1, 1, 0.1), new MeshBasicMaterial());
  m.name = name;
  m.position.set(0, 0, z);
  return m;
}

function sceneWith(nodes: { group: string; z: number; instances?: string[] }[]): {
  root: Group;
  names: Map<Object3D, string>;
} {
  const root = new Group();
  root.name = 'Root';
  const names = new Map<Object3D, string>();
  for (const n of nodes) {
    const g = new Group();
    g.name = n.group;
    if (n.instances) {
      for (const inst of n.instances) {
        const child = new Group();
        child.name = inst;
        child.add(makeMesh(`${inst}_mesh`, n.z));
        g.add(child);
      }
    } else {
      g.add(makeMesh(`${n.group}_mesh`, n.z));
    }
    root.add(g);
  }
  const assign = (o: Object3D) => {
    names.set(o, o.name);
    o.children.forEach(assign);
  };
  assign(root);
  return { root, names };
}

function cameraLookingAtOrigin(): PerspectiveCamera {
  const cam = new PerspectiveCamera(45, 1, 0.1, 100);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

function picker(manifest: SceneManifest, root: Object3D, names: Map<Object3D, string>) {
  const r = resolveManifest(manifest, root, names);
  const pickModes = new Map(
    manifest.parts.map((p) => [p.id, (p.pick ?? manifest.defaults?.pick ?? 'block') as PickMode]),
  );
  const cam = cameraLookingAtOrigin();
  root.updateMatrixWorld(true);
  return () =>
    pickPart(root, cam, 0, 0, r.meshBindings, r.defaults.pick, (id) => pickModes.get(id) ?? 'block');
}

describe('pickPart', () => {
  it('select returns the nearest matching part', () => {
    const { root, names } = sceneWith([{ group: 'A', z: 2 }]);
    const manifest = {
      schemaVersion: 1,
      id: 't',
      model: { url: 'x' },
      parts: [{ id: 'a', nodes: 'A', pick: 'select' }],
    } as SceneManifest;
    const hit = picker(manifest, root, names)();
    expect(hit?.partId).toBe('a');
  });

  it('pass skips to the next intersection', () => {
    const { root, names } = sceneWith([
      { group: 'Front', z: 2 },
      { group: 'Back', z: -2 },
    ]);
    const manifest = {
      schemaVersion: 1,
      id: 't',
      model: { url: 'x' },
      parts: [
        { id: 'front', nodes: 'Front', pick: 'pass' },
        { id: 'back', nodes: 'Back', pick: 'select' },
      ],
    } as SceneManifest;
    const hit = picker(manifest, root, names)();
    expect(hit?.partId).toBe('back');
  });

  it('block stops the ray even if there is a selectable behind', () => {
    const { root, names } = sceneWith([
      { group: 'Front', z: 2 },
      { group: 'Back', z: -2 },
    ]);
    const manifest = {
      schemaVersion: 1,
      id: 't',
      model: { url: 'x' },
      parts: [
        { id: 'front', nodes: 'Front', pick: 'block' },
        { id: 'back', nodes: 'Back', pick: 'select' },
      ],
    } as SceneManifest;
    const hit = picker(manifest, root, names)();
    expect(hit).toBeNull();
  });

  it('select: "each" returns distinct instance for different children', () => {
    const { root, names } = sceneWith([
      { group: 'Mitochondria', z: 2, instances: ['Mitochondrion.1'] },
    ]);
    const manifest = {
      schemaVersion: 1,
      id: 't',
      model: { url: 'x' },
      parts: [{ id: 'mito', nodes: 'Mitochondria', pick: 'select', select: 'each' }],
    } as SceneManifest;
    const hit = picker(manifest, root, names)();
    expect(hit?.partId).toBe('mito');
    expect(hit?.instance).toBe('Mitochondrion.1');
  });

  it('unbound mesh with defaults.pick=block returns null', () => {
    const { root, names } = sceneWith([
      { group: 'Front', z: 2 },
      { group: 'Back', z: -2 },
    ]);
    const manifest = {
      schemaVersion: 1,
      id: 't',
      model: { url: 'x' },
      defaults: { pick: 'block' },
      parts: [{ id: 'back', nodes: 'Back', pick: 'select' }],
    } as SceneManifest;
    const hit = picker(manifest, root, names)();
    expect(hit).toBeNull();
  });
});
