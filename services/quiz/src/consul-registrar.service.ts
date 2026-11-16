import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { hostname, networkInterfaces } from 'node:os';

const NAME = 'quiz';
const PORT = 8080;
const RETRY_MS = 3000;
const REREGISTER_MS = 30000;

/** Registers the service in Consul (contracts.md): retries on start, re-registers every 30 s, deregisters on SIGTERM. */
@Injectable()
export class ConsulRegistrar implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(ConsulRegistrar.name);
  private readonly consul = (process.env.CONSUL_HTTP_ADDR ?? 'http://consul:8500').replace(/\/$/, '');
  private readonly id = `${NAME}-${hostname()}`;
  private stopped = false;
  private registered = false;
  private timer?: NodeJS.Timeout;

  onApplicationBootstrap(): void {
    void this.loop();
  }

  private async loop(): Promise<void> {
    if (this.stopped) return;
    let delay = REREGISTER_MS;
    try {
      await this.register();
      if (!this.registered) this.log.log(`Registered ${this.id} in Consul`);
      this.registered = true;
    } catch (e) {
      this.log.warn(`Consul registration failed (${(e as Error).message}); retrying`);
      delay = RETRY_MS;
    }
    if (!this.stopped) this.timer = setTimeout(() => void this.loop(), delay);
  }

  private async register(): Promise<void> {
    const ip = containerIp();
    const res = await fetch(`${this.consul}/v1/agent/service/register`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        Name: NAME,
        ID: this.id,
        Address: ip,
        Port: PORT,
        Check: {
          HTTP: `http://${ip}:${PORT}/health`,
          Interval: '5s',
          Timeout: '2s',
          DeregisterCriticalServiceAfter: '1m',
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    try {
      const res = await fetch(`${this.consul}/v1/agent/service/deregister/${this.id}`, {
        method: 'PUT',
        signal: AbortSignal.timeout(3000),
      });
      this.log.log(`Deregistered ${this.id} from Consul: ${res.status}`);
    } catch (e) {
      this.log.warn(`Consul deregistration failed: ${(e as Error).message}`);
    }
  }
}

function containerIp(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  throw new Error('No container IPv4 address found');
}
