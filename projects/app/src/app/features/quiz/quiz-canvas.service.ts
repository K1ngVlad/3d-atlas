import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type { SceneManifest, Selection, ViewerOptions } from '@atlas/viewer-core';
import { STRUCTURE_REPO } from '../../data-access/repositories/structure-repository';
import { ViewerService } from '../../viewer/viewer.service';

export type CanvasLabels = 'none' | 'focus' | 'all';

/** Что показать на холсте экрана тестов. */
export interface CanvasScene {
  manifestId: string;
  /** Смена ключа (новый вопрос, итог) — камера в исходный вид или подлёт к части. */
  key: string;
  /** Часть «Что выделено на модели?»: выбор с подлётом и изоляцией. */
  focusPartId: string | null;
  /** Сноски: нет / только выделенной части / все. */
  labels: CanvasLabels;
}

export function sameScene(a: CanvasScene | null, b: CanvasScene | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.manifestId === b.manifestId &&
    a.key === b.key &&
    a.focusPartId === b.focusPartId &&
    a.labels === b.labels
  );
}

function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.partId === b.partId && (a.instance || undefined) === (b.instance || undefined);
}

/**
 * Холст экрана тестов (docs/lab/quiz-ux.md, «Холст во время вопроса»): загрузка
 * модели вопроса, выбор части с подлётом и изоляцией, выключенные наведение,
 * расслоение и сноски. Выбор кликом по модели откатывается к выбору вопроса.
 * Область — оболочка `/quiz` (просмотрщик живёт, пока открыт раздел тестов).
 */
@Injectable()
export class QuizCanvas {
  private readonly viewer = inject(ViewerService);
  private readonly repo = inject(STRUCTURE_REPO);

  /** Манифест, загруженный в ядро. */
  readonly manifest = signal<SceneManifest | null>(null);
  /** Выбор, который держит вопрос (`null` — без выбора). */
  readonly focus = signal<Selection | null>(null);
  readonly labelsMode = signal<CanvasLabels>('none');
  /** Названия частей загруженного манифеста — для сносок. */
  readonly titles = signal<ReadonlyMap<string, string>>(new Map());
  /** Манифест модели не получен (ошибка Catalog / сети). */
  readonly manifestError = signal<boolean>(false);

  readonly loading = computed(() => (this.viewer.error() ? null : this.viewer.loading()));
  readonly error = computed(() => this.viewer.error() !== null || this.manifestError());
  readonly errorMessage = computed(
    () => this.viewer.error()?.message ?? 'Не удалось получить описание модели',
  );
  /** Сноски только выделенной части. */
  readonly labelsOnly = computed<Selection | null>(() =>
    this.labelsMode() === 'focus' ? this.focus() : null,
  );

  private scene: CanvasScene | null = null;
  private appliedKey: string | null = null;
  private loadedId: string | null = null;
  private enforcing = false;
  private seq = 0;

  constructor() {
    // Клик по модели: ядро выбрало часть → вернуть выбор вопроса, без подлёта.
    effect(() => {
      const sel = this.viewer.selection();
      untracked(() => {
        if (!this.enforcing || this.viewer.owner() !== 'quiz') return;
        const want = this.focus();
        if (!sameSelection(sel, want)) this.viewer.select(want, { fly: false });
      });
    });
  }

  show(scene: CanvasScene): void {
    if (sameScene(this.scene, scene)) return;
    this.scene = scene;
    void this.apply();
  }

  /** Новое ядро (холст смонтирован) — загрузить заново. */
  onAttached(): void {
    this.loadedId = null;
    this.appliedKey = null;
    void this.apply();
  }

  retry(): void {
    this.loadedId = null;
    this.appliedKey = null;
    void this.apply();
  }

  resetView(): void {
    const focus = this.focus();
    if (focus) this.viewer.select(focus, { fly: true });
    else this.viewer.resetCamera();
  }

  private async apply(): Promise<void> {
    const scene = this.scene;
    if (!scene || !this.viewer.isAttached) return;
    const seq = ++this.seq;
    const stale = () => seq !== this.seq;
    this.enforcing = false;
    this.manifestError.set(false);

    let manifest: SceneManifest;
    try {
      manifest = await this.repo.getManifest(scene.manifestId);
    } catch {
      if (!stale()) this.manifestError.set(true);
      return;
    }
    if (stale()) return;

    if (this.loadedId !== scene.manifestId) {
      this.focus.set(null);
      this.labelsMode.set('none');
      this.setOptions({ labels: false, hover: false, exploded: false, isolate: false });
      try {
        await this.viewer.load(manifest);
      } catch {
        return; // ошибка — в ViewerService.error, на холсте сообщение как в атласе
      }
      if (stale()) return;
      this.loadedId = scene.manifestId;
      this.appliedKey = null;
      this.manifest.set(manifest);
      void this.loadTitles(manifest);
    }

    const focus = scene.focusPartId ? this.resolveFocus(manifest, scene.focusPartId) : null;
    const labels = scene.labels === 'all' || (scene.labels === 'focus' && focus !== null);
    this.setOptions({ labels, hover: false, exploded: false, isolate: focus !== null });
    if (this.appliedKey !== scene.key || !sameSelection(this.focus(), focus)) {
      this.viewer.select(focus, { fly: focus !== null });
      if (!focus) this.viewer.resetCamera();
    }
    this.appliedKey = scene.key;
    this.focus.set(focus);
    this.labelsMode.set(scene.labels);
    this.enforcing = true;
  }

  /**
   * В ядро — только изменившиеся опции: `exploded: false` при уже собранной модели
   * ядро считает «выходом из расслоения» и возвращает камеру к виду до него —
   * подлёт к части вопроса сбросился бы после ответа.
   */
  private setOptions(want: ViewerOptions): void {
    const cur = this.viewer.options();
    const diff: Partial<ViewerOptions> = {};
    for (const k of Object.keys(want) as (keyof ViewerOptions)[]) {
      if (cur[k] !== want[k]) diff[k] = want[k];
    }
    if (Object.keys(diff).length > 0) this.viewer.setOptions(diff);
  }

  /** Часть с `select: "each"` — первый экземпляр (`listInstances(partId)[0]`). */
  private resolveFocus(manifest: SceneManifest, partId: string): Selection | null {
    const part = manifest.parts.find((p) => p.id === partId);
    if (!part) {
      console.warn(`[quiz] часть "${partId}" не найдена в манифесте "${manifest.id}"`);
      return null;
    }
    const mode = part.select ?? manifest.defaults?.select ?? 'whole';
    if (mode !== 'each') return { partId };
    const instance = this.viewer.listInstances(partId)[0];
    return instance ? { partId, instance } : { partId };
  }

  private async loadTitles(manifest: SceneManifest): Promise<void> {
    const entries = await Promise.all(
      manifest.parts.map(async (p) => {
        const e = p.entity ? await this.repo.getEntity(p.entity) : null;
        return [p.id, e?.title.ru ?? null] as const;
      }),
    );
    if (this.manifest() !== manifest) return;
    const map = new Map<string, string>();
    for (const [id, title] of entries) if (title) map.set(id, title);
    this.titles.set(map);
  }
}
