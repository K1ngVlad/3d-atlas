import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-quiz-page',
  template: `
    <section class="placeholder">
      <h1>Тесты</h1>
      <p>Экран тестов появится позже.</p>
    </section>
  `,
  styles: `
    :host { display: block; flex: 1; padding: var(--atlas-space-xl); }
    .placeholder { max-width: 640px; }
    h1 { margin: 0 0 var(--atlas-space-sm); font-size: 20px; font-weight: 600; }
    p { margin: 0; color: var(--atlas-color-text-muted); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuizPageComponent {}
