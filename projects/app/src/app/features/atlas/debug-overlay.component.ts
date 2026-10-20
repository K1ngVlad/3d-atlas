import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AtlasStore } from '../../data-access/atlas.store';

@Component({
  selector: 'app-debug-overlay',
  template: `
    @if (text(); as t) {
      <button type="button" class="badge" (click)="copy()">{{ t }}</button>
    } @else {
      <span class="badge empty">?debug=manifest · наведите курсор</span>
    }
    @if (copied()) { <span class="toast">скопировано</span> }
  `,
  styles: `
    :host { position: absolute; right: var(--atlas-space-lg); bottom: var(--atlas-space-lg); display: flex; gap: var(--atlas-space-sm); align-items: center; pointer-events: auto; }
    .badge {
      font: 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      padding: 6px 10px;
      background: rgba(0,0,0,0.75); color: #e8edf2;
      border: none; border-radius: var(--atlas-radius-sm);
      cursor: pointer;
    }
    .badge.empty { background: rgba(0,0,0,0.4); cursor: default; }
    .toast { color: var(--atlas-color-accent); font-size: 12px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DebugOverlayComponent {
  private readonly store = inject(AtlasStore);
  readonly copied = signal(false);
  readonly text = computed(() => {
    const h = this.store.hover();
    if (!h) return null;
    return h.instance ? `${h.partId}/${h.instance}` : h.partId;
  });

  async copy(): Promise<void> {
    const t = this.text();
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1200);
    } catch {
      // буфер недоступен (http/приватный) — молча
    }
  }
}
