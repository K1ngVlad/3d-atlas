/**
 * HTTP-статус ошибки репозитория: `HttpErrorResponse.status` (0 — сеть недоступна).
 * `null` — ошибка не HTTP (разбор, программная).
 */
export function httpStatus(err: unknown): number | null {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = (err as { status: unknown }).status;
    if (typeof s === 'number') return s;
  }
  return null;
}
