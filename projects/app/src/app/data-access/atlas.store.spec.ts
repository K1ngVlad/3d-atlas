import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { SceneManifest } from '@atlas/viewer-core';
import { AtlasStore } from './atlas.store';
import { STRUCTURE_REPO, type StructureRepository } from './repositories/structure-repository';

@Component({ template: '' })
class RouteStubComponent {}

function manifest(id: string): SceneManifest {
  return { schemaVersion: 1, id, model: { url: '/models/stub.glb' }, parts: [] };
}

const repoStub: StructureRepository = {
  getManifest: (id: string) => Promise.resolve(manifest(id)),
  getEntity: () => Promise.resolve(null),
  manifestExists: () => Promise.resolve(false),
};

describe('AtlasStore — навигация', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'atlas', children: [{ path: '**', component: RouteStubComponent }] },
          { path: 'quiz', component: RouteStubComponent },
        ]),
        { provide: STRUCTURE_REPO, useValue: repoStub },
      ],
    }).compileComponents();
  });

  it('не перехватывает чужие маршруты: /atlas/animal-cell → /quiz остаётся на /quiz', async () => {
    const router = TestBed.inject(Router);
    // создаём стор до навигаций — так активируются подписки на NavigationEnd
    TestBed.inject(AtlasStore);

    await router.navigateByUrl('/atlas/animal-cell');
    expect(router.url).toBe('/atlas/animal-cell');

    await router.navigateByUrl('/quiz');
    expect(router.url).toBe('/quiz');
  });
});
