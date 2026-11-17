import { Routes } from '@angular/router';
import { QuizListPageComponent } from './quiz-list-page.component';
import { QuizRunPageComponent } from './quiz-run-page.component';
import { QuizShellComponent } from './quiz-shell.component';

// Оболочка с холстом — общая для списка и прохождения: просмотрщик не пересоздаётся.
export const QUIZ_ROUTES: Routes = [
  {
    path: '',
    component: QuizShellComponent,
    children: [
      { path: '', component: QuizListPageComponent },
      { path: ':quizId', component: QuizRunPageComponent },
    ],
  },
];
