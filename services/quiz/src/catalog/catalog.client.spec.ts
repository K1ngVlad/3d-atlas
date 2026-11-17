import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { CatalogClient, DISCOVERY_TTL_MS, ENTITY_TTL_MS } from './catalog.client';

const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

const consul = (...addrs: string[]) =>
  json(addrs.map((a) => ({ Service: { Address: a.split(':')[0], Port: Number(a.split(':')[1]) } })));

const ENTITY = { id: 'mitochondrion', kind: 'organelle', title: { ru: 'Митохондрия' }, summary: { ru: 'Текст' }, sources: [] };

describe('CatalogClient', () => {
  let client: CatalogClient;
  let clock: number;
  type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
  let fetchMock: jest.Mock<FetchLike>;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(() => {
    client = new CatalogClient();
    clock = 1_000_000;
    client.now = () => clock;
    fetchMock = jest.fn<FetchLike>();
    client.fetchFn = fetchMock as unknown as typeof fetch;
  });

  const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

  it('discovers catalog via Consul, maps EntityContent and caches it for 60 s', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/v1/health/service/catalog?passing=true') ? consul('10.0.0.5:8080') : json([ENTITY]),
    );
    expect(await client.getEntity('mitochondrion')).toEqual({ id: 'mitochondrion', title: 'Митохондрия', summary: 'Текст' });
    expect(urls()[1]).toBe('http://10.0.0.5:8080/api/catalog/entities?ids=mitochondrion');
    await client.getEntity('mitochondrion');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    clock += ENTITY_TTL_MS;
    await client.getEntity('mitochondrion');
    expect(fetchMock).toHaveBeenCalledTimes(4); // consul again (list expired) + catalog
  });

  it('round-robins between instances and refreshes the list after 5 s', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/v1/health/') ? consul('10.0.0.6:8080', '10.0.0.5:8080') : json([]),
    );
    await client.getEntity('a');
    await client.getEntity('b');
    await client.getEntity('c');
    const catalogCalls = urls().filter((u) => u.includes('/api/catalog/'));
    expect(catalogCalls.map((u) => new URL(u).host)).toEqual(['10.0.0.5:8080', '10.0.0.6:8080', '10.0.0.5:8080']);
    expect(urls().filter((u) => u.includes('/v1/health/'))).toHaveLength(1);
    clock += DISCOVERY_TTL_MS;
    await client.getEntity('d');
    expect(urls().filter((u) => u.includes('/v1/health/'))).toHaveLength(2);
  });

  it('returns null (no throw) when Catalog fails, times out or has no instances; failures are not cached', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('/v1/health/') ? consul('10.0.0.5:8080') : json({}, 503)));
    expect(await client.getEntity('mitochondrion')).toBeNull();

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/v1/health/')) return consul('10.0.0.5:8080');
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    expect(await client.getEntity('mitochondrion')).toBeNull();

    clock += DISCOVERY_TTL_MS;
    fetchMock.mockImplementation(async () => consul());
    expect(await client.getEntity('mitochondrion')).toBeNull();

    clock += DISCOVERY_TTL_MS;
    fetchMock.mockImplementation(async (url: string) => (url.includes('/v1/health/') ? consul('10.0.0.5:8080') : json([ENTITY])));
    expect(await client.getEntity('mitochondrion')).not.toBeNull();
  });

  it('passes a 2 s abort signal to every request', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('/v1/health/') ? consul('10.0.0.5:8080') : json([ENTITY])));
    await client.getEntity('mitochondrion');
    for (const call of fetchMock.mock.calls) expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
