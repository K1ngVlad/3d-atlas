export interface ClickDetectorOptions {
  dragThresholdPx?: number;
  doubleClickMs?: number;
  onSingle: (ev: PointerEvent) => void;
  onDouble: (ev: PointerEvent) => void;
}

/**
 * Различает одиночный, двойной клик и перетаскивание.
 * - сдвиг указателя > dragThresholdPx между down и up → не клик.
 * - второй up в окне doubleClickMs и близко → double; single не выдаётся.
 * - иначе single выдаётся по истечении окна (чтобы double не выдавал оба события).
 */
export function attachClickDetector(target: HTMLElement, opts: ClickDetectorOptions): () => void {
  const dragThreshold = opts.dragThresholdPx ?? 4;
  const doubleMs = opts.doubleClickMs ?? 280;

  let downX = 0;
  let downY = 0;
  let maxMove = 0;
  let pendingSingle: { ev: PointerEvent; x: number; y: number; timer: number } | null = null;

  const onDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    downX = ev.clientX;
    downY = ev.clientY;
    maxMove = 0;
  };

  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - downX;
    const dy = ev.clientY - downY;
    const d = Math.hypot(dx, dy);
    if (d > maxMove) maxMove = d;
  };

  const onUp = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    if (maxMove > dragThreshold) return;
    if (pendingSingle) {
      const dx = ev.clientX - pendingSingle.x;
      const dy = ev.clientY - pendingSingle.y;
      if (Math.hypot(dx, dy) <= dragThreshold * 3) {
        clearTimeout(pendingSingle.timer);
        pendingSingle = null;
        opts.onDouble(ev);
        return;
      }
      clearTimeout(pendingSingle.timer);
      opts.onSingle(pendingSingle.ev);
      pendingSingle = null;
    }
    const cloned = ev;
    const x = ev.clientX;
    const y = ev.clientY;
    const timer = window.setTimeout(() => {
      pendingSingle = null;
      opts.onSingle(cloned);
    }, doubleMs);
    pendingSingle = { ev: cloned, x, y, timer };
  };

  target.addEventListener('pointerdown', onDown);
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);

  return () => {
    target.removeEventListener('pointerdown', onDown);
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    if (pendingSingle) {
      clearTimeout(pendingSingle.timer);
      pendingSingle = null;
    }
  };
}
