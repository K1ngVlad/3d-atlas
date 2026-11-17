import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { QuestionType } from '../seed/seed-data';
import { CompleteResult, QuizStore, QuizSummary, SaveAnswerResult, StoredAttempt, StoredQuiz } from './quiz.store';

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

interface LockedAttempt {
  id: string;
  quiz_id: string;
  client_id: string;
  started_at: Date;
  completed_at: Date | null;
  score: number | null;
  total: number;
}

@Injectable()
export class PrismaQuizStore extends QuizStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listQuizzes(): Promise<QuizSummary[]> {
    const rows = await this.prisma.quiz.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { _count: { select: { questions: true } } },
    });
    return rows.map((q) => ({
      id: q.id,
      title: q.title,
      description: q.description,
      manifestId: q.manifestId,
      questionCount: q._count.questions,
    }));
  }

  async getQuiz(id: string): Promise<StoredQuiz | null> {
    const q = await this.prisma.quiz.findUnique({
      where: { id },
      include: { questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } } },
    });
    if (!q) return null;
    return {
      id: q.id,
      title: q.title,
      description: q.description,
      manifestId: q.manifestId,
      questions: q.questions.map((x) => ({
        id: x.id,
        quizId: x.quizId,
        position: x.position,
        type: x.type as QuestionType,
        text: x.text,
        entityId: x.entityId,
        manifestId: x.manifestId,
        partId: x.partId,
        options: x.options.map((o) => ({ id: o.id, position: o.position, text: o.text, isCorrect: o.isCorrect })),
      })),
    };
  }

  async createAttempt(a: { id: string; quizId: string; clientId: string; startedAt: Date; total: number }): Promise<void> {
    await this.prisma.attempt.create({ data: a });
  }

  async getAttempt(id: string): Promise<StoredAttempt | null> {
    const a = await this.prisma.attempt.findUnique({
      where: { id },
      include: { answers: { include: { options: { select: { optionId: true } } } } },
    });
    if (!a) return null;
    return {
      id: a.id,
      quizId: a.quizId,
      clientId: a.clientId,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
      score: a.score,
      total: a.total,
      answers: a.answers.map((x) => ({
        questionId: x.questionId,
        isCorrect: x.isCorrect,
        answeredAt: x.answeredAt,
        optionIds: x.options.map((o) => o.optionId),
      })),
    };
  }

  async saveAnswer(a: {
    id: string;
    attemptId: string;
    questionId: string;
    isCorrect: boolean;
    optionIds: string[];
    answeredAt: Date;
  }): Promise<SaveAnswerResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const attempt = await lockAttempt(tx, a.attemptId);
        if (!attempt) return { status: 'not_found' } as const;
        if (attempt.completed_at) return { status: 'completed' } as const;
        const existing = await tx.attemptAnswer.findUnique({
          where: { attemptId_questionId: { attemptId: a.attemptId, questionId: a.questionId } },
          select: { id: true },
        });
        if (existing) return { status: 'duplicate' } as const;
        await tx.attemptAnswer.create({
          data: {
            id: a.id,
            attemptId: a.attemptId,
            questionId: a.questionId,
            isCorrect: a.isCorrect,
            answeredAt: a.answeredAt,
            options: { create: a.optionIds.map((optionId) => ({ optionId })) },
          },
        });
        return { status: 'saved', answeredAt: a.answeredAt } as const;
      });
    } catch (e) {
      // UNIQUE (attempt_id, question_id) — a concurrent duplicate that slipped past the lock.
      if ((e as { code?: string }).code === 'P2002') return { status: 'duplicate' };
      throw e;
    }
  }

  async completeAttempt(attemptId: string, completedAt: Date): Promise<CompleteResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const a = await lockAttempt(tx, attemptId);
      if (!a) return null;
      const attempt = { id: a.id, quizId: a.quiz_id, clientId: a.client_id, startedAt: a.started_at, total: a.total };
      if (a.completed_at) {
        return { attempt, score: a.score ?? 0, completedAt: a.completed_at, newlyCompleted: false };
      }
      const score = await tx.attemptAnswer.count({ where: { attemptId, isCorrect: true } });
      await tx.attempt.update({ where: { id: attemptId }, data: { score, completedAt } });
      return { attempt, score, completedAt, newlyCompleted: true };
    });
  }
}

/** `SELECT … FOR UPDATE`: serialises answers and completion of one attempt across instances. */
async function lockAttempt(tx: Tx, id: string): Promise<LockedAttempt | null> {
  const rows = await tx.$queryRaw<LockedAttempt[]>`
    SELECT id::text AS id, quiz_id, client_id::text AS client_id, started_at, completed_at, score, total
    FROM attempts WHERE id = ${id}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}
