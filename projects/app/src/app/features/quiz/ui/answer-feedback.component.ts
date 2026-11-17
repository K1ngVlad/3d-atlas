import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { AnswerEntity } from '../../../data-access/repositories/quiz-repository';

/**
 * Карточка органоида после ответа (данные Catalog, которые вернул Quiz).
 * `null` — Catalog недоступен: «Описание сейчас недоступно».
 */
@Component({
  selector: 'app-answer-feedback',
  template: `
    @if (entity(); as e) {
      <article class="card">
        <p class="atlas-overline">Органоид</p>
        <h3>{{ e.title }}</h3>
        @if (e.summary) { <p class="summary">{{ e.summary }}</p> }
        <a class="atlas-btn atlas-btn--text link" [href]="atlasHref()" target="_blank" rel="noopener">
          Открыть в атласе ↗
        </a>
      </article>
    } @else {
      <p class="unavailable atlas-muted">Описание сейчас недоступно</p>
    }
  `,
  styles: `
    :host { display: block; margin-top: var(--atlas-space-lg); }
    .card {
      padding: var(--atlas-space-md) var(--atlas-space-lg);
      border-radius: var(--atlas-radius-lg);
      background: var(--atlas-color-bg);
      border: 1px solid var(--atlas-color-border);
    }
    h3 { margin: var(--atlas-space-xs) 0; font-size: 16px; font-weight: 600; }
    .summary { margin: 0 0 var(--atlas-space-sm); color: var(--atlas-color-text-secondary); }
    .link { padding: 0 var(--atlas-space-sm); margin-left: calc(-1 * var(--atlas-space-sm)); }
    .unavailable { margin: 0; font-size: 13px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnswerFeedbackComponent {
  readonly entity = input<AnswerEntity | null>(null);
  /** Ссылка на модель в атласе (новая вкладка — тест не прерывается). */
  readonly atlasHref = input('/atlas');
}
