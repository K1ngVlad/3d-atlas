import { describe, expect, it } from 'vitest';
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Vector3 } from 'three';
import type { PartDef } from '../manifest/schema';
import {
  buildExplodeBindings,
  computeExplodeTargets,
  ExplodeAnimator,
} from './explode';

function makePartNode(x: number, y: number, z: number, size = 1): Group {
  const g = new Group();
  g.add(new Mesh(new BoxGeometry(size, size, size), new MeshBasicMaterial()));
  g.position.set(x, y, z);
  return g;
}

function part(id: string, explode: PartDef['explode']): PartDef {
  return { id, nodes: id, explode } as PartDef;
}

/**
 * «Клетка»: неподвижная оболочка 10×10×10 и части-«органоиды» без `direction`
 * — в расслоении выстраиваются в столбец справа от модели. У `child` —
 * `with`, узел отдельный (не вложенный).
 */
function makeCellModel() {
  const root = new Group();
  const shell = makePartNode(0, 0, 0, 10);
  const nucleus = makePartNode(0.5, 0.2, 0, 2);
  const er = makePartNode(-0.3, -0.1, 0.2, 3);
  const child = makePartNode(1, 1, 1, 0.5);
  root.add(shell, nucleus, er, child);
  const partRoots = new Map<string, Object3D[]>([
    ['shell', [shell]],
    ['nucleus', [nucleus]],
    ['er', [er]],
    ['child', [child]],
  ]);
  return { root, shell, nucleus, er, child, partRoots };
}

const CELL_PARTS: PartDef[] = [
  part('shell', { stay: true }),
  part('nucleus', { order: 1 }),
  part('er', { order: 2 }),
  part('child', { with: 'nucleus' }),
];

/** Габариты части после применения смещения (модельные координаты). */
function placedBounds(node: Object3D, d: Vector3): Box3 {
  return new Box3().setFromObject(node).translate(d);
}

describe('computeExplodeTargets — столбец (решение 34)', () => {
  it('части без direction встают в столбец сбоку от модели, сверху вниз по order', () => {
    const { root, partRoots } = makeCellModel();
    const targets = computeExplodeTargets(CELL_PARTS, partRoots, root);
    // Столбец по +X: за гранью модели (max.x = 5) плюс зазор и половина ширины части
    const tNucleus = targets.get('nucleus')!;
    const tEr = targets.get('er')!;
    const modelMaxX = 5;
    expect(placedBounds(partRoots.get('nucleus')![0], tNucleus).min.x).toBeGreaterThan(modelMaxX);
    // Порядок сверху вниз: nucleus (order 1) выше er (order 2)
    const cN = placedBounds(partRoots.get('nucleus')![0], tNucleus).getCenter(new Vector3());
    const cE = placedBounds(partRoots.get('er')![0], tEr).getCenter(new Vector3());
    expect(cN.y).toBeGreaterThan(cE.y);
  });

  it('у ядра и шероховатого ЭПР разные места (roadmap)', () => {
    const { root, partRoots } = makeCellModel();
    const targets = computeExplodeTargets(CELL_PARTS, partRoots, root);
    const a = targets.get('nucleus')!;
    const b = targets.get('er')!;
    expect(a.distanceTo(b)).toBeGreaterThan(1e-3);
  });

  it('габариты частей в столбце не пересекаются (roadmap)', () => {
    const { root, partRoots } = makeCellModel();
    const targets = computeExplodeTargets(CELL_PARTS, partRoots, root);
    const bN = placedBounds(partRoots.get('nucleus')![0], targets.get('nucleus')!);
    const bE = placedBounds(partRoots.get('er')![0], targets.get('er')!);
    // nucleus (order 1) выше er (order 2): границы по оси столбца непересекающиеся
    expect(bE.max.y).toBeLessThanOrEqual(bN.min.y + 1e-9);
    expect(bN.intersectsBox(bE)).toBe(false);
  });

  it('with: часть едет вместе с указанной (своего места не получает)', () => {
    const { root, partRoots } = makeCellModel();
    const targets = computeExplodeTargets(CELL_PARTS, partRoots, root);
    expect(targets.get('child')!.distanceTo(targets.get('nucleus')!)).toBeLessThan(1e-9);
  });

  it('stay и части без explode остаются на месте', () => {
    const { root, partRoots } = makeCellModel();
    const targets = computeExplodeTargets(CELL_PARTS, partRoots, root);
    expect(targets.has('shell')).toBe(false);
    const noExplode: PartDef[] = [part('nucleus', undefined), part('shell', { stay: true })];
    expect(computeExplodeTargets(noExplode, partRoots, root).size).toBe(0);
  });
});

/**
 * «Митохондрия»: неподвижное основание и стопки по `direction` вверх/вниз —
 * друг за другом от габаритов базы с равными зазорами.
 */
function makeMitoModel() {
  const root = new Group();
  const base = makePartNode(0, 0, 0, 4); // y ∈ [-2, 2]
  const up1 = makePartNode(0, 0.2, 0, 1);
  const up2 = makePartNode(0, 0.4, 0, 1.5);
  const down1 = makePartNode(0, -0.2, 0, 1);
  root.add(base, up1, up2, down1);
  const partRoots = new Map<string, Object3D[]>([
    ['base', [base]],
    ['up1', [up1]],
    ['up2', [up2]],
    ['down1', [down1]],
  ]);
  return { root, base, up1, up2, down1, partRoots };
}

const MITO_PARTS: PartDef[] = [
  part('base', { stay: true }),
  part('up1', { order: 1, direction: [0, 1, 0] }),
  part('up2', { order: 2, direction: [0, 1, 0] }),
  part('down1', { order: 1, direction: [0, -1, 0] }),
];

describe('computeExplodeTargets — стопки по direction (решение 34)', () => {
  it('части выкладываются от габаритов неподвижных частей наружу', () => {
    const { root, partRoots, base, up1 } = makeMitoModel();
    const targets = computeExplodeTargets(MITO_PARTS, partRoots, root);
    const bBase = new Box3().setFromObject(base);
    const bUp1 = placedBounds(up1, targets.get('up1')!);
    expect(bUp1.min.y).toBeGreaterThan(bBase.max.y);
    // Вниз — симметрично: down1 оказывается строго под базой
    const { root: r2, partRoots: pr2, base: b2, down1: d1 } = makeMitoModel();
    const t2 = computeExplodeTargets(MITO_PARTS, pr2, r2);
    const bDown = placedBounds(d1, t2.get('down1')!);
    expect(bDown.max.y).toBeLessThan(new Box3().setFromObject(b2).min.y);
  });

  it('зазоры между соседними слоями равны (±10 %, roadmap)', () => {
    const { root, partRoots, base, up1, up2 } = makeMitoModel();
    const targets = computeExplodeTargets(MITO_PARTS, partRoots, root);
    const bBase = new Box3().setFromObject(base);
    const b1 = placedBounds(up1, targets.get('up1')!);
    const b2 = placedBounds(up2, targets.get('up2')!);
    const gap0 = b1.min.y - bBase.max.y;
    const gap1 = b2.min.y - b1.max.y;
    expect(gap0).toBeGreaterThan(0);
    expect(Math.abs(gap1 - gap0) / gap0).toBeLessThan(0.1);
  });

  it('offset задаёт расстояние от исходного положения вдоль направления', () => {
    const root = new Group();
    const base = makePartNode(0, 0, 0, 2);
    const a = makePartNode(0, 0.5, 0, 1);
    root.add(base, a);
    const partRoots = new Map<string, Object3D[]>([
      ['base', [base]],
      ['a', [a]],
    ]);
    const parts = [part('base', { stay: true }), part('a', { direction: [0, 1, 0], offset: 5 })];
    const targets = computeExplodeTargets(parts, partRoots, root);
    expect(targets.get('a')!.x).toBeCloseTo(0, 6);
    expect(targets.get('a')!.y).toBeCloseTo(5, 6);
    expect(targets.get('a')!.z).toBeCloseTo(0, 6);
  });

  it('explodeLayout.side переопределяет сторону столбца', () => {
    const { root, partRoots } = makeCellModel();
    const targets = computeExplodeTargets(CELL_PARTS, partRoots, root, { side: [-1, 0, 0] });
    const bN = placedBounds(partRoots.get('nucleus')![0], targets.get('nucleus')!);
    expect(bN.max.x).toBeLessThan(-5); // столбец слева
  });
});

describe('buildExplodeBindings', () => {
  it('узел внутри смещаемого корня другой части пропускается — едет с предком', () => {
    const root = new Group();
    const outer = makePartNode(3, 0, 0);
    const inner = makePartNode(0, 0.5, 0);
    outer.add(inner);
    root.add(outer);
    const partRoots = new Map<string, Object3D[]>([
      ['outer', [outer]],
      ['inner', [inner]],
    ]);
    const parts = [part('outer', { order: 1 }), part('inner', { order: 2 })];
    const targets = computeExplodeTargets(parts, partRoots, root);
    const bindings = buildExplodeBindings(targets, partRoots, root);
    expect(bindings.has(outer)).toBe(true);
    expect(bindings.has(inner)).toBe(false);
  });

  it('with-часть внутри смещаемого предка едет ровно на его смещение (без двойного сдвига)', () => {
    // Сценарий клетки: рибосомы (with: "rough-er") лежат внутри узла RoughER.
    const root = new Group();
    const shell = makePartNode(0, 0, 0, 10);
    const er = makePartNode(2, 0, 0);
    const ribosomes = makePartNode(0.3, 0.2, 0);
    er.add(ribosomes);
    root.add(shell, er);
    const partRoots = new Map<string, Object3D[]>([
      ['shell', [shell]],
      ['rough-er', [er]],
      ['ribosomes', [ribosomes]],
    ]);
    const parts = [part('shell', { stay: true }), part('rough-er', { order: 1 }), part('ribosomes', { with: 'rough-er' })];
    const targets = computeExplodeTargets(parts, partRoots, root);
    const bindings = buildExplodeBindings(targets, partRoots, root);
    expect(bindings.has(er)).toBe(true);
    expect(bindings.has(ribosomes)).toBe(false);
    const anim = new ExplodeAnimator(targets, bindings);
    anim.setReducedMotion(true);
    anim.setExploded(true);
    root.updateMatrixWorld(true);
    const ribWorld = ribosomes.getWorldPosition(new Vector3());
    const orig = new Vector3(2.3, 0.2, 0);
    expect(ribWorld.sub(orig).distanceTo(targets.get('rough-er')!)).toBeLessThan(1e-6);
  });

  it('повёрнутый родитель: смещение direction не разворачивается (roadmap, ошибка матрицы)', () => {
    const root = new Group();
    const base = makePartNode(0, 0, 0, 4); // y ∈ [-2, 2] — неподвижная база
    const parent = new Group();
    parent.rotation.z = Math.PI / 2; // повёрнутый предок (как Sketchfab_model с −90° по X)
    parent.position.set(0, 2.7, 0); // часть чуть выше базы: её слот в стопке — ещё выше
    const node = makePartNode(0, 0, 0, 1);
    parent.add(node);
    root.add(base, parent);
    const partRoots = new Map<string, Object3D[]>([
      ['base', [base]],
      ['moving', [node]],
    ]);
    const parts = [part('base', { stay: true }), part('moving', { direction: [0, 1, 0] })];
    const targets = computeExplodeTargets(parts, partRoots, root);
    const bindings = buildExplodeBindings(targets, partRoots, root);
    const anim = new ExplodeAnimator(targets, bindings);
    anim.setReducedMotion(true);
    const before = node.getWorldPosition(new Vector3());
    anim.setExploded(true);
    root.updateMatrixWorld(true);
    const delta = node.getWorldPosition(new Vector3()).sub(before);
    // direction [0,1,0] в координатах модели — в мировых координатах часть
    // уезжает ВВЕРХ (нормальная матрица развернула бы направление вниз)
    expect(delta.y).toBeGreaterThan(0);
    expect(Math.abs(delta.x)).toBeLessThan(1e-9);
    expect(delta.distanceTo(targets.get('moving')!)).toBeLessThan(1e-6);
  });
});

describe('ExplodeAnimator', () => {
  function makeAnimator(reduced = false) {
    const { root, partRoots, nucleus, er, shell } = makeCellModel();
    const targets = computeExplodeTargets(CELL_PARTS, partRoots, root);
    const bindings = buildExplodeBindings(targets, partRoots, root);
    const anim = new ExplodeAnimator(targets, bindings);
    anim.setReducedMotion(reduced);
    return { anim, targets, nucleus, er, shell };
  }

  function run(anim: ExplodeAnimator, maxFrames = 1000): void {
    let n = 0;
    while (anim.update(1 / 60) && n++ < maxFrames) {
      // сближение к цели
    }
  }

  it('полный цикл туда-обратно возвращает узлы в исходные позиции', () => {
    const { anim, nucleus, er } = makeAnimator();
    const origA = nucleus.position.clone();
    const origB = er.position.clone();
    anim.setExploded(true);
    run(anim);
    expect(nucleus.position.distanceTo(origA)).toBeGreaterThan(1);
    anim.setExploded(false);
    run(anim);
    expect(nucleus.position.distanceTo(origA)).toBeLessThan(1e-6);
    expect(er.position.distanceTo(origB)).toBeLessThan(1e-6);
  });

  it('прерывание на середине: обратный ход от текущей позиции к исходной', () => {
    const { anim, targets, nucleus } = makeAnimator();
    const orig = nucleus.position.clone();
    anim.setExploded(true);
    anim.update(1 / 60);
    anim.update(1 / 60);
    const moved = nucleus.position.distanceTo(orig);
    expect(moved).toBeGreaterThan(1e-3);
    expect(moved).toBeLessThan(targets.get('nucleus')!.length()); // ещё не доехала до цели
    anim.setExploded(false);
    run(anim);
    expect(nucleus.position.distanceTo(orig)).toBeLessThan(1e-6);
  });

  it('prefers-reduced-motion: переход мгновенный, update не анимирует', () => {
    const { anim, nucleus } = makeAnimator(true);
    const orig = nucleus.position.clone();
    anim.setExploded(true);
    expect(nucleus.position.distanceTo(orig)).toBeGreaterThan(1);
    expect(anim.update(1 / 60)).toBe(false);
  });

  it('позиции всегда от исходных: повторные переключения не накапливают смещение', () => {
    const { anim, nucleus } = makeAnimator();
    const orig = nucleus.position.clone();
    for (let i = 0; i < 3; i++) {
      anim.setExploded(true);
      run(anim);
      anim.setExploded(false);
      run(anim);
    }
    expect(nucleus.position.distanceTo(orig)).toBeLessThan(1e-6);
  });

  it('currentOffset: stay-часть — null, после раскрытия — целевое смещение', () => {
    const { anim, targets } = makeAnimator();
    expect(anim.currentOffset('shell')).toBeNull();
    expect(anim.currentOffset('nucleus')!.length()).toBeLessThan(1e-6);
    anim.setExploded(true);
    run(anim);
    expect(anim.currentOffset('nucleus')!.distanceTo(targets.get('nucleus')!)).toBeLessThan(1e-6);
  });

  it('isDisplaced и factor — для пикинга pass-частей в расслоении', () => {
    const { anim } = makeAnimator();
    expect(anim.isDisplaced('nucleus')).toBe(true);
    expect(anim.isDisplaced('shell')).toBe(false);
    expect(anim.factor).toBe(0);
    anim.setExploded(true);
    run(anim);
    expect(anim.factor).toBe(1);
  });
});
