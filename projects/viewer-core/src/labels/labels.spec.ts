import { describe, expect, it } from 'vitest';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  TorusGeometry,
  Vector3,
} from 'three';
import { resolveManifest } from '../manifest/resolve-selectors';
import type { SceneManifest } from '../manifest/schema';
import { resolveLabelAnchors, type LabelAnchor } from './label-anchors';
import { sampleSurfaceCandidates, CANDIDATE_COUNT } from './surface-points';
import { LabelTracker } from './project';

const VIEWPORT = { width: 800, height: 400 };

function makeMesh(name: string, x = 0, y = 0, z = 0, opacity = 1): Mesh {
  const material = new MeshBasicMaterial({ transparent: opacity < 1, opacity });
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  return mesh;
}

function namedGroup(name: string, ...meshes: Mesh[]): Group {
  const g = new Group();
  g.name = name;
  g.add(...meshes);
  return g;
}

function sceneWith(build: (root: Group) => void): { root: Group; names: Map<Object3D, string> } {
  const root = new Group();
  root.name = 'Root';
  build(root);
  const names = new Map<Object3D, string>();
  root.traverse((o) => names.set(o, o.name));
  return { root, names };
}

function cameraAt(z = 10): PerspectiveCamera {
  const cam = new PerspectiveCamera(45, VIEWPORT.width / VIEWPORT.height, 0.1, 100);
  cam.position.set(0, 0, z);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

function anchorsFor(manifest: SceneManifest, root: Group, names: Map<Object3D, string>) {
  const resolved = resolveManifest(manifest, root, names);
  return resolveLabelAnchors(manifest, resolved, root);
}

/** Трекер без окклюдеров: якоря с явными кандидатами. */
function trackerWith(
  candidates: [number, number, number][],
  opts: { meshes?: Mesh[]; root?: Group; isSeeThrough?: (m: Mesh) => boolean } = {},
) {
  const root = opts.root ?? new Group();
  const anchor: LabelAnchor = {
    key: 'a',
    partId: 'a',
    point: null,
    candidates: candidates.map((c) => new Vector3(...c)),
    meshes: opts.meshes ?? [],
  };
  const tracker = new LabelTracker([anchor], {
    root,
    isSeeThrough: opts.isSeeThrough ?? (() => false),
  });
  return tracker;
}

describe('resolveLabelAnchors', () => {
  it('часть без label и часть с label.hidden не получают якорей', () => {
    const { root, names } = sceneWith((r) => {
      r.add(namedGroup('A', makeMesh('A_mesh')));
      r.add(namedGroup('B', makeMesh('B_mesh')));
      r.add(namedGroup('C', makeMesh('C_mesh')));
    });
    const manifest = {
      schemaVersion: 1,
      id: 't',
      model: { url: 'x' },
      parts: [
        { id: 'a', nodes: 'A', label: { anchor: 'auto' } },
        { id: 'b', nodes: 'B', label: { hidden: true } },
        { id: 'c', nodes: 'C' },
      ],
    } as unknown as SceneManifest;
    const anchors = anchorsFor(manifest, root, names);
    expect(anchors.map((a) => a.partId)).toEqual(['a']);
    expect(anchors[0].point).toBeNull();
    expect(anchors[0].candidates!.length).toBeGreaterThan(1);
    expect(anchors[0].meshes.map((m) => m.name)).toEqual(['A_mesh']);
  });

  it('label.anchor: [x,y,z] — явная точка, без кандидатов', () => {
    const { root, names } = sceneWith((r) => r.add(namedGroup('A', makeMesh('A_mesh'))));
    const manifest = {
      schemaVersion: 1,
      id: 't',
      model: { url: 'x' },
      parts: [{ id: 'a', nodes: 'A', label: { anchor: [1, 2, 3] } }],
    } as unknown as SceneManifest;
    const anchors = anchorsFor(manifest, root, names);
    expect(anchors[0].point).toEqual(new Vector3(1, 2, 3));
    expect(anchors[0].candidates).toBeNull();
  });

  it('select: "each" — label.instance выбирает экземпляр, по умолчанию первый; each: true — все', () => {
    const { root, names } = sceneWith((r) => {
      r.add(namedGroup('Mito', makeMesh('m1', -3), makeMesh('m2', 3)));
    });
    const base = { schemaVersion: 1, id: 't', model: { url: 'x' } };
    const one = {
      ...base,
      parts: [{ id: 'mito', nodes: 'Mito', select: 'each', label: { instance: 'm2' } }],
    } as unknown as SceneManifest;
    const anchors = anchorsFor(one, root, names);
    expect(anchors.map((a) => a.key)).toEqual(['mito::m2']);
    expect(anchors[0].instance).toBe('m2');
    expect(anchors[0].meshes.map((m) => m.name)).toEqual(['m2']);
    expect(anchors[0].candidates!.length).toBeGreaterThan(1);

    const all = {
      ...base,
      parts: [{ id: 'mito', nodes: 'Mito', select: 'each', label: { each: true } }],
    } as unknown as SceneManifest;
    expect(anchorsFor(all, root, names).map((a) => a.key)).toEqual(['mito::m1', 'mito::m2']);
  });
});

describe('sampleSurfaceCandidates', () => {
  it('кандидаты — вершины на поверхности, метод дальнейшей точки даёт равномерный разброс', () => {
    const mesh = new Mesh(new TorusGeometry(2, 0.5, 12, 32), new MeshBasicMaterial());
    const root = new Group();
    root.add(mesh);
    root.updateMatrixWorld(true);
    const candidates = sampleSurfaceCandidates([mesh], root);
    expect(candidates.length).toBe(CANDIDATE_COUNT);
    for (const c of candidates) {
      // все кандидаты лежат на поверхности тора: радиус от оси ≈ 2 (± толщина 0.5)
      const radial = Math.hypot(c.x, c.y);
      expect(Math.abs(radial - 2)).toBeLessThanOrEqual(0.5);
    }
    // разброс: нет двух почти совпадающих кандидатов
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        expect(candidates[i].distanceTo(candidates[j])).toBeGreaterThan(0.5);
      }
    }
  });
});

describe('LabelTracker — часть-кольцо', () => {
  const ringManifest = {
    schemaVersion: 1,
    id: 't',
    model: { url: 'x' },
    parts: [{ id: 'ring', nodes: 'Ring', label: { anchor: 'auto' } }],
  } as unknown as SceneManifest;

  function ringScene() {
    // Тор в плоскости XY — камера смотрит на «кольцо» с отверстием в центре
    const ring = new Mesh(new TorusGeometry(2, 0.5, 12, 32), new MeshBasicMaterial());
    ring.name = 'Ring_mesh';
    const root = new Group();
    root.name = 'Root';
    root.add(namedGroup('Ring', ring));
    const names = new Map<Object3D, string>();
    root.traverse((o) => names.set(o, o.name));
    return { root, names };
  }

  it('якорь лежит на поверхности кольца, а не в центре габаритов', () => {
    const { root, names } = ringScene();
    root.updateMatrixWorld(true);
    const anchors = anchorsFor(ringManifest, root, names);
    const tracker = new LabelTracker(anchors, { root, isSeeThrough: () => false });
    const cam = cameraAt(12);
    const [label] = tracker.update(cam, VIEWPORT, 0, true);
    // центр габаритов — (0,0,0), он в «дырке» кольца; проецируется в центр кадра
    expect(label.visible).toBe(true);
    // якорь НЕ в центре кадра: точка смещена на поверхность кольца
    const offCenter = Math.hypot(label.x - VIEWPORT.width / 2, label.y - VIEWPORT.height / 2);
    expect(offCenter).toBeGreaterThan(20);
    // мировая точка якоря — на поверхности тора (радиус от оси ≈ 2)
    const st = (tracker as unknown as { states: Map<string, { current: number; world: Vector3[] }> }).states.get('ring')!;
    const p = st.world[st.current];
    expect(Math.abs(Math.hypot(p.x, p.y) - 2)).toBeLessThanOrEqual(0.5);
  });
});

describe('LabelTracker — выбор кандидата', () => {
  it('новый кандидат заменяет текущего только после гистерезиса (~300 мс)', () => {
    // Центр части — проекция начала координат (мешей нет).
    const tracker = trackerWith([
      [0.5, 0, 0], // A — ближе к центру при стартовой камере
      [2, 0, 5], // B — на пути камеры; при сдвиге камеры встанет в центр
    ]);
    const cam = cameraAt();
    let [label] = tracker.update(cam, VIEWPORT, 0, true);
    expect(label.x).toBeCloseTo(424.14, 0); // кандидат A (≈24 px от центра)

    // Камера смещается на (4,0,10): луч «камера → центр» проходит через B,
    // B попадает в экранный центр части — «заметно лучше» A.
    const cam2 = new PerspectiveCamera(45, VIEWPORT.width / VIEWPORT.height, 0.1, 100);
    cam2.position.set(4, 0, 10);
    cam2.lookAt(0, 0, 0);
    cam2.updateMatrixWorld(true);
    const projX = (x: number, z: number) => {
      const v = new Vector3(x, 0, z).project(cam2);
      return ((v.x + 1) / 2) * VIEWPORT.width;
    };

    [label] = tracker.update(cam2, VIEWPORT, 1000, false);
    expect(label.x).toBeCloseTo(projX(0.5, 0), 0); // гистерезис: ещё кандидат A
    [label] = tracker.update(cam2, VIEWPORT, 1400, false);
    expect(label.x).toBeCloseTo(projX(2, 5), 0); // прошло ≥300 мс — кандидат B
  });

  it('если текущий кандидат закрыт — смена немедленная', () => {
    const { root } = sceneWith((r) => {
      // Блокер изначально в стороне от луча
      r.add(namedGroup('Blocker', makeMesh('Blocker_mesh', 10, 10, 5)));
    });
    const blockerMesh = root.children[0].children[0] as Mesh;
    const tracked = makeMesh('A_mesh', 0.5, 0, 0);
    root.add(namedGroup('A', tracked));
    root.updateMatrixWorld(true);
    const anchor: LabelAnchor = {
      key: 'a',
      partId: 'a',
      point: null,
      candidates: [new Vector3(0.5, 0, 0), new Vector3(-4, 0, 0)],
      meshes: [tracked],
    };
    const tracker = new LabelTracker([anchor], { root, isSeeThrough: () => false });
    const cam = cameraAt();
    let [label] = tracker.update(cam, VIEWPORT, 0, true);
    const firstX = label.x; // кандидат 0 (~24 px от центра)

    // Блокер перед кандидатом 0: после refresh он не виден → немедленный переход к 1
    blockerMesh.position.set(0.5, 0, 5);
    root.updateMatrixWorld(true);
    [label] = tracker.update(cam, VIEWPORT, 100, true);
    expect(label.x).not.toBe(firstX);
    expect(label.occluded).toBe(false);
  });
});

describe('LabelTracker — окклюзия', () => {
  function sceneWithBlocker(transparent: boolean) {
    const { root } = sceneWith((r) => {
      r.add(namedGroup('Back', makeMesh('Back_mesh', 0, 0, -3)));
      r.add(
        namedGroup(
          'Blocker',
          makeMesh('Blocker_mesh', 0, 0, 0, transparent ? 0.35 : 1),
        ),
      );
    });
    root.updateMatrixWorld(true);
    const anchor: LabelAnchor = {
      key: 'back',
      partId: 'back',
      point: new Vector3(0, 0, -3),
      candidates: null,
      meshes: [root.children[0].children[0] as Mesh],
    };
    return { root, anchor };
  }

  it('непрозрачный меш перед частью окклюдит якорь', () => {
    const { root, anchor } = sceneWithBlocker(false);
    const tracker = new LabelTracker([anchor], { root, isSeeThrough: () => false });
    let [label] = tracker.update(cameraAt(), VIEWPORT, 0, true);
    expect(label.visible).toBe(true);
    expect(label.occluded).toBe(false); // первая проверка — ещё не подтверждена
    [label] = tracker.update(cameraAt(), VIEWPORT, 200, true);
    expect(label.occluded).toBe(true); // вторая подряд — подтвердилось
  });

  it('смена состояния окклюзии — только после двух одинаковых проверок подряд', () => {
    const { root, anchor } = sceneWithBlocker(false);
    const blocker = root.children[1].children[0] as Mesh;
    const tracker = new LabelTracker([anchor], { root, isSeeThrough: () => false });
    const cam = cameraAt();

    // Первая проверка: raw = true, но подтверждённое значение ещё false
    let [label] = tracker.update(cam, VIEWPORT, 0, true);
    expect(label.occluded).toBe(false);
    // Вторая подряд: подтвердилось
    [label] = tracker.update(cam, VIEWPORT, 200, true);
    expect(label.occluded).toBe(true);

    // Блокер убрали: первая проверка raw = false — ещё мигание не подтверждено
    blocker.visible = false;
    [label] = tracker.update(cam, VIEWPORT, 400, true);
    expect(label.occluded).toBe(true);
    [label] = tracker.update(cam, VIEWPORT, 600, true);
    expect(label.occluded).toBe(false);
  });

  it('«прозрачность насквозь» определяется переданным предикатом (baseline манифеста)', () => {
    const { root, anchor } = sceneWithBlocker(false);
    const blocker = root.children[1].children[0] as Mesh;
    // Предикат из baseline: блокер полупрозрачен по манифесту → не окклюдит,
    // хотя текущий материал непрозрачен (или наоборот — приглушение изоляцией).
    const tracker = new LabelTracker([anchor], {
      root,
      isSeeThrough: (m) => m === blocker,
    });
    const [label] = tracker.update(cameraAt(), VIEWPORT, 0, true);
    expect(label.occluded).toBe(false);
  });

  it('якорь за камерой — visible: false', () => {
    const { root, anchor } = sceneWithBlocker(false);
    anchor.point = new Vector3(0, 0, 25);
    const tracker = new LabelTracker([anchor], { root, isSeeThrough: () => false });
    const [label] = tracker.update(cameraAt(), VIEWPORT, 0, true);
    expect(label.visible).toBe(false);
  });

  it('пересчёт окклюзии только по запросу (refreshOcclusion)', () => {
    const { root, anchor } = sceneWithBlocker(false);
    const blocker = root.children[1].children[0] as Mesh;
    const tracker = new LabelTracker([anchor], { root, isSeeThrough: () => false });
    const cam = cameraAt();
    tracker.update(cam, VIEWPORT, 0, true);
    tracker.update(cam, VIEWPORT, 200, true); // подтверждено occluded=true
    blocker.visible = false;
    // Без refresh блокер «всё ещё закрывает» — кэш не пересчитывался
    const [label] = tracker.update(cam, VIEWPORT, 400, false);
    expect(label.occluded).toBe(true);
  });
});
