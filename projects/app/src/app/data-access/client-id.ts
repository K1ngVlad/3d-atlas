import { Injectable } from '@angular/core';

const CLIENT_ID_KEY = 'atlas.clientId';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID v4; `crypto.randomUUID` есть только в безопасном контексте (https, localhost). */
export function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Метка браузера вместо учётной записи (docs/lab/quiz-ux.md, «Идентификация пользователя»):
 * UUID в localStorage `atlas.clientId`; хранилище недоступно — UUID на сеанс.
 */
@Injectable({ providedIn: 'root' })
export class ClientIdService {
  readonly id: string = ClientIdService.readOrCreate();

  private static readOrCreate(): string {
    try {
      const saved = localStorage.getItem(CLIENT_ID_KEY);
      if (saved && UUID_RE.test(saved)) return saved;
      const id = randomUuid();
      localStorage.setItem(CLIENT_ID_KEY, id);
      return id;
    } catch {
      return randomUuid();
    }
  }
}
