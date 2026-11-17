import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { QuizRunStore } from './quiz-run.store';
import { AnswerFeedbackComponent } from './ui/answer-feedback.component';
import { QuestionCardComponent } from './ui/question-card.component';
import { QuizResultComponent } from './ui/quiz-result.component';

/** `/quiz/:quizId`: прохождение теста (docs/lab/quiz-ux.md, «Прохождение»). */
@Component({
  selector: 'app-quiz-run-page',
  imports: [RouterLink, QuestionCardComponent, AnswerFeedbackComponent, QuizResultComponent],
  providers: [QuizRunStore],
  host: { '(document:keydown)': 'onKey($event)' },
  template: `
    @switch (store.phase()) {
      @case ('loading') {
        <div class="body" aria-busy="true" aria-label="Загрузка теста">
          <div class="atlas-skeleton sk sk-line"></div>
          <div class="atlas-skeleton sk sk-title"></div>
          @for (i of [1, 2, 3, 4]; track i) { <div class="atlas-skeleton sk sk-option"></div> }
        </div>
      }
      @case ('not-found') {
        <div class="state">
          <p>Тест не найден</p>
          <a class="atlas-btn" routerLink="/quiz">К списку тестов</a>
        </div>
      }
      @case ('error') {
        <div class="state" role="alert">
          <p>{{ store.loadError() }}</p>
          <button type="button" class="atlas-btn atlas-btn--primary" (click)="store.retry()">Повторить</button>
          <a class="atlas-btn atlas-btn--text" routerLink="/quiz">К списку тестов</a>
        </div>
      }
      @default {
        <header class="head">
          <p class="atlas-overline title">Тест · {{ store.quiz()?.title }}</p>
          <a class="close" routerLink="/quiz" aria-label="Выйти" title="Выйти (прогресс сохранён)">×</a>
        </header>

        @if (store.phase() === 'result') {
          <div class="body">
            @if (store.result(); as r) {
              <app-quiz-result [result]="r" [items]="store.resultItems()" (retake)="store.retake()" />
            }
          </div>
        } @else if (store.current(); as q) {
          <div class="body">
            <app-question-card
              [question]="q"
              [index]="store.index()"
              [segments]="store.segments()"
              [selected]="store.selected()"
              [answer]="store.currentAnswer()"
              [locked]="!!store.currentAnswer() || store.busy()"
              (optionToggled)="store.toggle($event)"
            />
            @if (store.currentAnswer(); as a) {
              @if (a.entity !== undefined) {
                <app-answer-feedback [entity]="a.entity" [atlasHref]="atlasHref()" />
              }
            }
          </div>

          <footer class="foot">
            @if (store.currentAnswer()) {
              <button type="button" class="atlas-btn atlas-btn--primary" [disabled]="store.busy()" (click)="store.next()">
                {{ store.isLast() ? 'Завершить тест' : 'Дальше →' }}
              </button>
            } @else {
              <button type="button" class="atlas-btn atlas-btn--primary" [disabled]="!store.canSubmit()" (click)="store.submit()">
                Ответить
              </button>
              <button type="button" class="atlas-btn atlas-btn--text" [disabled]="store.busy()" (click)="store.dontKnow()">
                Не знаю
              </button>
            }
            @if (store.actionError(); as msg) {
              <p class="action-error" role="alert">{{ msg }}</p>
            }
          </footer>
        } @else {
          <div class="state"><p class="atlas-muted">В тесте нет вопросов</p></div>
        }
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .head {
      display: flex; align-items: center; gap: var(--atlas-space-sm);
      padding: var(--atlas-space-md) var(--atlas-space-sm) var(--atlas-space-md) var(--atlas-space-lg);
      border-bottom: 1px solid var(--atlas-color-border);
    }
    .title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .close {
      display: inline-flex; align-items: center; justify-content: center;
      width: var(--atlas-touch-target); height: var(--atlas-touch-target);
      border-radius: var(--atlas-radius-sm); font-size: 22px; text-decoration: none;
      color: var(--atlas-color-text-secondary);
    }
    .close:hover { background: var(--atlas-color-bg); }
    .body { flex: 1; min-height: 0; overflow-y: auto; padding: var(--atlas-space-lg); }
    .foot {
      display: flex; flex-wrap: wrap; gap: var(--atlas-space-sm);
      padding: var(--atlas-space-md) var(--atlas-space-lg);
      border-top: 1px solid var(--atlas-color-border);
    }
    .foot .atlas-btn--primary { flex: 1; }
    .action-error { flex-basis: 100%; margin: 0; font-size: 13px; color: var(--atlas-color-danger); }
    .state { padding: var(--atlas-space-xl) var(--atlas-space-lg); display: grid; gap: var(--atlas-space-sm); justify-items: start; }
    .state p { margin: 0 0 var(--atlas-space-xs); }
    .sk { margin-bottom: var(--atlas-space-md); }
    .sk-line { height: 12px; width: 40%; }
    .sk-title { height: 48px; }
    .sk-option { height: var(--atlas-touch-target); margin-bottom: var(--atlas-space-sm); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuizRunPageComponent {
  readonly store = inject(QuizRunStore);
  readonly quizId = input.required<string>();

  /** Модель вопроса в атласе: детальная — через корень теста (`/atlas/animal-cell/golgi`). */
  readonly atlasHref = computed(() => {
    const quiz = this.store.quiz();
    if (!quiz) return '/atlas';
    const q = this.store.current();
    const path = [quiz.manifestId];
    if (q?.manifestId && q.manifestId !== quiz.manifestId) path.push(q.manifestId);
    return `/atlas/${path.map(encodeURIComponent).join('/')}`;
  });

  constructor() {
    effect(() => {
      const id = this.quizId();
      untracked(() => void this.store.start(id));
    });
  }

  /** `1`–`9` выбирают вариант, `Enter` — «Ответить» / «Дальше». */
  onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'TEXTAREA' || (tag === 'INPUT' && (target as HTMLInputElement).type === 'text')) return;
    if (e.key === 'Enter') {
      // кнопка / ссылка в фокусе нажмётся сама
      if (tag === 'BUTTON' || tag === 'A') return;
      e.preventDefault();
      this.store.pressEnter();
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      e.preventDefault();
      this.store.pressDigit(Number(e.key));
    }
  }
}
