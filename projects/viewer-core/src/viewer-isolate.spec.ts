import { describe, expect, it } from 'vitest';
import { Mesh, MeshStandardMaterial } from 'three';
import { VisualState } from './highlight/visual-state';

// Инвариант viewer.ts: dimOthers = selection !== null && options.isolate.
// Тест фиксирует это через VisualState: имитируем вызовы, которые делает viewer
// при двух значениях options.isolate.

function makeMesh(): Mesh {
  return new Mesh(undefined, new MeshStandardMaterial({ opacity: 1 }));
}

describe('viewer — приглушение зависит от options.isolate', () => {
  it('при isolate=false выделение не меняет непрозрачность других частей', () => {
    const other = makeMesh();
    const visual = new VisualState(
      new Map([
        ['nucleus', [makeMesh()]],
        ['cytoplasm', [other]],
      ]),
    );
    // так viewer сконструирует вызов при options.isolate=false, selection=nucleus
    visual.setTargets({ hover: null, selected: 'nucleus', dimOthers: false });
    visual.update(10);
    expect((other.material as MeshStandardMaterial).opacity).toBeCloseTo(1, 6);
  });

  it('при isolate=true выделение приглушает остальные', () => {
    const other = makeMesh();
    const visual = new VisualState(
      new Map([
        ['nucleus', [makeMesh()]],
        ['cytoplasm', [other]],
      ]),
    );
    visual.setTargets({ hover: null, selected: 'nucleus', dimOthers: true });
    visual.update(10);
    expect((other.material as MeshStandardMaterial).opacity).toBeLessThan(1);
  });
});
