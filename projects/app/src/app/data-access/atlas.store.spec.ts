import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { SceneManifest } from '@atlas/viewer-core';
import { AtlasStore } from './atlas.store';
import { STRUCTURE_REPO, type StructureRepository } from './repositories/structure-repository';
import { ViewerService } from '../viewer/viewer.service';

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

describe('AtlasStore — владелец просмотрщика', () => {
  let manifestExists: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    manifestExists = vi.fn(() => Promise.resolve(true));
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'atlas', children: [{ path: '**', component: RouteStubComponent }] },
          { path: 'quiz', component: RouteStubComponent },
        ]),
        { provide: STRUCTURE_REPO, useValue: { ...repoStub, manifestExists } },
      ],
    }).compileComponents();
  });

  function requestDetail(viewer: ViewerService): void {
    viewer.openDetailRequest.set({ partId: 'mito', detailId: 'mitochondrion', seq: Date.now() });
    TestBed.tick();
  }

  it('двойной клик по модели в тесте (owner = quiz) не открывает детальный уровень', async () => {
    const router = TestBed.inject(Router);
    const viewer = TestBed.inject(ViewerService);
    TestBed.inject(AtlasStore);
    await router.navigateByUrl('/atlas/animal-cell');
    await router.navigateByUrl('/quiz');

    viewer.owner.set('quiz');
    requestDetail(viewer);
    await new Promise((r) => setTimeout(r, 0));

    expect(manifestExists).not.toHaveBeenCalled();
    expect(router.url).toBe('/quiz');
  });

  it('в атласе (owner = atlas) двойной клик по-прежнему открывает детальный уровень', async () => {
    const router = TestBed.inject(Router);
    const viewer = TestBed.inject(ViewerService);
    const store = TestBed.inject(AtlasStore);
    await router.navigateByUrl('/atlas/animal-cell');
    await vi.waitFor(() => expect(store.current()?.manifestId).toBe('animal-cell'));

    viewer.owner.set('atlas');
    requestDetail(viewer);

    await vi.waitFor(() => expect(router.url).toBe('/atlas/animal-cell/mitochondrion'));
    expect(manifestExists).toHaveBeenCalledWith('mitochondrion');
  });
});
