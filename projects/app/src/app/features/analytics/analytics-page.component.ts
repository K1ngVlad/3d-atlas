import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-analytics-page',
  template: `
    <section class="placeholder">
      <h1>Аналитика</h1>
      <p>Раздел аналитики появится позже.</p>
    </section>
  `,
  styles: `
    :host { display: block; flex: 1; padding: var(--atlas-space-xl); }
    .placeholder { max-width: 640px; }
    h1 { margin: 0 0 var(--atlas-space-sm); font-size: 20px; font-weight: 600; }
    p { margin: 0; color: var(--atlas-color-text-muted); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsPageComponent {}
