import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LabelLayerComponent } from '../../viewer/label-layer.component';
import { PANEL_WIDTH_PX, ViewerHostComponent } from '../../viewer/viewer-host.component';
import { QuizCanvas } from './quiz-canvas.service';

/**
 * Раздел тестов: просмотрщик слева, панель справа (Т1). Один холст на `/quiz` и
 * `/quiz/:quizId` — модель не перезагружается при переходе из списка в тест.
 */
@Component({
  selector: 'app-quiz-shell',
  imports: [ViewerHostComponent, LabelLayerComponent, RouterOutlet],
  providers: [QuizCanvas],
  template: `
    <div class="stage">
      <app-viewer-host owner="quiz" [rightInset]="panelWidth" (attached)="canvas.onAttached()" />
      <app-label-layer
        [manifest]="canvas.manifest()"
        [titles]="canvas.titles()"
        [only]="canvas.labelsOnly()"
        [interactive]="false"
      />

      <button type="button" class="atlas-btn reset" (click)="canvas.resetView()">Сбросить вид</button>

      @if (canvas.error()) {
        <div class="status" role="alert">
          <div class="title">Не удалось загрузить модель</div>
          <div class="msg">{{ canvas.errorMessage() }}</div>
          <button type="button" class="atlas-btn" (click)="canvas.retry()">Повторить</button>
        </div>
      } @else if (canvas.loading(); as p) {
        <div class="status" role="status">
          <div class="title">Загрузка модели…</div>
          @if (p.total) {
            <div class="atlas-muted">{{ mb(p.loaded) }} / {{ mb(p.total) }} МБ</div>
          }
        </div>
      }

      <aside class="panel">
        <router-outlet />
      </aside>
    </div>
  `,
  styles: `
    :host { display: block; position: relative; flex: 1; min-height: 0; }
    .stage { position: absolute; inset: 0; }
    .reset { position: absolute; left: var(--atlas-space-lg); bottom: var(--atlas-space-lg); }
    .status {
      position: absolute; top: 50%; left: calc((100% - var(--atlas-panel-width)) / 2);
      transform: translate(-50%, -50%); min-width: 260px;
      padding: var(--atlas-space-lg); border-radius: var(--atlas-radius-md);
      background: var(--atlas-color-surface); border: 1px solid var(--atlas-color-border);
      box-shadow: 0 10px 30px rgba(23, 33, 43, 0.15);
    }
    .status .title { font-weight: 600; margin-bottom: var(--atlas-space-xs); }
    .status .msg { color: var(--atlas-color-text-secondary); margin-bottom: var(--atlas-space-md); }
    .panel {
      position: absolute; top: 0; right: 0; bottom: 0; width: var(--atlas-panel-width);
      display: flex; flex-direction: column; overflow: hidden;
      background: var(--atlas-color-surface); border-left: 1px solid var(--atlas-color-border);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuizShellComponent {
  readonly canvas = inject(QuizCanvas);
  readonly panelWidth = PANEL_WIDTH_PX;

  mb(n: number): string {
    return (n / 1024 / 1024).toFixed(1);
  }
}
