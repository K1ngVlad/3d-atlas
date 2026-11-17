import { ApplicationConfig, inject, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { routes } from './app.routes';
import { APP_ENV } from './core/config/app-config';
import { AssetsStructureRepository } from './data-access/repositories/assets-structure-repository';
import { HttpStructureRepository } from './data-access/repositories/http-structure-repository';
import { STRUCTURE_REPO } from './data-access/repositories/structure-repository';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideAnimationsAsync(),
    provideHttpClient(withFetch()),
    {
      provide: STRUCTURE_REPO,
      useFactory: () =>
        inject(APP_ENV).dataSource === 'api'
          ? inject(HttpStructureRepository)
          : inject(AssetsStructureRepository),
    },
  ],
};
