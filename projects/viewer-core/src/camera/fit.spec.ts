import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { resolveManifest } from '../manifest/resolve-selectors';
import { visibleBounds } from './fit';

function makeMesh(name: string): Mesh {
  const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  m.name = name;
  return m;
}

function makeScene() {
  // Корень-обёртка (как GLTF_SceneRootNode/Sketchfab_model в реальных моделях)
  // с двумя органоидами разного размера и положения.
  const root = new Group();
  root.name = 'Root';
  const names = new Map();
  const assign = (o: Group) => {
    names.set(o, o.name);
    o.children.forEach((c) => names.set(c, c.name));
  };

  const nucleus = new Group();
  nucleus.name = 'Nucleus';
  const nucleusMesh = makeMesh('Nucleus_mesh');
  nucleusMesh.scale.setScalar(2);
  nucleus.position.set(3, 0, 0);
  nucleus.add(nucleusMesh);

  const er = new Group();
  er.name = 'RoughER';
  const erMesh = makeMesh('RoughER_mesh');
  erMesh.scale.setScalar(10); // «вся клетка» — доминирует в габаритах модели
  er.add(erMesh);

  root.add(nucleus, er);
  assign(root);
  return { root, names: names as Map<Group, string> };
}

describe('visibleBounds', () => {
  it('без include — габариты всей модели', () => {
    const { root } = makeScene();
    const b = visibleBounds(root);
    // доминирует меш 10×10×10 в начале координат
    expect(b.getCenter(new Vector3()).length()).toBeLessThan(0.5);
    expect(b.max.x).toBeGreaterThan(4);
  });

  it('при include: центр габаритов — центр видимого (меши ядра), фон не учитывается', () => {
    // Тест roadmap: при include: ["Nucleus"] центр вписывания — центр ядра.
    const { root, names } = makeScene();
    const manifest = {
      schemaVersion: 1,
      id: 'stub',
      model: { url: 'x.glb' },
      include: 'Nucleus',
      parts: [{ id: 'nucleus', nodes: 'Nucleus', pick: 'select' }],
    } as never;
    resolveManifest(manifest, root, names as never);
    const b = visibleBounds(root);
    const center = b.getCenter(new Vector3());
    expect(center.x).toBeCloseTo(3, 5); // центр меша ядра, а не всей модели
    expect(center.y).toBeCloseTo(0, 5);
    expect(b.max.x).toBeLessThan(5); // ER (размером 10) в габариты не вошёл
  });

  it('невидимый предок отсекает всё поддерево', () => {
    const { root, names } = makeScene();
    const manifest = {
      schemaVersion: 1,
      id: 'stub',
      model: { url: 'x.glb' },
      include: 'Nucleus',
      parts: [{ id: 'nucleus', nodes: 'Nucleus', pick: 'select' }],
    } as never;
    resolveManifest(manifest, root, names as never);
    root.getObjectByName('Nucleus')!.visible = false;
    const b = visibleBounds(root);
    expect(b.isEmpty()).toBe(true);
  });
});
