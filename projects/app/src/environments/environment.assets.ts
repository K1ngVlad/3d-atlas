import type { AppEnvironment } from '../app/core/config/app-config';

// Запасная конфигурация без бэкенда: манифесты и контент — статика из public/.
// Подключается через fileReplacements (конфигурация `assets` в angular.json).
export const environment: AppEnvironment = {
  dataSource: 'assets',
  apiBase: '',
};
