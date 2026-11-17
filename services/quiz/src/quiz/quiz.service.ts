import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CatalogClient, CatalogEntity } from '../catalog/catalog.client';
import { badRequest, conflict, notFound } from '../common/api-error';
import { QuizEventsPublisher } from '../events/quiz-events.publisher';
import type { QuestionType } from '../seed/seed-data';
import { QuizStore, QuizSummary, StoredAttempt, StoredQuestion, StoredQuiz } from './quiz.store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

// ---- Response shapes (contracts.md, "Quiz Service"). `isCorrect` never appears in QuizView. ----

export interface QuizView {
  id: string;
  title: string;
  description: string;
  manifestId: string;
  questions: {
    id: string;
    order: number;
    type: QuestionType;
    text: string;
    manifestId: string | null;
    partId: string | null;
    options: { id: string; text: string }[];
  }[];
}

export interface AnswerResult {
  correct: boolean;
  correctOptionIds: string[];
  entity: CatalogEntity | null;
}

export interface AttemptView {
  attemptId: string;
  quizId: string;
  startedAt: string;
  completedAt: string | null;
  score: number | null;
  total: number;
  answers: { questionId: string; optionIds: string[]; correct: boolean; correctOptionIds: string[] }[];
}

export interface CompleteView {
  score: number;
  total: number;
  completedAt: string;
}

/**
 * Answer check (contracts.md, quiz-ux.md T3): `single` — the single correct option chosen;
 * `multiple` — chosen set exactly equals the correct set. Empty answer («Не знаю») is wrong.
 */
export function isAnswerCorrect(question: Pick<StoredQuestion, 'options'>, optionIds: readonly string[]): boolean {
  if (optionIds.length === 0) return false;
  const correct = new Set(question.options.filter((o) => o.isCorrect).map((o) => o.id));
  const chosen = new Set(optionIds);
  return chosen.size === correct.size && [...chosen].every((id) => correct.has(id));
}

const correctIds = (q: StoredQuestion) => q.options.filter((o) => o.isCorrect).map((o) => o.id);

@Injectable()
export class QuizService {
  /** Quizzes are immutable after seeding, so their definitions are cached per instance. */
  private readonly quizzes = new Map<string, Promise<StoredQuiz | null>>();

  constructor(
    private readonly store: QuizStore,
    private readonly catalog: CatalogClient,
    private readonly events: QuizEventsPublisher,
  ) {}

  listQuizzes(): Promise<QuizSummary[]> {
    return this.store.listQuizzes();
  }

  async getQuiz(id: string): Promise<QuizView> {
    const quiz = await this.quiz(id);
    if (!quiz) throw notFound(`Quiz "${id}" not found`);
    return {
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      manifestId: quiz.manifestId,
      questions: quiz.questions.map((q) => ({
        id: q.id,
        order: q.position,
        type: q.type,
        text: q.text,
        manifestId: q.manifestId,
        partId: q.partId,
        options: q.options.map((o) => ({ id: o.id, text: o.text })),
      })),
    };
  }

  async startAttempt(body: unknown): Promise<{ attemptId: string; startedAt: string }> {
    const { quizId, clientId } = (body ?? {}) as { quizId?: unknown; clientId?: unknown };
    if (typeof quizId !== 'string' || !quizId) throw badRequest('quizId is required');
    if (!isUuid(clientId)) throw badRequest('clientId must be a UUID');
    const quiz = await this.quiz(quizId);
    if (!quiz) throw notFound(`Quiz "${quizId}" not found`);
    const attempt = { id: randomUUID(), quizId, clientId: clientId.toLowerCase(), startedAt: new Date(), total: quiz.questions.length };
    await this.store.createAttempt(attempt);
    return { attemptId: attempt.id, startedAt: attempt.startedAt.toISOString() };
  }

  async getAttempt(attemptId: string, clientId: string | undefined): Promise<AttemptView> {
    const attempt = await this.ownedAttempt(attemptId, clientId);
    const quiz = await this.requireQuiz(attempt.quizId);
    const byId = new Map(attempt.answers.map((a) => [a.questionId, a]));
    const answers = quiz.questions
      .filter((q) => byId.has(q.id))
      .map((q) => {
        const a = byId.get(q.id)!;
        const order = new Map(q.options.map((o) => [o.id, o.position]));
        return {
          questionId: q.id,
          optionIds: [...a.optionIds].sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0)),
          correct: a.isCorrect,
          correctOptionIds: correctIds(q),
        };
      });
    return {
      attemptId: attempt.id,
      quizId: attempt.quizId,
      startedAt: attempt.startedAt.toISOString(),
      completedAt: attempt.completedAt?.toISOString() ?? null,
      score: attempt.score,
      total: attempt.total,
      answers,
    };
  }

  async answer(attemptId: string, clientId: string | undefined, body: unknown): Promise<AnswerResult> {
    const attempt = await this.ownedAttempt(attemptId, clientId);
    if (attempt.completedAt) throw conflict('attempt_completed', 'Attempt is already completed');

    const { questionId, optionIds } = (body ?? {}) as { questionId?: unknown; optionIds?: unknown };
    if (typeof questionId !== 'string' || !questionId) throw badRequest('questionId is required');
    if (!Array.isArray(optionIds) || !optionIds.every((x) => typeof x === 'string')) {
      throw badRequest('optionIds must be an array of option ids (empty for «Не знаю»)');
    }
    const quiz = await this.requireQuiz(attempt.quizId);
    const question = quiz.questions.find((q) => q.id === questionId.toLowerCase());
    if (!question) throw badRequest(`Question ${questionId} does not belong to quiz "${quiz.id}"`, 'invalid_question');
    const chosen = (optionIds as string[]).map((x) => x.toLowerCase());
    if (new Set(chosen).size !== chosen.length) throw badRequest('optionIds contain duplicates', 'invalid_option');
    const own = new Set(question.options.map((o) => o.id));
    const foreign = chosen.find((id) => !own.has(id));
    if (foreign) throw badRequest(`Option ${foreign} does not belong to question ${question.id}`, 'invalid_option');
    if (question.type === 'single' && chosen.length > 1) {
      throw badRequest('A "single" question accepts at most one option', 'invalid_option');
    }
    if (attempt.answers.some((a) => a.questionId === question.id)) {
      throw conflict('already_answered', 'This question is already answered');
    }

    const correct = isAnswerCorrect(question, chosen);
    const saved = await this.store.saveAnswer({
      id: randomUUID(),
      attemptId: attempt.id,
      questionId: question.id,
      isCorrect: correct,
      optionIds: chosen,
      answeredAt: new Date(),
    });
    if (saved.status === 'duplicate') throw conflict('already_answered', 'This question is already answered');
    if (saved.status === 'completed') throw conflict('attempt_completed', 'Attempt is already completed');
    if (saved.status === 'not_found') throw notFound('Attempt not found');

    // After commit (decision 43): fire-and-forget, never fails the response.
    this.events.answerSubmitted({
      attemptId: attempt.id,
      quizId: attempt.quizId,
      questionId: question.id,
      questionType: question.type,
      entityId: question.entityId,
      optionIds: chosen,
      correct,
      clientId: attempt.clientId,
      answeredAt: saved.answeredAt.toISOString(),
    });

    return { correct, correctOptionIds: correctIds(question), entity: await this.catalog.getEntity(question.entityId) };
  }

  async complete(attemptId: string, clientId: string | undefined): Promise<CompleteView> {
    await this.ownedAttempt(attemptId, clientId);
    const res = await this.store.completeAttempt(attemptId.toLowerCase(), new Date());
    if (!res) throw notFound('Attempt not found');
    if (res.newlyCompleted) {
      this.events.testCompleted({
        attemptId: res.attempt.id,
        quizId: res.attempt.quizId,
        clientId: res.attempt.clientId,
        score: res.score,
        total: res.attempt.total,
        startedAt: res.attempt.startedAt.toISOString(),
        completedAt: res.completedAt.toISOString(),
        durationMs: res.completedAt.getTime() - res.attempt.startedAt.getTime(),
      });
    }
    return { score: res.score, total: res.attempt.total, completedAt: res.completedAt.toISOString() };
  }

  /** `X-Client-Id` missing or not the attempt owner → 404, as if the attempt did not exist (quiz-ux.md). */
  private async ownedAttempt(attemptId: string, clientId: string | undefined): Promise<StoredAttempt> {
    const attempt = isUuid(attemptId) && isUuid(clientId) ? await this.store.getAttempt(attemptId.toLowerCase()) : null;
    if (!attempt || attempt.clientId.toLowerCase() !== clientId!.toLowerCase()) throw notFound('Attempt not found');
    return attempt;
  }

  private quiz(id: string): Promise<StoredQuiz | null> {
    let p = this.quizzes.get(id);
    if (!p) {
      p = this.store.getQuiz(id).then((q) => {
        if (!q) this.quizzes.delete(id); // do not cache misses
        return q;
      });
      p.catch(() => this.quizzes.delete(id));
      this.quizzes.set(id, p);
    }
    return p;
  }

  private async requireQuiz(id: string): Promise<StoredQuiz> {
    const quiz = await this.quiz(id);
    if (!quiz) throw notFound(`Quiz "${id}" not found`);
    return quiz;
  }
}
