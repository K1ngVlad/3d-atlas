import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { APP_ENV } from '../../core/config/app-config';
import { HttpStructureRepository } from './http-structure-repository';

const MANIFEST = {
  schemaVersion: 1,
  id: 'animal-cell',
  entity: 'animal-cell',
  model: { url: 'models/animal-cell/v1/cell.glb' },
  parts: [],
};

/** firstValueFrom подписывается синхронно, но промис-цепочки — в микрозадачах. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('HttpStructureRepository', () => {
  let repo: HttpStructureRepository;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_ENV, useValue: { dataSource: 'api', apiBase: '' } },
      ],
    });
    repo = TestBed.inject(HttpStructureRepository);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('getManifest: GET /api/catalog/manifests/{id} → parseManifest, повтор из кэша', async () => {
    const p = repo.getManifest('animal-cell');
    http.expectOne('/api/catalog/manifests/animal-cell').flush(MANIFEST);
    const m = await p;
    expect(m.id).toBe('animal-cell');
    expect(m.model.url).toBe('models/animal-cell/v1/cell.glb');

    const again = repo.getManifest('animal-cell');
    http.expectNone('/api/catalog/manifests/animal-cell');
    expect(await again).toBe(m);
  });

  it('getManifest: невалидный манифест → ошибка parseManifest, не кэшируется', async () => {
    const p = repo.getManifest('broken');
    http.expectOne('/api/catalog/manifests/broken').flush({ id: 'broken' });
    await expect(p).rejects.toThrow();

    const retry = repo.getManifest('broken');
    http.expectOne('/api/catalog/manifests/broken').flush(MANIFEST);
    await expect(retry).resolves.toBeTruthy();
  });

  it('getEntity: 200 → EntityContent', async () => {
    const entity = { id: 'mitochondrion', kind: 'organelle', title: { ru: 'Митохондрия' }, summary: { ru: '…' } };
    const p = repo.getEntity('mitochondrion');
    http.expectOne('/api/catalog/entities/mitochondrion').flush(entity);
    expect(await p).toEqual(entity);
  });

  it('getEntity: 404 → null (кэшируется)', async () => {
    const p = repo.getEntity('nope');
    http
      .expectOne('/api/catalog/entities/nope')
      .flush({ error: 'not_found', message: 'нет' }, { status: 404, statusText: 'Not Found' });
    expect(await p).toBeNull();

    const again = repo.getEntity('nope');
    http.expectNone('/api/catalog/entities/nope');
    expect(await again).toBeNull();
  });

  it('getEntity: 503 → null, следующий вызов снова идёт в сеть', async () => {
    const p = repo.getEntity('golgi');
    http.expectOne('/api/catalog/entities/golgi').flush(null, { status: 503, statusText: 'Unavailable' });
    expect(await p).toBeNull();

    const retry = repo.getEntity('golgi');
    await flush();
    http.expectOne('/api/catalog/entities/golgi').flush({ id: 'golgi', kind: 'organelle', title: { ru: 'Гольджи' }, summary: { ru: '' } });
    expect((await retry)?.id).toBe('golgi');
  });

  it('manifestExists: 404 → false, 200 → true (через кэш getManifest)', async () => {
    const missing = repo.manifestExists('nucleus-detail');
    http
      .expectOne('/api/catalog/manifests/nucleus-detail')
      .flush({ error: 'not_found', message: '' }, { status: 404, statusText: 'Not Found' });
    expect(await missing).toBe(false);

    const present = repo.manifestExists('animal-cell');
    http.expectOne('/api/catalog/manifests/animal-cell').flush(MANIFEST);
    expect(await present).toBe(true);

    // getManifest после manifestExists — без второго запроса
    await repo.getManifest('animal-cell');
    http.expectNone('/api/catalog/manifests/animal-cell');
  });

  it('учитывает apiBase', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_ENV, useValue: { dataSource: 'api', apiBase: 'http://gw:8080' } },
      ],
    });
    const r = TestBed.inject(HttpStructureRepository);
    const c = TestBed.inject(HttpTestingController);
    const p = r.getManifest('animal-cell');
    c.expectOne('http://gw:8080/api/catalog/manifests/animal-cell').flush(MANIFEST);
    await p;
    c.verify();
    http = c;
  });
});
