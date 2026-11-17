import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { httpStatus } from '../../core/http/http-status';
import { QuizProgressStorage } from '../../data-access/quiz-progress.storage';
import {
  QUIZ_REPO,
  type AnswerEntity,
  type AttemptDetail,
  type CompleteResult,
  type QuizDetail,
  type QuizQuestion,
} from '../../data-access/repositories/quiz-repository';
import { QuizCanvas, sameScene, type CanvasScene } from './quiz-canvas.service';

export type RunPhase = 'loading' | 'not-found' | 'error' | 'question' | 'result';

/** Ответ на вопрос, как его показывает экран. */
export interface RecordedAnswer {
  optionIds: string[];
  correct: boolean;
  correctOptionIds: string[];
  /**
   * Органоид из Catalog: `null` — Catalog был недоступен («Описание сейчас недоступно»);
   * `undefined` — ответ восстановлен из попытки, описания нет (карточку не показываем).
   */
  entity?: AnswerEntity | null;
}

export type SegmentState = 'correct' | 'wrong' | 'pending';

export interface ProgressSegment {
  state: SegmentState;
  current: boolean;
}

export interface ResultItem {
  questionId: string;
  text: string;
  correct: boolean;
  answered: boolean;
  /** Тексты верных вариантов (показываются у неверных). */
  correctTexts: string[];
}

const MSG_LOAD = 'Не удалось загрузить тест. Проверьте соединение и попробуйте ещё раз.';
const MSG_START = 'Не удалось начать тест. Проверьте соединение и попробуйте ещё раз.';
const MSG_ANSWER = 'Не удалось отправить ответ. Проверьте соединение и попробуйте ещё раз.';
const MSG_COMPLETE = 'Не удалось завершить тест. Проверьте соединение и попробуйте ещё раз.';
const MSG_LOST = 'Попытка не найдена на сервере. Начните тест заново.';

function fromAttempt(a: AttemptDetail): Map<string, RecordedAnswer> {
  const m = new Map<string, RecordedAnswer>();
  for (const x of a.answers) {
    m.set(x.questionId, {
      optionIds: x.optionIds,
      correct: x.correct,
      correctOptionIds: x.correctOptionIds,
    });
  }
  return m;
}

/**
 * Прохождение теста `/quiz/:quizId` (docs/lab/quiz-ux.md): старт или продолжение
 * попытки, вопрос, ответ, «Не знаю», обратная связь, итог; управляет холстом через
 * `QuizCanvas` (ViewerService). Область — страница прохождения.
 */
@Injectable()
export class QuizRunStore {
  private readonly repo = inject(QUIZ_REPO);
  private readonly progress = inject(QuizProgressStorage);
  private readonly canvas = inject(QuizCanvas);

  readonly phase = signal<RunPhase>('loading');
  readonly loadError = signal<string | null>(null);
  readonly quiz = signal<QuizDetail | null>(null);
  readonly attemptId = signal<string | null>(null);
  readonly answers = signal<ReadonlyMap<string, RecordedAnswer>>(new Map());
  readonly index = signal(0);
  readonly selected = signal<ReadonlySet<string>>(new Set());
  /** Запрос ответа / завершения в полёте — кнопки заблокированы. */
  readonly busy = signal(false);
  /** Ошибка под кнопкой (ответ, завершение). */
  readonly actionError = signal<string | null>(null);
  readonly result = signal<CompleteResult | null>(null);

  readonly questions = computed<QuizQuestion[]>(() =>
    [...(this.quiz()?.questions ?? [])].sort((a, b) => a.order - b.order),
  );
  readonly current = computed<QuizQuestion | null>(() => this.questions()[this.index()] ?? null);
  readonly currentAnswer = computed<RecordedAnswer | null>(() => {
    const q = this.current();
    return q ? (this.answers().get(q.id) ?? null) : null;
  });
  readonly isLast = computed(() => this.index() >= this.questions().length - 1);
  readonly canSubmit = computed(
    () =>
      this.phase() === 'question' &&
      this.current() !== null &&
      this.currentAnswer() === null &&
      this.selected().size > 0 &&
      !this.busy(),
  );
  readonly segments = computed<ProgressSegment[]>(() => {
    const answers = this.answers();
    const idx = this.index();
    return this.questions().map((q, i) => {
      const a = answers.get(q.id);
      return { state: a ? (a.correct ? 'correct' : 'wrong') : 'pending', current: i === idx };
    });
  });
  readonly resultItems = computed<ResultItem[]>(() => {
    const answers = this.answers();
    return this.questions().map((q) => {
      const a = answers.get(q.id);
      const texts = (a?.correctOptionIds ?? [])
        .map((id) => q.options.find((o) => o.id === id)?.text)
        .filter((t): t is string => !!t);
      return {
        questionId: q.id,
        text: q.text,
        correct: a?.correct ?? false,
        answered: !!a,
        correctTexts: texts,
      };
    });
  });

  /** Что на холсте сейчас (docs/lab/quiz-ux.md, «Холст во время вопроса», «Итог»). */
  private readonly scene = computed<CanvasScene | null>(
    () => {
      const quiz = this.quiz();
      if (!quiz) return null;
      if (this.phase() === 'result') {
        return { manifestId: quiz.manifestId, key: 'result', focusPartId: null, labels: 'all' };
      }
      const q = this.current();
      if (this.phase() !== 'question' || !q) return null;
      const focusPartId = q.manifestId && q.partId ? q.partId : null;
      return {
        manifestId: q.manifestId ?? quiz.manifestId,
        key: q.id,
        focusPartId,
        // после ответа название части — уже не подсказка
        labels: focusPartId && this.currentAnswer() ? 'focus' : 'none',
      };
    },
    { equal: sameScene },
  );

  private quizId: string | null = null;
  private runSeq = 0;

  constructor() {
    effect(() => {
      const s = this.scene();
      if (s) untracked(() => this.canvas.show(s));
    });
  }

  /** Открыть тест: продолжить сохранённую незавершённую попытку или начать новую. */
  async start(quizId: string): Promise<void> {
    const seq = ++this.runSeq;
    const stale = () => seq !== this.runSeq;
    this.quizId = quizId;
    this.phase.set('loading');
    this.loadError.set(null);
    this.quiz.set(null);
    this.attemptId.set(null);
    this.answers.set(new Map());
    this.index.set(0);
    this.selected.set(new Set());
    this.busy.set(false);
    this.actionError.set(null);
    this.result.set(null);

    let quiz: QuizDetail;
    try {
      quiz = await this.repo.getQuiz(quizId);
    } catch (err) {
      if (stale()) return;
      if (httpStatus(err) === 404) this.phase.set('not-found');
      else this.fail(MSG_LOAD);
      return;
    }
    if (stale()) return;
    this.quiz.set(quiz);

    try {
      const saved = this.progress.getAttemptId(quizId);
      let attempt: AttemptDetail | null = null;
      if (saved) {
        try {
          const a = await this.repo.getAttempt(saved);
          if (!a.completedAt && a.quizId === quizId) attempt = a;
        } catch (err) {
          if (httpStatus(err) !== 404) throw err;
        }
        if (stale()) return;
        if (!attempt) this.progress.forgetAttempt(quizId);
      }

      if (attempt) {
        this.attemptId.set(attempt.attemptId);
        this.answers.set(fromAttempt(attempt));
        this.index.set(this.firstUnanswered());
      } else {
        const started = await this.repo.startAttempt(quizId);
        if (stale()) return;
        this.progress.saveAttemptId(quizId, started.attemptId);
        this.attemptId.set(started.attemptId);
      }
      this.phase.set('question');
    } catch {
      if (!stale()) this.fail(MSG_START);
    }
  }

  retry(): void {
    if (this.quizId) void this.start(this.quizId);
  }

  /** «Пройти ещё раз»: новая попытка. */
  retake(): void {
    if (!this.quizId) return;
    this.progress.forgetAttempt(this.quizId);
    void this.start(this.quizId);
  }

  toggle(optionId: string): void {
    const q = this.current();
    if (!q || this.phase() !== 'question' || this.currentAnswer() || this.busy()) return;
    if (q.type === 'single') {
      this.selected.set(new Set([optionId]));
      return;
    }
    this.selected.update((s) => {
      const next = new Set(s);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  }

  /** Клавиши `1`–`9`. */
  pressDigit(n: number): void {
    const opt = this.current()?.options[n - 1];
    if (opt) this.toggle(opt.id);
  }

  /** `Enter`: «Ответить» / «Дальше». */
  pressEnter(): void {
    if (this.phase() !== 'question' || this.busy()) return;
    if (this.currentAnswer()) void this.next();
    else if (this.canSubmit()) void this.submit();
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    await this.send([...this.selected()]);
  }

  /** «Не знаю»: пустой ответ, засчитывается неверным, правильный ответ показывается. */
  async dontKnow(): Promise<void> {
    if (this.phase() !== 'question' || !this.current() || this.currentAnswer() || this.busy()) {
      return;
    }
    this.selected.set(new Set());
    await this.send([]);
  }

  /** «Дальше →» / «Завершить тест». */
  async next(): Promise<void> {
    if (!this.currentAnswer() || this.busy()) return;
    if (this.isLast()) {
      await this.complete();
      return;
    }
    this.index.update((i) => i + 1);
    this.selected.set(new Set());
    this.actionError.set(null);
  }

  private async send(optionIds: string[]): Promise<void> {
    const q = this.current();
    const attemptId = this.attemptId();
    if (!q || !attemptId) return;
    const seq = this.runSeq;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      const r = await this.repo.submitAnswer(attemptId, q.id, optionIds);
      if (seq !== this.runSeq) return;
      this.answers.update((m) => new Map(m).set(q.id, { optionIds, ...r }));
    } catch (err) {
      if (seq !== this.runSeq) return;
      const status = httpStatus(err);
      if (status === 409) await this.recoverConflict(q.id);
      else if (status === 404) this.attemptLost();
      else this.actionError.set(MSG_ANSWER);
    } finally {
      if (seq === this.runSeq) this.busy.set(false);
    }
  }

  /**
   * `409` на ответ: уже отвечено (двойной клик, вторая вкладка) — показать
   * сохранённый результат вопроса; попытка завершена — перейти к итогу.
   */
  private async recoverConflict(questionId: string): Promise<void> {
    const attemptId = this.attemptId();
    if (!attemptId) return;
    try {
      const a = await this.repo.getAttempt(attemptId);
      const fresh = fromAttempt(a);
      this.answers.update((m) => {
        const merged = new Map(fresh);
        // описание органоида, полученное раньше, не теряем
        for (const [id, local] of m) {
          const f = merged.get(id);
          if (f && local.entity !== undefined) merged.set(id, { ...f, entity: local.entity });
        }
        return merged;
      });
      if (a.completedAt) {
        this.finish({ score: a.score ?? 0, total: a.total, completedAt: a.completedAt });
        return;
      }
      if (fresh.has(questionId)) this.selected.set(new Set(fresh.get(questionId)!.optionIds));
      else this.actionError.set(MSG_ANSWER);
    } catch (err) {
      if (httpStatus(err) === 404) this.attemptLost();
      else this.actionError.set(MSG_ANSWER);
    }
  }

  private async complete(): Promise<void> {
    const attemptId = this.attemptId();
    if (!attemptId) return;
    const seq = this.runSeq;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      const r = await this.repo.completeAttempt(attemptId);
      if (seq !== this.runSeq) return;
      this.finish(r);
    } catch (err) {
      if (seq !== this.runSeq) return;
      if (httpStatus(err) === 404) this.attemptLost();
      else this.actionError.set(MSG_COMPLETE);
    } finally {
      if (seq === this.runSeq) this.busy.set(false);
    }
  }

  private finish(r: CompleteResult): void {
    if (this.quizId) {
      this.progress.saveLastResult(this.quizId, r);
      this.progress.forgetAttempt(this.quizId);
    }
    this.result.set(r);
    this.selected.set(new Set());
    this.phase.set('result');
  }

  private attemptLost(): void {
    if (this.quizId) this.progress.forgetAttempt(this.quizId);
    this.fail(MSG_LOST);
  }

  private fail(message: string): void {
    this.loadError.set(message);
    this.phase.set('error');
  }

  /** Первый вопрос без ответа; все отвечены — последний (откуда «Завершить тест»). */
  private firstUnanswered(): number {
    const qs = this.questions();
    const answers = this.answers();
    const i = qs.findIndex((q) => !answers.has(q.id));
    return i === -1 ? Math.max(qs.length - 1, 0) : i;
  }
}
