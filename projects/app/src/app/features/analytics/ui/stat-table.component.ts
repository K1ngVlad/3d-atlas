import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export interface StatRow {
  key: string;
  label: string;
  /** Вторая строка серым (тест, органоид). */
  hint?: string;
  answersTotal: number;
  correctRatePct: number;
}

/** Таблица «название — ответов — доля верных» с горизонтальной полосой на CSS. */
@Component({
  selector: 'app-stat-table',
  template: `
    <table>
      <thead>
        <tr>
          <th scope="col">{{ labelHeader() }}</th>
          <th scope="col" class="num">Ответов</th>
          <th scope="col" class="rate">Доля верных</th>
        </tr>
      </thead>
      <tbody>
        @for (r of rows(); track r.key) {
          <tr>
            <td>
              <div class="label">{{ r.label }}</div>
              @if (r.hint) { <div class="hint atlas-muted">{{ r.hint }}</div> }
            </td>
            <td class="num">{{ r.answersTotal }}</td>
            <td class="rate">
              <div class="rate-cell">
                <div class="bar" role="img" [attr.aria-label]="pct(r.correctRatePct) + ' верных'">
                  <span [style.width.%]="clamp(r.correctRatePct)"></span>
                </div>
                <span class="value">{{ pct(r.correctRatePct) }}</span>
              </div>
            </td>
          </tr>
        } @empty {
          <tr><td colspan="3" class="atlas-muted none">Нет ответов</td></tr>
        }
      </tbody>
    </table>
  `,
  styles: `
    :host { display: block; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    th {
      text-align: left; font-size: 12px; font-weight: 600; color: var(--atlas-color-text-muted);
      padding: 0 var(--atlas-space-md) var(--atlas-space-sm); border-bottom: 1px solid var(--atlas-color-border);
    }
    td { padding: var(--atlas-space-sm) var(--atlas-space-md); border-bottom: 1px solid var(--atlas-color-border); vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    .num { text-align: right; width: 80px; }
    .rate { width: 40%; min-width: 180px; }
    .rate-cell { display: flex; align-items: center; gap: var(--atlas-space-sm); }
    .bar { flex: 1; height: 8px; border-radius: 4px; background: var(--atlas-color-bg); overflow: hidden; }
    .bar span { display: block; height: 100%; border-radius: 4px; background: var(--atlas-color-accent); }
    .value { width: 48px; text-align: right; }
    .hint { font-size: 12px; }
    .none { text-align: center; padding: var(--atlas-space-lg); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatTableComponent {
  readonly rows = input<StatRow[]>([]);
  readonly labelHeader = input('Название');

  clamp(v: number): number {
    return Math.max(0, Math.min(100, v));
  }

  pct(v: number): string {
    return `${Math.round(v)}%`;
  }
}
