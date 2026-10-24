import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { readDetailId } from './detail-id';
import { AtlasStore } from '../../../data-access/atlas.store';

@Component({
  selector: 'app-info-panel',
  template: `
    <aside>
      <header>
        <h2>{{ title() }}</h2>
        <button type="button" class="close" (click)="store.togglePanel()" aria-label="Скрыть панель">×</button>
      </header>

      @if (summary(); as text) {
        <p class="summary">{{ text }}</p>
      } @else {
        <p class="summary muted">Нет описания.</p>
      }

      @if (showDetailButton()) {
        <button type="button" class="detail" (click)="openDetail()">Подробнее →</button>
      }

      @if (!store.selection()) {
        <section class="parts">
          <h3>Состав</h3>
          <ul>
            @for (p of parts(); track p.id) {
              <li>
                <button type="button" (click)="selectPart(p.id)">
                  <span>{{ partTitle(p.id, p.entity) }}</span>
                  @if (hasDetail(p)) { <span class="badge">детально</span> }
                </button>
              </li>
            }
          </ul>
        </section>
      }

      @if (source(); as src) {
        <footer>
          <h3>Источник модели</h3>
          <p>
            @if (src.title) { <strong>{{ src.title }}</strong><br/> }
            @if (src.author) { Автор: <a [href]="src.authorUrl" target="_blank" rel="noopener">{{ src.author }}</a><br/> }
            @if (src.platform) { Площадка: {{ src.platform }}<br/> }
            @if (src.license) { Лицензия: {{ src.license }}<br/> }
            @if (src.modified) { <em>модель изменена</em> }
          </p>
        </footer>
      }
    </aside>
  `,
  styles: `
    :host { display: block; width: var(--atlas-panel-width, 360px); height: 100%; }
    aside {
      display: flex; flex-direction: column; height: 100%;
      background: var(--atlas-color-surface);
      border-left: 1px solid var(--atlas-color-border);
      font-family: var(--atlas-font-family);
      color: var(--atlas-color-text);
      overflow-y: auto;
    }
    header { display: flex; align-items: start; justify-content: space-between; padding: var(--atlas-space-lg); border-bottom: 1px solid var(--atlas-color-border); }
    header h2 { margin: 0; font-size: 20px; font-weight: 600; }
    .close {
      border: none; background: transparent; font-size: 24px; line-height: 1;
      color: var(--atlas-color-text-muted); cursor: pointer; padding: 0 4px;
    }
    .summary { margin: var(--atlas-space-md) var(--atlas-space-lg); color: var(--atlas-color-text-secondary); line-height: 1.5; }
    .summary.muted { color: var(--atlas-color-text-muted); font-style: italic; }
    .detail {
      margin: 0 var(--atlas-space-lg) var(--atlas-space-md);
      padding: 10px var(--atlas-space-md);
      background: var(--atlas-color-accent);
      color: #fff; border: none;
      border-radius: var(--atlas-radius-sm);
      cursor: pointer; font: inherit; font-weight: 600;
    }
    .detail:hover { background: var(--atlas-color-accent-dark); }
    .parts { padding: 0 var(--atlas-space-lg); }
    .parts h3 { margin: 0 0 var(--atlas-space-sm); font-size: 14px; color: var(--atlas-color-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .parts ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--atlas-space-xs); }
    .parts button {
      width: 100%; text-align: left;
      padding: 10px var(--atlas-space-md);
      background: var(--atlas-color-bg);
      border: 1px solid var(--atlas-color-border);
      border-radius: var(--atlas-radius-sm);
      font: inherit; color: inherit; cursor: pointer;
      display: flex; align-items: center; justify-content: space-between; gap: var(--atlas-space-sm);
    }
    .parts button:hover { background: var(--atlas-color-accent-bg); border-color: var(--atlas-color-accent); }
    .badge {
      font-size: 11px; padding: 2px 8px; border-radius: var(--atlas-radius-pill);
      background: var(--atlas-color-accent-bg); color: var(--atlas-color-accent-dark);
    }
    footer { margin-top: auto; padding: var(--atlas-space-lg); border-top: 1px solid var(--atlas-color-border); color: var(--atlas-color-text-muted); font-size: 13px; }
    footer h3 { margin: 0 0 var(--atlas-space-xs); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    footer a { color: var(--atlas-color-accent); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InfoPanelComponent {
  readonly store = inject(AtlasStore);

  readonly title = computed(() => {
    const sel = this.store.selectedEntity();
    if (sel) return sel.title.ru;
    const root = this.store.rootEntity();
    if (root) return root.title.ru;
    return this.store.current()?.manifest.id ?? '…';
  });
  readonly summary = computed(() => {
    const sel = this.store.selectedEntity();
    if (sel) return sel.summary.ru;
    const root = this.store.rootEntity();
    return root?.summary.ru ?? null;
  });
  readonly parts = computed(() => this.store.current()?.manifest.parts ?? []);
  readonly source = computed(() => this.store.manifestSource());
  readonly showDetailButton = computed(() => this.store.hasDetailForSelection());

  selectPart(id: string): void {
    this.store.select({ partId: id });
  }
  partTitle(id: string, entity?: string): string {
    const cur = this.store.current();
    if (cur) {
      const title = this.store.partTitles().get(`${cur.manifestId}/${id}`);
      if (title) return title;
    }
    return entity ?? id;
  }
  hasDetail(p: { detail?: unknown }): boolean {
    const id = readDetailId(p.detail);
    return id !== null && this.store.existingDetails().has(id);
  }
  openDetail(): void {
    const sel = this.store.selection();
    const detailId = this.store.selectedDetailId();
    if (!sel || !detailId) return;
    void this.store.openDetail(sel.partId, detailId);
  }
}
