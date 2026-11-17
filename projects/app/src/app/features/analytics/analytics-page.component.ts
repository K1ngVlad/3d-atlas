import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AnalyticsStore } from './analytics.store';
import { StatTableComponent } from './ui/stat-table.component';
import { SummaryCardsComponent } from './ui/summary-cards.component';

/** Автообновление, пока экран открыт: на показе видно, как приходят события. */
export const ANALYTICS_REFRESH_MS = 10_000;

const UPDATED = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

@Component({
  selector: 'app-analytics-page',
  imports: [RouterLink, SummaryCardsComponent, StatTableComponent],
  providers: [AnalyticsStore],
  template: `
    <div class="page">
      <header class="head">
        <div>
          <h1>Аналитика</h1>
          <p class="atlas-muted sub">
            Ответы студентов по тестам · обновляется каждые 10 с
            @if (updated(); as t) { · данные на {{ t }} }
          </p>
        </div>
        <button
          type="button"
          class="atlas-btn"
          [disabled]="store.refreshing()"
          (click)="store.refresh()"
        >
          {{ store.refreshing() ? 'Обновление…' : 'Обновить' }}
        </button>
      </header>

      @if (store.refreshFailed()) {
        <p class="warn" role="status">Не удалось обновить данные — показаны последние полученные.</p>
      }

      @switch (store.status()) {
        @case ('loading') {
          <div class="sk-cards">
            @for (i of [1, 2, 3, 4, 5]; track i) { <div class="atlas-skeleton sk-card"></div> }
          </div>
          <div class="atlas-skeleton sk-table"></div>
        }
        @case ('error') {
          <div class="state" role="alert">
            <p>Не удалось загрузить аналитику</p>
            <button type="button" class="atlas-btn atlas-btn--primary" (click)="store.refresh()">Повторить</button>
          </div>
        }
        @default {
          @if (store.empty()) {
            <div class="state">
              <p>Пока нет данных — пройдите тест</p>
              <a class="atlas-btn atlas-btn--primary" routerLink="/quiz">К тестам</a>
            </div>
          } @else {
            @if (store.summary(); as s) { <app-summary-cards [summary]="s" /> }

            <section class="block">
              <h2>Самые трудные органоиды</h2>
              <app-stat-table labelHeader="Органоид" [rows]="store.entityRows()" />
            </section>

            <section class="block">
              <div class="block-head">
                <h2>По вопросам</h2>
                <label class="filter">
                  <span class="atlas-muted">Тест</span>
                  <select [value]="store.quizFilter() ?? ''" (change)="onFilter($event)">
                    <option value="">Все тесты</option>
                    @for (q of store.quizzes(); track q.id) {
                      <option [value]="q.id">{{ q.title }}</option>
                    }
                  </select>
                </label>
              </div>
              <app-stat-table labelHeader="Вопрос" [rows]="store.questionRows()" />
            </section>
          }
        }
      }
    </div>
  `,
  styles: `
    :host { display: block; flex: 1; min-height: 0; overflow-y: auto; }
    .page { max-width: 1120px; margin: 0 auto; padding: var(--atlas-space-xl) var(--atlas-space-lg); }
    .head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--atlas-space-lg); margin-bottom: var(--atlas-space-lg); }
    h1 { margin: 0; font-size: 22px; font-weight: 600; }
    .sub { margin: var(--atlas-space-xs) 0 0; font-size: 13px; }
    .warn {
      margin: 0 0 var(--atlas-space-md); padding: var(--atlas-space-sm) var(--atlas-space-md);
      border-radius: var(--atlas-radius-sm); background: var(--atlas-color-danger-bg); color: var(--atlas-color-danger);
    }
    .block {
      margin-top: var(--atlas-space-xl); padding: var(--atlas-space-lg);
      background: var(--atlas-color-surface); border: 1px solid var(--atlas-color-border); border-radius: var(--atlas-radius-lg);
    }
    h2 { margin: 0 0 var(--atlas-space-md); font-size: 16px; font-weight: 600; }
    .block-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--atlas-space-md); }
    .filter { display: inline-flex; align-items: center; gap: var(--atlas-space-sm); font-size: 13px; }
    select {
      min-height: 36px; padding: 0 var(--atlas-space-sm); font: inherit;
      border: 1px solid var(--atlas-color-border); border-radius: var(--atlas-radius-sm); background: var(--atlas-color-surface);
    }
    .state { padding: 64px 0; text-align: center; }
    .state p { margin: 0 0 var(--atlas-space-md); font-size: 16px; }
    .sk-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: var(--atlas-space-md); }
    .sk-card { height: 92px; }
    .sk-table { height: 240px; margin-top: var(--atlas-space-xl); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsPageComponent {
  readonly store = inject(AnalyticsStore);

  readonly updated = computed(() => {
    const t = this.store.updatedAt();
    return t ? UPDATED.format(t) : null;
  });

  constructor() {
    void this.store.refresh();
    void this.store.loadQuizzes();
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void this.store.refresh();
    }, ANALYTICS_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  onFilter(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.store.setQuizFilter(v || null);
  }
}
