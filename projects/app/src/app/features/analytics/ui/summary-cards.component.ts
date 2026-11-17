import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { AnalyticsSummary } from '../../../data-access/repositories/analytics-repository';

const PCT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const COUNT = new Intl.NumberFormat('ru-RU');
const TIME = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface Card {
  label: string;
  value: string;
}

/** Карточки сводки аналитики. */
@Component({
  selector: 'app-summary-cards',
  template: `
    @for (c of cards(); track c.label) {
      <div class="card">
        <div class="value">{{ c.value }}</div>
        <div class="label atlas-muted">{{ c.label }}</div>
      </div>
    }
  `,
  styles: `
    :host { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: var(--atlas-space-md); }
    .card {
      padding: var(--atlas-space-lg); border-radius: var(--atlas-radius-lg);
      background: var(--atlas-color-surface); border: 1px solid var(--atlas-color-border);
    }
    .value { font-size: 26px; font-weight: 600; line-height: 1.2; font-variant-numeric: tabular-nums; }
    .label { margin-top: var(--atlas-space-xs); font-size: 13px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SummaryCardsComponent {
  readonly summary = input.required<AnalyticsSummary>();

  readonly cards = computed<Card[]>(() => {
    const s = this.summary();
    const last = s.lastEventAt ? new Date(s.lastEventAt) : null;
    return [
      { label: 'Завершено попыток', value: COUNT.format(s.attemptsCompleted) },
      { label: 'Средний результат', value: `${PCT.format(s.avgScorePct)}%` },
      { label: 'Всего ответов', value: COUNT.format(s.answersTotal) },
      { label: 'Доля верных', value: `${PCT.format(s.correctRatePct)}%` },
      {
        label: 'Последнее событие',
        value: last && !Number.isNaN(last.getTime()) ? TIME.format(last) : '—',
      },
    ];
  });
}
