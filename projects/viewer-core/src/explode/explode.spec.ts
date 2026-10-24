import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Vector3 } from 'three';
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
 * Модель: «оболочка» 10×10×10 (радиус описанной сферы √75 ≈ 8.66) и части
 * со своими узлами; `child` (с with) — отдельный узел, не вложенный.
 */
function makeModel() {
  const root = new Group();
  const shell = makePartNode(0, 0, 0, 10);
  const a = makePartNode(2, 0, 0);
  const b = makePartNode(0, 3, 0);
  const parent = makePartNode(-2, 0, 0);
  const child = makePartNode(0, 0, 4);
  root.add(shell, a, b, parent, child);
  const partRoots = new Map<string, Object3D[]>([
    ['shell', [shell]],
    ['a', [a]],
    ['b', [b]],
    ['parent', [parent]],
    ['child', [child]],
  ]);
  return { root, shell, a, b, parent, child, partRoots };
}

const PARTS: PartDef[] = [
  part('shell', { stay: true }),
  part('a', { order: 1 }),
  part('b', { order: 2 }),
  part('child', { with: 'a' }),
  part('parent', { order: 3, direction: [0, -1, 0] }),
];

// R = √75 ≈ 8.660254, зазор = R·0.25, первый слой на расстоянии R + зазор.
const R = Math.sqrt(75);
const GAP = R * 0.25;
const FIRST_DIST = R + GAP;

function run(anim: ExplodeAnimator, maxFrames = 1000): void {
  let n = 0;
  while (anim.update(1 / 60) && n++ < maxFrames) {
    // сближение к цели
  }
}

describe('computeExplodeTargets', () => {
  it('смещает часть радиально от центра модели на расстояние слоя', () => {
    const { root, partRoots } = makeModel();
    const targets = computeExplodeTargets(PARTS, partRoots, root);
    const d = targets.get('a')!;
    // часть `a` в (2,0,0): направление +X, целевой центр на FIRST_DIST от центра
    expect(d.x).toBeCloseTo(FIRST_DIST - 2, 3);
    expect(Math.abs(d.y)).toBeLessThan(1e-6);
    expect(Math.abs(d.z)).toBeLessThan(1e-6);
  });

  it('часть с большим order дальше от центра модели', () => {
    const { root, partRoots, a, b } = makeModel();
    const targets = computeExplodeTargets(PARTS, partRoots, root);
    const centerA = a.position.clone().add(targets.get('a')!);
    const centerB = b.position.clone().add(targets.get('b')!);
    expect(centerB.length()).toBeGreaterThan(centerA.length());
  });

  it('stay и части без explode остаются на месте', () => {
    const { root, partRoots } = makeModel();
    const targets = computeExplodeTargets(PARTS, partRoots, root);
    expect(targets.has('shell')).toBe(false);
    const noExplode: PartDef[] = [part('a', undefined), part('shell', { stay: true })];
    const t2 = computeExplodeTargets(noExplode, partRoots, root);
    expect(t2.size).toBe(0);
  });

  it('with: часть едет вместе с указанной (своей позиции не получает)', () => {
    const { root, partRoots } = makeModel();
    const targets = computeExplodeTargets(PARTS, partRoots, root);
    expect(targets.get('child')!.distanceTo(targets.get('a')!)).toBeLessThan(1e-9);
  });

  it('direction переопределяет радиальное направление', () => {
    const { root, partRoots } = makeModel();
    const targets = computeExplodeTargets(PARTS, partRoots, root);
    const d = targets.get('parent')!;
    expect(d.y).toBeLessThan(-R); // уходит вниз минимум на радиус модели
    expect(Math.abs(d.z)).toBeLessThan(1e-6);
  });

  it('offset задаёт расстояние от центра явно', () => {
    const { root, partRoots, a } = makeModel();
    const parts = [part('a', { direction: [0, -1, 0], offset: 20 })];
    const targets = computeExplodeTargets(parts, partRoots, root);
    // целевой центр = (0,-20,0), часть в (2,0,0)
    const d = targets.get('a')!;
    expect(a.position.clone().add(d).y).toBeCloseTo(-20, 6);
    expect(d.x).toBeCloseTo(-2, 6);
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
    const er = makePartNode(2, 0, 0);
    const ribosomes = makePartNode(0.3, 0.2, 0);
    er.add(ribosomes);
    root.add(er);
    const partRoots = new Map<string, Object3D[]>([
      ['rough-er', [er]],
      ['ribosomes', [ribosomes]],
    ]);
    const parts = [part('rough-er', { order: 1 }), part('ribosomes', { with: 'rough-er' })];
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
});

describe('ExplodeAnimator', () => {
  function makeAnimator(reduced = false) {
    const { root, partRoots, a, b, shell } = makeModel();
    const targets = computeExplodeTargets(PARTS, partRoots, root);
    const bindings = buildExplodeBindings(targets, partRoots, root);
    const anim = new ExplodeAnimator(targets, bindings);
    anim.setReducedMotion(reduced);
    return { anim, targets, a, b, shell };
  }

  it('полный цикл туда-обратно возвращает узлы в исходные позиции', () => {
    const { anim, a, b } = makeAnimator();
    const origA = a.position.clone();
    const origB = b.position.clone();
    anim.setExploded(true);
    run(anim);
    expect(a.position.distanceTo(origA)).toBeGreaterThan(1);
    anim.setExploded(false);
    run(anim);
    expect(a.position.distanceTo(origA)).toBeLessThan(1e-6);
    expect(b.position.distanceTo(origB)).toBeLessThan(1e-6);
  });

  it('прерывание на середине: обратный ход от текущей позиции к исходной', () => {
    const { anim, a } = makeAnimator();
    const orig = a.position.clone();
    anim.setExploded(true);
    anim.update(1 / 60);
    anim.update(1 / 60);
    const mid = a.position.clone();
    const moved = mid.distanceTo(orig);
    expect(moved).toBeGreaterThan(1e-3);
    expect(moved).toBeLessThan(FIRST_DIST - 2); // ещё не доехала до цели
    anim.setExploded(false);
    run(anim);
    expect(a.position.distanceTo(orig)).toBeLessThan(1e-6);
  });

  it('prefers-reduced-motion: переход мгновенный, update не анимирует', () => {
    const { anim, a } = makeAnimator(true);
    const orig = a.position.clone();
    anim.setExploded(true);
    expect(a.position.distanceTo(orig)).toBeGreaterThan(1);
    expect(anim.update(1 / 60)).toBe(false);
  });

  it('позиции всегда от исходных: повторные переключения не накапливают смещение', () => {
    const { anim, a } = makeAnimator();
    const orig = a.position.clone();
    for (let i = 0; i < 3; i++) {
      anim.setExploded(true);
      run(anim);
      anim.setExploded(false);
      run(anim);
    }
    expect(a.position.distanceTo(orig)).toBeLessThan(1e-6);
  });

  it('currentOffset: stay-часть — null, после раскрытия — целевое смещение', () => {
    const { anim, targets } = makeAnimator();
    expect(anim.currentOffset('shell')).toBeNull();
    expect(anim.currentOffset('a')!.length()).toBeLessThan(1e-6);
    anim.setExploded(true);
    run(anim);
    expect(anim.currentOffset('a')!.distanceTo(targets.get('a')!)).toBeLessThan(1e-6);
  });
});
