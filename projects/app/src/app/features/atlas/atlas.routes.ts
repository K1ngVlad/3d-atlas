import { Routes } from '@angular/router';
import { AtlasPageComponent } from './atlas-page.component';

// Один компонент на все уровни — чтобы Angular не пересоздавал viewer при углублении.
export const ATLAS_ROUTES: Routes = [
  { path: '**', component: AtlasPageComponent },
];
