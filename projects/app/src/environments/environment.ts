import type { AppEnvironment } from '../app/core/config/app-config';

// Основная конфигурация: данные из API Gateway (docs/lab/contracts.md, «Клиент»).
// Тот же origin, что и у SPA: в docker — gateway, в `ng serve` — proxy.conf.json.
export const environment: AppEnvironment = {
  dataSource: 'api',
  apiBase: '',
};
