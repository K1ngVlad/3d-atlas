import { Routes } from '@angular/router';
import { AtlasPageComponent } from './atlas-page.component';

// Один компонент на все уровни — чтобы Angular не пересоздавал viewer при углублении.
// Редирект корня '/atlas' на корневой манифест — здесь, а не в AtlasStore,
// чтобы стор реагировал только на URL вида /atlas/<id>…
export const ATLAS_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'animal-cell' },
  { path: '**', component: AtlasPageComponent },
];
