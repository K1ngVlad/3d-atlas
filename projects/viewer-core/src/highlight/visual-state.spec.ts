import { describe, expect, it } from 'vitest';
import { Mesh, MeshStandardMaterial } from 'three';
import { VisualState } from './visual-state';

function makeMesh(opts: { opacity?: number; transparent?: boolean; depthWrite?: boolean } = {}): Mesh {
  const material = new MeshStandardMaterial({
    opacity: opts.opacity ?? 1,
    transparent: opts.transparent ?? false,
    depthWrite: opts.depthWrite ?? true,
  });
  return new Mesh(undefined, material);
}

describe('VisualState', () => {
  it('после update() opacity части с material.opacity равна значению из манифеста', () => {
    const mesh = makeMesh({ opacity: 1 });
    const visual = new VisualState(
      new Map([['cytoplasm', [mesh]]]),
      new Map([['cytoplasm', { opacity: 0.35 }]]),
    );
    visual.setTargets({ hover: null, selected: null, dimOthers: false });
    // большой dt → экспонента устаканивается за один шаг
    visual.update(10);
    const mat = mesh.material as MeshStandardMaterial;
    expect(mat.opacity).toBeCloseTo(0.35, 6);
    expect(mat.transparent).toBe(true);
  });

  it('instance-ключ наследует override от своей partId', () => {
    const mesh = makeMesh({ opacity: 1 });
    const visual = new VisualState(
      new Map([['mitochondria::Mitochondrion.1', [mesh]]]),
      new Map([['mitochondria', { opacity: 0.5 }]]),
    );
    visual.setTargets({ hover: null, selected: null, dimOthers: false });
    visual.update(10);
    expect((mesh.material as MeshStandardMaterial).opacity).toBeCloseTo(0.5, 6);
  });

  it('без override opacity остаётся исходной', () => {
    const mesh = makeMesh({ opacity: 1 });
    const visual = new VisualState(new Map([['nucleus', [mesh]]]));
    visual.setTargets({ hover: null, selected: null, dimOthers: false });
    visual.update(10);
    expect((mesh.material as MeshStandardMaterial).opacity).toBeCloseTo(1, 6);
  });

  it('при dim возвращается к baseline из override после снятия выделения', () => {
    const mesh = makeMesh({ opacity: 1 });
    const visual = new VisualState(
      new Map([
        ['nucleus', [makeMesh()]],
        ['cytoplasm', [mesh]],
      ]),
      new Map([['cytoplasm', { opacity: 0.35 }]]),
    );
    // выделен nucleus → cytoplasm должна быть приглушена (меньше 0.35)
    visual.setTargets({ hover: null, selected: 'nucleus', dimOthers: true });
    visual.update(10);
    const dimmed = (mesh.material as MeshStandardMaterial).opacity;
    expect(dimmed).toBeLessThan(0.35);
    // снимаем выделение → возвращаемся к baseline манифеста
    visual.setTargets({ hover: null, selected: null, dimOthers: false });
    visual.update(10);
    expect((mesh.material as MeshStandardMaterial).opacity).toBeCloseTo(0.35, 6);
  });

  it('alphaMode OPAQUE переводит baseline в непрозрачный, и выделение возвращает к нему', () => {
    // BLEND-материал из модели (оболочка/матрикс митохондрии).
    const mesh = makeMesh({ opacity: 0.5, transparent: true, depthWrite: false });
    const visual = new VisualState(
      new Map([
        ['cristae', [mesh]],
        ['other', [makeMesh()]],
      ]),
      new Map([['cristae', { alphaMode: 'OPAQUE' }]]),
    );
    visual.setTargets({ hover: null, selected: null, dimOthers: false });
    visual.update(10);
    const mat = mesh.material as MeshStandardMaterial;
    expect(mat.transparent).toBe(false);
    expect(mat.depthWrite).toBe(true);
    expect(mat.opacity).toBeCloseTo(1, 6);

    // Приглушение временно делает материал полупрозрачным — это ожидаемо.
    visual.setTargets({ hover: null, selected: 'other', dimOthers: true });
    visual.update(10);
    expect((mesh.material as MeshStandardMaterial).opacity).toBeLessThan(1);

    // Снятие выделения возвращает к baseline манифеста, а не к исходному BLEND.
    visual.setTargets({ hover: null, selected: null, dimOthers: false });
    visual.update(10);
    expect(mat.transparent).toBe(false);
    expect(mat.depthWrite).toBe(true);
    expect(mat.opacity).toBeCloseTo(1, 6);
  });

  it('alphaMode BLEND переводит baseline в прозрачный', () => {
    const mesh = makeMesh({ opacity: 1, transparent: false });
    const visual = new VisualState(
      new Map([['membrane', [mesh]]]),
      new Map([['membrane', { alphaMode: 'BLEND' }]]),
    );
    visual.setTargets({ hover: null, selected: null, dimOthers: false });
    visual.update(10);
    expect((mesh.material as MeshStandardMaterial).transparent).toBe(true);
  });
});
