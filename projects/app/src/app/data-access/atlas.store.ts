import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import {
  detailFocus,
  detailId as readDetailId,
  type PartDef,
  type SceneManifest,
  type Selection,
  type ViewState,
  type ViewerOptions,
} from '@atlas/viewer-core';
import { STRUCTURE_REPO, type EntityContent } from './repositories/structure-repository';
import { ViewerService } from '../viewer/viewer.service';

const SESSION_PANEL_OPEN = 'atlas.panelOpen';

export interface LevelFrame {
  manifestId: string;
  manifest: SceneManifest;
  state: ViewState | null;
}

export interface Breadcrumb {
  manifestId: string;
  title: string;
  path: string[];
}

export interface ManifestSource {
  title?: string;
  author?: string;
  authorUrl?: string;
  url?: string;
  platform?: string;
  license?: string;
  modified?: boolean;
}

function readSessionBool(key: string, fallback: boolean): boolean {
  try {
    const v = sessionStorage.getItem(key);
    if (v == null) return fallback;
    return v === '1';
  } catch {
    return fallback;
  }
}

function writeSessionBool(key: string, value: boolean): void {
  try {
    sessionStorage.setItem(key, value ? '1' : '0');
  } catch {
    // приватный режим — молча игнорируем
  }
}

function parsePath(url: string): string[] {
  const match = /^\/atlas(?:\/([^?#]*))?/.exec(url);
  if (!match || !match[1]) return [];
  return match[1].split('/').filter(Boolean);
}

function isAtlasUrl(url: string): boolean {
  return /^\/atlas(?:[/?#]|$)/.test(url);
}

@Injectable({ providedIn: 'root' })
export class AtlasStore {
  private readonly router = inject(Router);
  private readonly repo = inject(STRUCTURE_REPO);
  private readonly viewer = inject(ViewerService);
  private readonly destroyRef = inject(DestroyRef);

  readonly stack = signal<LevelFrame[]>([]);
  readonly options = signal<ViewerOptions>({
    labels: true,
    exploded: false,
    hover: true,
    isolate: false,
  });
  readonly panelOpen = signal<boolean>(readSessionBool(SESSION_PANEL_OPEN, true));
  readonly loading = this.viewer.loading;
  readonly error = this.viewer.error;
  readonly selection = this.viewer.selection;
  readonly hover = this.viewer.hover;
  readonly existingDetails = signal<ReadonlySet<string>>(new Set());
  readonly missingDetails = signal<ReadonlySet<string>>(new Set());
  readonly rootEntity = signal<EntityContent | null>(null);
  readonly selectedEntity = signal<EntityContent | null>(null);
  readonly debug = signal<boolean>(false);
  readonly titles = signal<ReadonlyMap<string, string>>(new Map());
  /** Названия сущностей частей текущего уровня (для сносок и списка «Состав»). */
  readonly partTitles = signal<ReadonlyMap<string, string>>(new Map());

  readonly current = computed<LevelFrame | null>(() => {
    const s = this.stack();
    return s.length > 0 ? s[s.length - 1] : null;
  });
  readonly canGoBack = computed(() => this.stack().length > 1);
  readonly selectedPart = computed<PartDef | null>(() => {
    const sel = this.selection();
    const cur = this.current();
    if (!sel || !cur) return null;
    return cur.manifest.parts.find((p) => p.id === sel.partId) ?? null;
  });
  readonly selectedDetailId = computed<string | null>(() => {
    const part = this.selectedPart();
    return part ? readDetailId(part.detail) : null;
  });
  readonly hasDetailForSelection = computed(() => {
    const id = this.selectedDetailId();
    return id !== null && this.existingDetails().has(id);
  });
  readonly breadcrumbs = computed<Breadcrumb[]>(() => {
    const s = this.stack();
    const titles = this.titles();
    return s.map((frame, i) => ({
      manifestId: frame.manifestId,
      title: titles.get(frame.manifestId) ?? frame.manifest.id,
      path: s.slice(0, i + 1).map((f) => f.manifestId),
    }));
  });
  readonly manifestSource = computed<ManifestSource | null>(() => {
    const cur = this.current();
    if (!cur) return null;
    const src = (cur.manifest as unknown as { source?: ManifestSource }).source;
    return src ?? null;
  });
  readonly isStubCurrent = computed(() => this.current()?.manifest.status === 'stub');

  private pendingDetailFocus: string | null = null;
  private lastLoadedManifestId: string | null = null;
  private syncSeq = 0;

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe((e) => {
        if (!isAtlasUrl(e.urlAfterRedirects)) return;
        void this.syncWithUrl(e.urlAfterRedirects);
      });

    // query-param debug=manifest
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe((e) => {
        if (!isAtlasUrl(e.urlAfterRedirects)) return;
        this.debug.set(/[?&]debug=manifest(?:&|$)/.test(e.urlAfterRedirects));
      });

    // синхронизация ViewerOptions с ядром
    effect(() => this.viewer.setOptions(this.options()));

    // обновление rootEntity при смене current manifest; попутно — title для крошек
    effect(() => {
      const cur = this.current();
      const id = cur?.manifest.entity ?? null;
      this.rootEntity.set(null);
      if (!cur || !id) return;
      const manifestId = cur.manifestId;
      void this.repo.getEntity(id).then((e) => {
        if (this.current()?.manifest.entity === id) this.rootEntity.set(e);
        if (e) {
          this.titles.update((m) => {
            if (m.get(manifestId) === e.title.ru) return m;
            const next = new Map(m);
            next.set(manifestId, e.title.ru);
            return next;
          });
        }
      });
    });

    // предзагрузка title для всех уровней стека (чтобы крошки сразу были читаемы)
    effect(() => {
      const frames = this.stack();
      for (const f of frames) {
        if (this.titles().has(f.manifestId)) continue;
        const entityId = f.manifest.entity;
        if (!entityId) continue;
        void this.repo.getEntity(entityId).then((e) => {
          if (!e) return;
          this.titles.update((m) => {
            if (m.has(f.manifestId)) return m;
            const next = new Map(m);
            next.set(f.manifestId, e.title.ru);
            return next;
          });
        });
      }
    });

    // названия сущностей частей текущего уровня — для сносок и «Состава»
    // (ключ: `${manifestId}/${partId}` — части разных уровней могут совпадать по id)
    effect(() => {
      const cur = this.current();
      if (!cur) return;
      const parts = cur.manifest.parts;
      for (const p of parts) {
        const key = `${cur.manifestId}/${p.id}`;
        if (this.partTitles().has(key)) continue;
        const entityId = p.entity;
        if (!entityId) continue;
        void this.repo.getEntity(entityId).then((e) => {
          if (!e) return;
          this.partTitles.update((m) => {
            if (m.has(key)) return m;
            const next = new Map(m);
            next.set(key, e.title.ru);
            return next;
          });
        });
      }
    });

    // обновление selectedEntity при смене выбора
    effect(() => {
      const part = this.selectedPart();
      const id = part?.entity ?? null;
      this.selectedEntity.set(null);
      if (!id) return;
      void this.repo.getEntity(id).then((e) => {
        if (this.selectedPart()?.entity === id) this.selectedEntity.set(e);
      });
    });

    // двойной клик в ядре → open-detail.
    // Вызов openDetail — через untracked: иначе синхронные чтения сигналов
    // внутри openDetail попали бы в зависимости этого эффекта, и возникла бы
    // петля (stack.update → current меняется → эффект перезапускается).
    effect(() => {
      const req = this.viewer.openDetailRequest();
      if (!req) return;
      untracked(() => void this.openDetail(req.partId, req.detailId));
    });

    // после каждой удачной загрузки в ядре — применить ожидающий focus
    effect(() => {
      const loaded = this.viewer.loaded();
      if (!loaded) return;
      const cur = this.current();
      if (!cur) return;
      if (this.lastLoadedManifestId === cur.manifestId) return;
      this.lastLoadedManifestId = cur.manifestId;
      void this.checkDetailExistence(cur.manifest);
      if (this.pendingDetailFocus) {
        const focus = this.pendingDetailFocus;
        this.pendingDetailFocus = null;
        this.viewer.select({ partId: focus }, { fly: true });
      }
    });
  }

  onViewerAttached(): void {
    void this.syncWithUrl(this.router.url);
  }

  async navigateTo(path: string[]): Promise<void> {
    await this.router.navigate(['/atlas', ...path], { queryParamsHandling: 'preserve' });
  }

  async goBack(): Promise<void> {
    if (!this.canGoBack()) return;
    const path = this.stack()
      .slice(0, -1)
      .map((f) => f.manifestId);
    await this.navigateTo(path);
  }

  async retryLoad(): Promise<void> {
    const cur = this.current();
    if (!cur) return;
    this.lastLoadedManifestId = null;
    await this.viewer.load(cur.manifest);
  }

  select(sel: Selection | null): void {
    this.viewer.select(sel, { fly: true });
  }

  toggleOption<K extends keyof ViewerOptions>(key: K): void {
    this.options.update((o) => ({ ...o, [key]: !o[key] }));
  }

  resetCamera(): void {
    this.viewer.resetCamera();
  }

  togglePanel(): void {
    this.panelOpen.update((v) => {
      const next = !v;
      writeSessionBool(SESSION_PANEL_OPEN, next);
      return next;
    });
  }

  async openDetail(partId: string, detailId: string): Promise<void> {
    const cur = this.current();
    if (!cur) return;
    try {
      const exists = await this.repo.manifestExists(detailId);
      if (!exists) {
        console.warn(`[atlas] detail "${detailId}" не найден`);
        this.missingDetails.update((s) => {
          const next = new Set(s);
          next.add(detailId);
          return next;
        });
        return;
      }
      // сохраняем состояние верхнего уровня в стек ДО перехода
      this.saveStateOnTop();
      const part = cur.manifest.parts.find((p) => p.id === partId);
      this.pendingDetailFocus = part ? detailFocus(part.detail) : null;
      const path = this.stack()
        .map((f) => f.manifestId)
        .concat(detailId);
      await this.navigateTo(path);
    } catch (err) {
      console.warn('[atlas] openDetail failed:', err);
    }
  }

  private saveStateOnTop(): void {
    const state = this.viewer.getViewState();
    if (!state) return;
    this.stack.update((s) => {
      if (s.length === 0) return s;
      const top = s[s.length - 1];
      return [...s.slice(0, -1), { ...top, state }];
    });
  }

  private async syncWithUrl(url: string): Promise<void> {
    // Последний вызов отменяет предыдущий: после каждого await проверяем,
    // не пришёл ли более новый URL.
    const seq = ++this.syncSeq;
    const stale = () => seq !== this.syncSeq;
    const segments = parsePath(url);
    // '/atlas' без пути редиректится маршрутом (atlas.routes), здесь ничего не делаем
    if (segments.length === 0) return;
    const prev = this.stack();
    const targetTop = segments[segments.length - 1];

    // 1) возврат на один уровень
    if (
      prev.length >= 2 &&
      segments.length === prev.length - 1 &&
      segments.every((s, i) => s === prev[i].manifestId)
    ) {
      const nextStack = prev.slice(0, -1);
      this.stack.set(nextStack);
      const top = nextStack[nextStack.length - 1];
      this.lastLoadedManifestId = null;
      // viewer ещё не прикреплён (NavigationEnd до attach) — загрузку запустит onViewerAttached
      if (!this.viewer.isAttached) return;
      try {
        await this.viewer.load(top.manifest, { restore: top.state ?? undefined });
      } catch {
        // ошибка уже проброшена в сигналы viewer
      }
      return;
    }

    // 2) переход вглубь на один уровень
    if (
      prev.length >= 1 &&
      segments.length === prev.length + 1 &&
      segments.slice(0, -1).every((s, i) => s === prev[i].manifestId)
    ) {
      try {
        const manifest = await this.repo.getManifest(targetTop);
        if (stale()) return;
        this.stack.update((s) => [...s, { manifestId: targetTop, manifest, state: null }]);
        this.lastLoadedManifestId = null;
        if (!this.viewer.isAttached) return;
        await this.viewer.load(manifest);
      } catch {
        // ошибка проброшена
      }
      return;
    }

    // 3) внешняя навигация — построить стек с нуля
    try {
      const frames: LevelFrame[] = [];
      for (const id of segments) {
        const manifest = await this.repo.getManifest(id);
        if (stale()) return;
        frames.push({ manifestId: id, manifest, state: null });
      }
      this.stack.set(frames);
      this.lastLoadedManifestId = null;
      if (!this.viewer.isAttached) return;
      await this.viewer.load(frames[frames.length - 1].manifest);
    } catch {
      // в случае ошибки стек оставляем прежним — пользователь увидит сообщение
    }
  }

  private async checkDetailExistence(manifest: SceneManifest): Promise<void> {
    const ids = new Set<string>();
    for (const p of manifest.parts) {
      const id = readDetailId(p.detail);
      if (id) ids.add(id);
    }
    if (ids.size === 0) return;
    const existing = new Set(this.existingDetails());
    const missing = new Set(this.missingDetails());
    await Promise.all(
      [...ids].map(async (id) => {
        if (existing.has(id) || missing.has(id)) return;
        const ok = await this.repo.manifestExists(id);
        if (ok) existing.add(id);
        else {
          missing.add(id);
          console.warn(`[atlas] detail-манифест "${id}" не найден`);
        }
      }),
    );
    this.existingDetails.set(existing);
    this.missingDetails.set(missing);
  }
}

