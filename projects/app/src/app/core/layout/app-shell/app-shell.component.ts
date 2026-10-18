import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

interface NavLink {
  readonly label: string;
  readonly path: string;
}

const NAV_LINKS: readonly NavLink[] = [
  { label: 'Атлас', path: '/atlas' },
  { label: 'Тесты', path: '/quiz' },
  { label: 'Загрузка моделей', path: '/upload' },
  { label: 'Аналитика', path: '/analytics' },
];

@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  protected readonly links = NAV_LINKS;
}
