import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { parseManifest, type SceneManifest } from '@atlas/viewer-core';
import { firstValueFrom } from 'rxjs';
import { APP_ENV } from '../../core/config/app-config';
import type { EntityContent, StructureRepository } from './structure-repository';

function isNotFound(err: unknown): boolean {
  return err instanceof HttpErrorResponse && err.status === 404;
}

/**
 * Манифесты и контент из Catalog через API Gateway (docs/lab/contracts.md).
 * Кэш промисов — как в AssetsStructureRepository; неудачные запросы из кэша
 * убираются, чтобы «Повторить» действительно ходил в сеть. Окончательные
 * ответы (`404`) кэшируются.
 */
@Injectable({ providedIn: 'root' })
export class HttpStructureRepository implements StructureRepository {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(APP_ENV).apiBase}/api/catalog`;

  private readonly manifests = new Map<string, Promise<SceneManifest>>();
  private readonly entities = new Map<string, Promise<EntityContent | null>>();
  private readonly existence = new Map<string, Promise<boolean>>();

  getManifest(id: string): Promise<SceneManifest> {
    let p = this.manifests.get(id);
    if (!p) {
      p = firstValueFrom(
        this.http.get<unknown>(`${this.base}/manifests/${encodeURIComponent(id)}`),
      ).then((body) => parseManifest(body));
      this.manifests.set(id, p);
      p.catch(() => this.manifests.delete(id));
    }
    return p;
  }

  getEntity(id: string): Promise<EntityContent | null> {
    let p = this.entities.get(id);
    if (!p) {
      p = firstValueFrom(
        this.http.get<EntityContent>(`${this.base}/entities/${encodeURIComponent(id)}`),
      ).catch((err: unknown) => {
        // 404 — сущности нет (кэшируем null); сеть / 5xx — null без кэша
        if (!isNotFound(err)) this.entities.delete(id);
        return null;
      });
      this.entities.set(id, p);
    }
    return p;
  }

  manifestExists(id: string): Promise<boolean> {
    let p = this.existence.get(id);
    if (!p) {
      p = this.getManifest(id).then(
        () => true,
        (err: unknown) => {
          if (!isNotFound(err)) this.existence.delete(id);
          return false;
        },
      );
      this.existence.set(id, p);
    }
    return p;
  }
}
