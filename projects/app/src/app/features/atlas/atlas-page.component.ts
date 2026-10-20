import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AtlasStore } from '../../data-access/atlas.store';
import { BreadcrumbsComponent } from '../../shared/ui/breadcrumbs/breadcrumbs.component';
import { InfoPanelComponent } from '../../shared/ui/info-panel/info-panel.component';
import { ViewToolbarComponent } from '../../shared/ui/view-toolbar/view-toolbar.component';
import { LabelLayerComponent } from '../../viewer/label-layer.component';
import { ViewerHostComponent } from '../../viewer/viewer-host.component';
import { DebugOverlayComponent } from './debug-overlay.component';

@Component({
  selector: 'app-atlas-page',
  imports: [
    ViewerHostComponent,
    LabelLayerComponent,
    BreadcrumbsComponent,
    ViewToolbarComponent,
    InfoPanelComponent,
    DebugOverlayComponent,
  ],
  template: `
    <div class="stage">
      <app-viewer-host></app-viewer-host>
      <app-label-layer></app-label-layer>

      <div class="top-left">
        <app-breadcrumbs></app-breadcrumbs>
      </div>

      <app-view-toolbar class="bottom-center"></app-view-toolbar>

      @if (store.panelOpen()) {
        <app-info-panel class="right"></app-info-panel>
      } @else {
        <button type="button" class="show-panel" (click)="store.togglePanel()">Описание</button>
      }

      @if (loadingVisible(); as p) {
        <div class="loader" role="status">
          <div class="title">Загрузка модели…</div>
          <div class="meter">{{ formatBytes(p.loaded) }}@if (p.total) { / {{ formatBytes(p.total) }} }</div>
        </div>
      }

      @if (store.error(); as e) {
        <div class="error" role="alert">
          <div class="title">Не удалось загрузить модель</div>
          <div class="msg">{{ e.message }}</div>
          <div class="actions">
            <button type="button" (click)="store.retryLoad()">Повторить</button>
            <button type="button" [disabled]="!store.canGoBack()" (click)="store.goBack()">Назад</button>
          </div>
        </div>
      }

      @if (store.debug()) { <app-debug-overlay></app-debug-overlay> }
    </div>
  `,
  styles: `
    :host { display: block; position: relative; flex: 1; min-height: 0; }
    .stage { position: absolute; inset: 0; }
    .top-left {
      position: absolute; top: var(--atlas-space-lg); left: var(--atlas-space-lg);
      display: flex; gap: var(--atlas-space-sm); align-items: center;
    }
    .bottom-center {
      position: absolute; bottom: var(--atlas-space-xl); left: 50%; transform: translateX(-50%);
    }
    .right {
      position: absolute; top: 0; right: 0; bottom: 0;
    }
    .show-panel {
      position: absolute; top: var(--atlas-space-lg); right: var(--atlas-space-lg);
      padding: 8px 14px; min-height: var(--atlas-touch-target);
      background: var(--atlas-color-surface);
      border: 1px solid var(--atlas-color-border);
      border-radius: var(--atlas-radius-sm);
      font: inherit; cursor: pointer;
    }
    .loader, .error {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: var(--atlas-color-surface);
      border: 1px solid var(--atlas-color-border);
      border-radius: var(--atlas-radius-md);
      padding: var(--atlas-space-lg);
      font-family: var(--atlas-font-family); color: var(--atlas-color-text);
      min-width: 280px; box-shadow: 0 10px 30px rgba(23, 33, 43, 0.15);
    }
    .loader .title, .error .title { font-weight: 600; margin-bottom: var(--atlas-space-sm); }
    .loader .meter { color: var(--atlas-color-text-muted); font-variant-numeric: tabular-nums; }
    .error .msg { color: var(--atlas-color-text-secondary); margin-bottom: var(--atlas-space-md); }
    .error .actions { display: flex; gap: var(--atlas-space-sm); }
    .error button {
      padding: 8px var(--atlas-space-md); border-radius: var(--atlas-radius-sm);
      border: 1px solid var(--atlas-color-border); background: var(--atlas-color-surface);
      font: inherit; cursor: pointer;
    }
    .error button:first-child { background: var(--atlas-color-accent); color: #fff; border-color: var(--atlas-color-accent); }
    .error button:disabled { opacity: 0.5; cursor: not-allowed; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AtlasPageComponent {
  readonly store = inject(AtlasStore);
  readonly loadingVisible = computed(() => {
    if (this.store.error()) return null;
    return this.store.loading();
  });

  formatBytes(n: number): string {
    if (!n) return '0 Б';
    if (n < 1024) return `${n} Б`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`;
    return `${(n / 1024 / 1024).toFixed(1)} МБ`;
  }
}
