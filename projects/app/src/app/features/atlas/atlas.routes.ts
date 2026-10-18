import { Routes } from '@angular/router';
import { AtlasPageComponent } from './atlas-page.component';

export const ATLAS_ROUTES: Routes = [
  { path: '', component: AtlasPageComponent },
  { path: ':rootId', component: AtlasPageComponent },
  { path: ':rootId/**', component: AtlasPageComponent },
];
