import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AtlasStore } from '../../../data-access/atlas.store';

@Component({
  selector: 'app-view-toolbar',
  template: `
    <div class="bar">
      <button
        type="button"
        [class.active]="labels()"
        [disabled]="loading()"
        (click)="store.toggleOption('labels')"
      >Сноски</button>
      <button
        type="button"
        [class.active]="exploded()"
        [disabled]="loading()"
        (click)="store.toggleOption('exploded')"
      >Расслоить</button>
      <button type="button" disabled title="В разработке">Подсветка</button>
      <button
        type="button"
        [class.active]="isolate()"
        [disabled]="loading()"
        (click)="store.toggleOption('isolate')"
      >Изоляция</button>
      <button type="button" [disabled]="loading()" (click)="store.resetCamera()">Сбросить вид</button>
    </div>
  `,
  styles: `
    :host { display: block; }
    .bar {
      display: flex; gap: var(--atlas-space-xs);
      padding: var(--atlas-space-xs);
      background: var(--atlas-color-surface);
      border: 1px solid var(--atlas-color-border);
      border-radius: var(--atlas-radius-pill);
      font-family: var(--atlas-font-family);
      box-shadow: 0 2px 8px rgba(23, 33, 43, 0.08);
    }
    button {
      padding: 8px 14px;
      min-height: 36px;
      border: 1px solid transparent;
      background: transparent;
      border-radius: var(--atlas-radius-pill);
      font: inherit;
      color: var(--atlas-color-text);
      cursor: pointer;
    }
    button:hover:not(:disabled) { background: var(--atlas-color-bg); }
    button:disabled { color: var(--atlas-color-text-muted); cursor: not-allowed; }
    button.active { background: var(--atlas-color-accent-bg); border-color: var(--atlas-color-accent); color: var(--atlas-color-accent-dark); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewToolbarComponent {
  readonly store = inject(AtlasStore);
  readonly labels = computed(() => this.store.options().labels);
  readonly exploded = computed(() => this.store.options().exploded);
  readonly isolate = computed(() => this.store.options().isolate);
  readonly loading = computed(() => this.store.loading() !== null);
}
