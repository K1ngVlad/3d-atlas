import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CompleteResult } from '../../../data-access/repositories/quiz-repository';
import type { ResultItem } from '../quiz-run.store';

/** Оценочная фраза итога (docs/lab/quiz-ux.md, «Итог»). */
export function verdictPhrase(pct: number): string {
  if (pct >= 80) return 'Отличный результат';
  if (pct >= 50) return 'Неплохо, но есть что повторить';
  return 'Стоит вернуться к атласу и повторить';
}

@Component({
  selector: 'app-quiz-result',
  imports: [RouterLink],
  template: `
    <p class="atlas-overline">Тест пройден</p>
    <p class="score">
      <strong>{{ result().score }} из {{ result().total }}</strong>
      <span class="pct">{{ pct() }}%</span>
    </p>
    <p class="phrase">{{ phrase() }}</p>

    <ol class="items">
      @for (it of items(); track it.questionId) {
        <li [class.ok]="it.correct">
          <span class="sign" [attr.aria-label]="it.correct ? 'верно' : 'неверно'">{{ it.correct ? '✓' : '✗' }}</span>
          <div>
            <p class="q">{{ it.text }}</p>
            @if (!it.correct) {
              @if (it.correctTexts.length) {
                <p class="answer">Правильный ответ: {{ it.correctTexts.join(', ') }}</p>
              } @else if (!it.answered) {
                <p class="answer atlas-muted">Нет ответа</p>
              }
            }
          </div>
        </li>
      }
    </ol>

    <div class="actions">
      <button type="button" class="atlas-btn atlas-btn--primary" (click)="retake.emit()">Пройти ещё раз</button>
      <a class="atlas-btn" routerLink="/quiz">К списку тестов</a>
      <a class="atlas-btn atlas-btn--text" routerLink="/atlas">Открыть атлас</a>
    </div>
  `,
  styles: `
    :host { display: block; }
    .score { margin: var(--atlas-space-xs) 0 0; display: flex; align-items: baseline; gap: var(--atlas-space-md); }
    .score strong { font-size: 32px; font-weight: 600; }
    .pct { font-size: 18px; color: var(--atlas-color-text-secondary); }
    .phrase { margin: var(--atlas-space-xs) 0 var(--atlas-space-lg); font-weight: 500; }
    .items { list-style: none; margin: 0 0 var(--atlas-space-lg); padding: 0; display: grid; gap: var(--atlas-space-sm); }
    li { display: flex; gap: var(--atlas-space-sm); }
    .sign { flex: none; width: 20px; font-weight: 600; color: var(--atlas-color-danger); }
    li.ok .sign { color: var(--atlas-color-success); }
    .q { margin: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .answer { margin: 2px 0 0; font-size: 13px; color: var(--atlas-color-success); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--atlas-space-sm); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuizResultComponent {
  readonly result = input.required<CompleteResult>();
  readonly items = input<ResultItem[]>([]);

  readonly retake = output<void>();

  readonly pct = computed(() => {
    const r = this.result();
    return r.total > 0 ? Math.round((r.score / r.total) * 100) : 0;
  });
  readonly phrase = computed(() => verdictPhrase(this.pct()));
}
