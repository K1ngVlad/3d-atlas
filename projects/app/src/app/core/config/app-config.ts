import { InjectionToken } from '@angular/core';
import { environment } from '../../../environments/environment';

export type DataSource = 'api' | 'assets';

export interface AppEnvironment {
  /** Откуда атлас берёт манифесты и контент: API Gateway или статика `public/`. */
  dataSource: DataSource;
  /** Префикс адресов API; пустая строка — тот же origin (gateway / прокси dev-сервера). */
  apiBase: string;
}

export const APP_ENV = new InjectionToken<AppEnvironment>('APP_ENV', {
  providedIn: 'root',
  factory: () => environment,
});
