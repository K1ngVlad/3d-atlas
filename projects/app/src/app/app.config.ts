import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { routes } from './app.routes';
import { AssetsStructureRepository } from './data-access/repositories/assets-structure-repository';
import { STRUCTURE_REPO } from './data-access/repositories/structure-repository';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideAnimationsAsync(),
    { provide: STRUCTURE_REPO, useExisting: AssetsStructureRepository },
  ],
};
