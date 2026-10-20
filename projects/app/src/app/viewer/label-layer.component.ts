import { ChangeDetectionStrategy, Component } from '@angular/core';

// Заглушка. Ядро пока не публикует якорей (этап 4). Компонент занимает слой
// над холстом, чтобы в этап 4 добавить сюда HTML-сноски без перестройки шаблона.
@Component({
  selector: 'app-label-layer',
  template: ``,
  styles: `
    :host { position: absolute; inset: 0; pointer-events: none; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LabelLayerComponent {}
