import { Injectable } from '@angular/core';
import { parseManifest, type SceneManifest } from '@atlas/viewer-core';
import type { EntityContent, StructureRepository } from './structure-repository';

@Injectable({ providedIn: 'root' })
export class AssetsStructureRepository implements StructureRepository {
  private readonly manifests = new Map<string, Promise<SceneManifest>>();
  private readonly entities = new Map<string, Promise<EntityContent | null>>();
  private readonly existence = new Map<string, Promise<boolean>>();

  getManifest(id: string): Promise<SceneManifest> {
    let p = this.manifests.get(id);
    if (!p) {
      p = fetch(`/manifests/${id}.json`).then(async (res) => {
        if (!res.ok) throw new Error(`manifest ${id} HTTP ${res.status}`);
        return parseManifest(await res.json());
      });
      this.manifests.set(id, p);
      p.catch(() => this.manifests.delete(id));
    }
    return p;
  }

  getEntity(id: string): Promise<EntityContent | null> {
    let p = this.entities.get(id);
    if (!p) {
      p = fetch(`/content/entities/${id}.json`).then(async (res) => {
        if (res.status === 404) return null;
        if (!res.ok) return null;
        return (await res.json()) as EntityContent;
      }).catch(() => null);
      this.entities.set(id, p);
    }
    return p;
  }

  manifestExists(id: string): Promise<boolean> {
    let p = this.existence.get(id);
    if (!p) {
      p = this.getManifest(id).then(() => true).catch(() => false);
      this.existence.set(id, p);
    }
    return p;
  }
}
