import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'atlas' },
  {
    path: 'atlas',
    loadChildren: () => import('./features/atlas/atlas.routes').then(m => m.ATLAS_ROUTES),
  },
  {
    path: 'quiz',
    loadComponent: () =>
      import('./features/quiz/quiz-page.component').then(m => m.QuizPageComponent),
  },
  {
    path: 'upload',
    loadComponent: () =>
      import('./features/upload/upload-page.component').then(m => m.UploadPageComponent),
  },
  {
    path: 'analytics',
    loadComponent: () =>
      import('./features/analytics/analytics-page.component').then(m => m.AnalyticsPageComponent),
  },
  {
    path: 'sandbox',
    loadComponent: () =>
      import('./features/sandbox/sandbox-page.component').then(m => m.SandboxPageComponent),
  },
  { path: '**', redirectTo: 'atlas' },
];
