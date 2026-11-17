import { Injectable, Logger } from '@nestjs/common';

/** Entity card returned to the client with an answer (contracts.md: `entity: { id, title, summary }`). */
export interface CatalogEntity {
  id: string;
  title: string;
  summary: string;
}

interface EntityContent {
  id: string;
  title?: { ru?: string };
  summary?: { ru?: string };
}

interface ConsulHealthEntry {
  Service: { Address: string; Port: number };
  Node?: { Address?: string };
}

export const DISCOVERY_TTL_MS = 5_000;
export const ENTITY_TTL_MS = 60_000;
export const REQUEST_TIMEOUT_MS = 2_000;

/**
 * Direct Quiz → Catalog link (contracts.md, decision 39): addresses from Consul
 * (`/v1/health/service/catalog?passing=true`, list kept ≤ 5 s, round robin), 2 s timeout,
 * in-memory entity cache with 60 s TTL. Never throws: any failure → `null` and a warning.
 */
@Injectable()
export class CatalogClient {
  private readonly log = new Logger(CatalogClient.name);
  private readonly consul = (process.env.CONSUL_HTTP_ADDR ?? 'http://consul:8500').replace(/\/$/, '');
  private readonly serviceName = process.env.CATALOG_SERVICE_NAME ?? 'catalog';

  /** Overridable in tests. */
  fetchFn: typeof fetch = (...args) => fetch(...args);
  now: () => number = () => Date.now();

  private addresses: string[] = [];
  private addressesAt = -Infinity;
  private next = 0;
  private readonly cache = new Map<string, { value: CatalogEntity | null; expires: number }>();

  async getEntity(id: string): Promise<CatalogEntity | null> {
    const cached = this.cache.get(id);
    if (cached && cached.expires > this.now()) return cached.value;
    let address: string | undefined;
    try {
      address = await this.pickAddress();
      const url = `http://${address}/api/catalog/entities?ids=${encodeURIComponent(id)}`;
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = (await res.json()) as EntityContent[];
      const found = Array.isArray(list) ? list.find((e) => e?.id === id) : undefined;
      const value: CatalogEntity | null = found
        ? { id: found.id, title: found.title?.ru ?? found.id, summary: found.summary?.ru ?? '' }
        : null;
      if (!found) this.log.warn(`Catalog has no entity "${id}"`);
      this.cache.set(id, { value, expires: this.now() + ENTITY_TTL_MS });
      this.log.log(`Catalog entity "${id}" fetched from ${address}`);
      return value;
    } catch (e) {
      this.log.warn(`Catalog unavailable for entity "${id}"${address ? ` via ${address}` : ''}: ${(e as Error).message}`);
      return null;
    }
  }

  /** Drops cached entities (all or listed); used by the optional `AtlasContentUpdated` handler. */
  invalidate(ids?: string[]): void {
    if (!ids) this.cache.clear();
    else ids.forEach((id) => this.cache.delete(id));
  }

  private async pickAddress(): Promise<string> {
    if (this.now() - this.addressesAt >= DISCOVERY_TTL_MS) {
      try {
        this.addresses = await this.discover();
        this.addressesAt = this.now();
      } catch (e) {
        // Keep the last known list rather than failing every request while Consul is away.
        this.log.warn(`Consul lookup for "${this.serviceName}" failed: ${(e as Error).message}`);
        if (!this.addresses.length) throw new Error('no known catalog instances');
      }
    }
    if (!this.addresses.length) throw new Error('no passing catalog instances in Consul');
    const address = this.addresses[this.next % this.addresses.length];
    this.next = (this.next + 1) % this.addresses.length;
    return address;
  }

  private async discover(): Promise<string[]> {
    const res = await this.fetchFn(`${this.consul}/v1/health/service/${this.serviceName}?passing=true`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const entries = (await res.json()) as ConsulHealthEntry[];
    return entries.map((e) => `${e.Service.Address || e.Node?.Address}:${e.Service.Port}`).sort();
  }
}
