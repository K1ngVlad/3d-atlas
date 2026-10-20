import { InjectionToken } from '@angular/core';
import type { SceneManifest } from '@atlas/viewer-core';

export type EntityKind = 'cell' | 'organelle' | 'membrane' | 'other';

export interface EntitySource {
  title: string;
  url: string;
}

export interface EntityContent {
  id: string;
  kind: EntityKind;
  title: { ru: string };
  summary: { ru: string };
  sources?: EntitySource[];
}

export interface StructureRepository {
  getManifest(id: string): Promise<SceneManifest>;
  getEntity(id: string): Promise<EntityContent | null>;
  manifestExists(id: string): Promise<boolean>;
}

export const STRUCTURE_REPO = new InjectionToken<StructureRepository>('STRUCTURE_REPO');
