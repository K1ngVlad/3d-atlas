import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { LastQuizResult } from '../../../data-access/quiz-progress.storage';
import { QUESTION_FORMS, pluralRu } from '../../../shared/ui/plural';

export type QuizCardState = 'new' | 'progress' | 'done';

export interface QuizCard {
  id: string;
  title: string;
  description: string;
  questionCount: number;
  state: QuizCardState;
  /** Отвечено в незавершённой попытке; `null` — ещё не известно. */
  answered: number | null;
  last: LastQuizResult | null;
}

export type QuizListStatus = 'loading' | 'error' | 'ready';

/** Список тестов в панели `/quiz` (docs/lab/quiz-ux.md, «Список тестов»). */
@Component({
  selector: 'app-quiz-list',
  template: `
    <header class="head">
      <h1>Тесты</h1>
      <p class="atlas-muted">Проверьте, как вы знаете строение клетки</p>
    </header>

    @switch (status()) {
      @case ('loading') {
        <div class="cards" aria-busy="true" aria-label="Загрузка тестов">
          @for (i of [1, 2]; track i) {
            <div class="card skeleton atlas-skeleton"></div>
          }
        </div>
      }
      @case ('error') {
        <div class="state" role="alert">
          <p>Не удалось загрузить тесты</p>
          <button type="button" class="atlas-btn" (click)="retry.emit()">Повторить</button>
        </div>
      }
      @default {
        @if (cards().length === 0) {
          <p class="state atlas-muted">Тестов пока нет</p>
        } @else {
          <ul class="cards">
            @for (c of cards(); track c.id) {
              <li class="card">
                <h2>{{ c.title }}</h2>
                <p class="desc">{{ c.description }}</p>
                <p class="meta atlas-muted">{{ c.questionCount }} {{ plural(c.questionCount) }}</p>
                @switch (c.state) {
                  @case ('progress') {
                    <p class="status">
                      @if (c.answered !== null) {
                        Пройдено {{ c.answered }} из {{ c.questionCount }}
                      } @else {
                        Есть незавершённая попытка
                      }
                    </p>
                    <div class="actions">
                      <button type="button" class="atlas-btn atlas-btn--primary" (click)="resumeQuiz.emit(c.id)">
                        Продолжить
                      </button>
                      <button type="button" class="atlas-btn atlas-btn--text" (click)="restartQuiz.emit(c.id)">
                        Начать заново
                      </button>
                    </div>
                  }
                  @case ('done') {
                    @if (c.last; as last) {
                      <p class="status">Последний результат: {{ last.score }} из {{ last.total }}</p>
                    }
                    <div class="actions">
                      <button type="button" class="atlas-btn atlas-btn--primary" (click)="startQuiz.emit(c.id)">
                        Пройти ещё раз
                      </button>
                    </div>
                  }
                  @default {
                    <div class="actions">
                      <button type="button" class="atlas-btn atlas-btn--primary" (click)="startQuiz.emit(c.id)">
                        Начать
                      </button>
                    </div>
                  }
                }
              </li>
            }
          </ul>
        }
      }
    }
  `,
  styles: `
    :host { display: block; padding: var(--atlas-space-xl) var(--atlas-space-lg); }
    .head { margin-bottom: var(--atlas-space-lg); }
    h1 { margin: 0 0 var(--atlas-space-xs); font-size: 20px; font-weight: 600; }
    .head p { margin: 0; }
    .cards { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--atlas-space-md); }
    .card {
      padding: var(--atlas-space-lg);
      border: 1px solid var(--atlas-color-border);
      border-radius: var(--atlas-radius-lg);
      background: var(--atlas-color-surface);
    }
    .card.skeleton { height: 148px; border: none; }
    h2 { margin: 0 0 var(--atlas-space-xs); font-size: 16px; font-weight: 600; }
    .desc {
      margin: 0 0 var(--atlas-space-xs);
      color: var(--atlas-color-text-secondary);
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .meta, .status { margin: 0 0 var(--atlas-space-sm); font-size: 13px; }
    .status { color: var(--atlas-color-accent-dark); font-weight: 500; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--atlas-space-sm); margin-top: var(--atlas-space-md); }
    .state { padding: var(--atlas-space-xl) 0; text-align: center; }
    .state p { margin: 0 0 var(--atlas-space-md); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuizListComponent {
  readonly status = input.required<QuizListStatus>();
  readonly cards = input<QuizCard[]>([]);

  readonly startQuiz = output<string>();
  readonly resumeQuiz = output<string>();
  readonly restartQuiz = output<string>();
  readonly retry = output<void>();

  plural(n: number): string {
    return pluralRu(n, QUESTION_FORMS);
  }
}
