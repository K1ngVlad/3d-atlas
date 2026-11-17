import { Injectable, computed, inject, signal } from '@angular/core';
import {
  ANALYTICS_REPO,
  type AnalyticsSummary,
  type EntityStat,
  type QuestionStat,
} from '../../data-access/repositories/analytics-repository';
import { QUIZ_REPO, type QuizSummary } from '../../data-access/repositories/quiz-repository';
import { STRUCTURE_REPO } from '../../data-access/repositories/structure-repository';
import type { StatRow } from './ui/stat-table.component';

export type AnalyticsStatus = 'loading' | 'ready' | 'error';

/**
 * Экран аналитики: сводка, трудные органоиды, статистика вопросов. Названия
 * сущностей — из Catalog (`STRUCTURE_REPO`), тексты вопросов — из Quiz (`QUIZ_REPO`):
 * Analytics хранит только идентификаторы.
 */
@Injectable()
export class AnalyticsStore {
  private readonly analytics = inject(ANALYTICS_REPO);
  private readonly quizRepo = inject(QUIZ_REPO);
  private readonly structure = inject(STRUCTURE_REPO);

  readonly status = signal<AnalyticsStatus>('loading');
  /** Обновление после первой загрузки не удалось — данные прежние. */
  readonly refreshFailed = signal(false);
  readonly refreshing = signal(false);
  readonly updatedAt = signal<Date | null>(null);

  readonly summary = signal<AnalyticsSummary | null>(null);
  readonly entities = signal<EntityStat[]>([]);
  readonly questions = signal<QuestionStat[]>([]);
  readonly quizzes = signal<QuizSummary[]>([]);
  /** Фильтр таблицы вопросов; `null` — все тесты. */
  readonly quizFilter = signal<string | null>(null);

  readonly entityTitles = signal<ReadonlyMap<string, string>>(new Map());
  readonly questionTexts = signal<ReadonlyMap<string, string>>(new Map());

  readonly empty = computed(() => {
    const s = this.summary();
    return !!s && s.answersTotal === 0 && s.attemptsCompleted === 0;
  });

  readonly entityRows = computed<StatRow[]>(() => {
    const titles = this.entityTitles();
    return this.entities().map((e) => ({
      key: e.entityId,
      label: titles.get(e.entityId) ?? e.entityId,
      answersTotal: e.answersTotal,
      correctRatePct: e.correctRatePct,
    }));
  });

  readonly questionRows = computed<StatRow[]>(() => {
    const texts = this.questionTexts();
    const entities = this.entityTitles();
    const quizTitles = new Map(this.quizzes().map((q) => [q.id, q.title]));
    const all = !this.quizFilter();
    return [...this.questions()]
      .sort((a, b) => a.correctRatePct - b.correctRatePct)
      .map((q) => {
        const hints = [entities.get(q.entityId) ?? q.entityId];
        if (all) hints.unshift(quizTitles.get(q.quizId) ?? q.quizId);
        return {
          key: q.questionId,
          // текст ещё грузится или Quiz недоступен — показываем id
          label: texts.get(q.questionId) ?? `Вопрос ${q.questionId.slice(0, 8)}…`,
          hint: hints.join(' · '),
          answersTotal: q.answersTotal,
          correctRatePct: q.correctRatePct,
        };
      });
  });

  private inFlight: Promise<void> | null = null;
  private readonly loadedQuizzes = new Set<string>();

  /** Первая загрузка и кнопка «Обновить»; параллельные вызовы склеиваются. */
  refresh(): Promise<void> {
    this.inFlight ??= this.doRefresh().finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  setQuizFilter(quizId: string | null): void {
    if (this.quizFilter() === quizId) return;
    this.quizFilter.set(quizId);
    void this.loadQuestions();
  }

  private async doRefresh(): Promise<void> {
    const first = this.status() !== 'ready';
    this.refreshing.set(true);
    try {
      const [summary, entities, questions] = await Promise.all([
        this.analytics.getSummary(),
        this.analytics.getEntities(),
        this.analytics.getQuestions(this.quizFilter()),
      ]);
      this.summary.set(summary);
      this.entities.set(entities);
      this.questions.set(questions);
      this.status.set('ready');
      this.refreshFailed.set(false);
      this.updatedAt.set(new Date());
      void this.resolveNames();
    } catch {
      if (first) this.status.set('error');
      else this.refreshFailed.set(true);
    } finally {
      this.refreshing.set(false);
    }
  }

  private async loadQuestions(): Promise<void> {
    const filter = this.quizFilter();
    try {
      const questions = await this.analytics.getQuestions(filter);
      if (this.quizFilter() !== filter) return;
      this.questions.set(questions);
      void this.resolveNames();
    } catch {
      this.refreshFailed.set(true);
    }
  }

  /** Список тестов для фильтра (Quiz недоступен — фильтр просто пуст). */
  async loadQuizzes(): Promise<void> {
    try {
      this.quizzes.set(await this.quizRepo.listQuizzes());
    } catch {
      this.quizzes.set([]);
    }
  }

  private async resolveNames(): Promise<void> {
    const entityIds = new Set<string>([
      ...this.entities().map((e) => e.entityId),
      ...this.questions().map((q) => q.entityId),
    ]);
    const known = this.entityTitles();
    const missing = [...entityIds].filter((id) => id && !known.has(id));
    const quizIds = [...new Set(this.questions().map((q) => q.quizId))].filter(
      (id) => !this.loadedQuizzes.has(id),
    );

    await Promise.all([
      ...missing.map(async (id) => {
        const e = await this.structure.getEntity(id);
        if (!e) return;
        this.entityTitles.update((m) => new Map(m).set(id, e.title.ru));
      }),
      ...quizIds.map(async (id) => {
        this.loadedQuizzes.add(id);
        try {
          const quiz = await this.quizRepo.getQuiz(id);
          this.questionTexts.update((m) => {
            const next = new Map(m);
            for (const q of quiz.questions) next.set(q.id, q.text);
            return next;
          });
        } catch {
          this.loadedQuizzes.delete(id); // повторим при следующем обновлении
        }
      }),
    ]);
  }
}
