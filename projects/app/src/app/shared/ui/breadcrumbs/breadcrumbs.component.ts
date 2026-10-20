import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AtlasStore } from '../../../data-access/atlas.store';

@Component({
  selector: 'app-breadcrumbs',
  template: `
    <nav>
      @if (store.canGoBack()) {
        <button type="button" class="back" (click)="store.goBack()" aria-label="Назад">←</button>
      }
      @for (c of store.breadcrumbs(); track c.manifestId; let last = $last) {
        @if (!last) {
          <button type="button" class="crumb" (click)="store.navigateTo(c.path)">{{ c.title }}</button>
          <span class="sep">›</span>
        } @else {
          <button
            type="button"
            class="crumb current"
            [disabled]="!canReset()"
            (click)="resetToOverview()"
          >{{ c.title }}</button>
        }
      }
    </nav>
  `,
  styles: `
    :host { display: block; }
    nav {
      display: inline-flex; align-items: center; gap: var(--atlas-space-xs);
      padding: 4px;
      background: var(--atlas-color-surface);
      border: 1px solid var(--atlas-color-border);
      border-radius: var(--atlas-radius-pill);
      font-family: var(--atlas-font-family);
      color: var(--atlas-color-text);
      box-shadow: 0 2px 8px rgba(23, 33, 43, 0.08);
    }
    .back, .crumb {
      border: none; background: transparent;
      padding: 6px 12px; min-height: 32px;
      font: inherit; color: inherit; cursor: pointer;
      border-radius: var(--atlas-radius-pill);
      line-height: 1;
    }
    .back { padding: 6px 10px; font-size: 18px; }
    .back:hover, .crumb:hover:not(:disabled) { background: var(--atlas-color-bg); }
    .crumb.current {
      background: var(--atlas-color-accent-bg);
      color: var(--atlas-color-accent-dark);
    }
    .crumb.current:hover:not(:disabled) { background: var(--atlas-color-accent-bg); filter: brightness(0.95); }
    .crumb.current:disabled { cursor: default; }
    .sep { color: var(--atlas-color-text-muted); padding: 0 2px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BreadcrumbsComponent {
  readonly store = inject(AtlasStore);
  // Корневая крошка кликабельна, если на текущем уровне что-то выбрано —
  // клик по ней работает как клик по пустому пространству (сброс выделения).
  readonly canReset = computed(() => this.store.selection() !== null);

  resetToOverview(): void {
    if (!this.canReset()) return;
    this.store.select(null);
  }
}
