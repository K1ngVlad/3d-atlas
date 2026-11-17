import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { QuizQuestion } from '../../../data-access/repositories/quiz-repository';
import type { ProgressSegment, RecordedAnswer } from '../quiz-run.store';

type OptionMark = 'none' | 'ok' | 'bad' | 'missed';

interface OptionView {
  id: string;
  text: string;
  key: number;
  checked: boolean;
  mark: OptionMark;
}

/**
 * Вопрос: номер и прогресс, текст, подсказка, варианты; после ответа — плашка
 * «Верно» / «Неверно» и подсветка вариантов (docs/lab/quiz-ux.md).
 */
@Component({
  selector: 'app-question-card',
  template: `
    <p class="counter">Вопрос {{ index() + 1 }} из {{ segments().length }}</p>
    <ol class="progress" aria-hidden="true">
      @for (s of segments(); track $index) {
        <li [class]="s.state" [class.current]="s.current"></li>
      }
    </ol>

    <h2 class="text">{{ question().text }}</h2>

    @if (answer(); as a) {
      <p class="verdict" [class.ok]="a.correct" role="status">{{ a.correct ? 'Верно' : 'Неверно' }}</p>
    } @else {
      <p class="hint atlas-muted">
        {{ question().type === 'single' ? 'Выберите один ответ' : 'Выберите все верные ответы' }}
      </p>
    }

    <div class="options" [attr.role]="question().type === 'single' ? 'radiogroup' : 'group'">
      @for (o of options(); track o.id) {
        <label class="option" [class]="o.mark" [class.locked]="locked()">
          <input
            [type]="question().type === 'single' ? 'radio' : 'checkbox'"
            [name]="'q-' + question().id"
            [checked]="o.checked"
            [disabled]="locked()"
            (change)="optionToggled.emit(o.id)"
          />
          <span class="label">{{ o.text }}</span>
          @switch (o.mark) {
            @case ('ok') { <span class="sign" aria-label="верно">✓</span> }
            @case ('bad') { <span class="sign" aria-label="неверно">✗</span> }
            @case ('missed') { <span class="sign missed-note">✓ верный ответ</span> }
            @default { @if (!answer() && o.key <= 9) { <kbd>{{ o.key }}</kbd> } }
          }
        </label>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .counter { margin: 0 0 var(--atlas-space-xs); font-size: 13px; color: var(--atlas-color-text-secondary); }
    .progress { display: flex; gap: 3px; list-style: none; margin: 0 0 var(--atlas-space-lg); padding: 0; }
    .progress li { flex: 1; height: 6px; border-radius: 3px; background: var(--atlas-color-border); }
    .progress li.correct { background: var(--atlas-color-success); }
    .progress li.wrong { background: var(--atlas-color-danger); }
    .progress li.current { outline: 2px solid var(--atlas-color-accent); outline-offset: 1px; }
    .text { margin: 0 0 var(--atlas-space-sm); font-size: 17px; line-height: 1.4; font-weight: 600; }
    .hint { margin: 0 0 var(--atlas-space-md); font-size: 13px; }
    .verdict {
      margin: 0 0 var(--atlas-space-md); padding: 6px var(--atlas-space-md);
      border-radius: var(--atlas-radius-sm); font-weight: 600;
      background: var(--atlas-color-danger-bg); color: var(--atlas-color-danger);
    }
    .verdict.ok { background: var(--atlas-color-success-bg); color: var(--atlas-color-success); }
    .options { display: grid; gap: var(--atlas-space-sm); }
    .option {
      display: flex; align-items: center; gap: var(--atlas-space-sm);
      min-height: var(--atlas-touch-target); padding: 8px var(--atlas-space-md);
      border: 1px solid var(--atlas-color-border); border-radius: var(--atlas-radius-md);
      background: var(--atlas-color-surface); cursor: pointer;
    }
    .option:hover:not(.locked) { border-color: var(--atlas-color-accent); }
    .option:has(input:checked):not(.locked) { border-color: var(--atlas-color-accent); background: var(--atlas-color-accent-bg); }
    .option.locked { cursor: default; }
    .option.ok { background: var(--atlas-color-success-bg); border-color: var(--atlas-color-success); color: var(--atlas-color-success); }
    .option.bad { background: var(--atlas-color-danger-bg); border-color: var(--atlas-color-danger); color: var(--atlas-color-danger); }
    .option.missed { border: 2px solid var(--atlas-color-success); }
    input { margin: 0; accent-color: var(--atlas-color-accent); flex: none; }
    .label { flex: 1; }
    .sign { font-weight: 600; }
    .missed-note { font-size: 12px; color: var(--atlas-color-success); white-space: nowrap; }
    kbd {
      font: 11px/1 var(--atlas-font-family); color: var(--atlas-color-text-muted);
      border: 1px solid var(--atlas-color-border); border-radius: 4px; padding: 2px 5px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuestionCardComponent {
  readonly question = input.required<QuizQuestion>();
  readonly index = input.required<number>();
  readonly segments = input.required<ProgressSegment[]>();
  readonly selected = input<ReadonlySet<string>>(new Set());
  readonly answer = input<RecordedAnswer | null>(null);
  /** Варианты заблокированы: ответ получен или запрос в полёте. */
  readonly locked = input(false);

  readonly optionToggled = output<string>();

  readonly options = computed<OptionView[]>(() => {
    const a = this.answer();
    const selected = a ? new Set(a.optionIds) : this.selected();
    const correct = new Set(a?.correctOptionIds ?? []);
    return this.question().options.map((o, i) => {
      const checked = selected.has(o.id);
      let mark: OptionMark = 'none';
      if (a) {
        if (checked) mark = correct.has(o.id) ? 'ok' : 'bad';
        else if (correct.has(o.id)) mark = 'missed';
      }
      return { id: o.id, text: o.text, key: i + 1, checked, mark };
    });
  });
}
