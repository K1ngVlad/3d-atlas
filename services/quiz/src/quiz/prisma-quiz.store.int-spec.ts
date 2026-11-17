/**
 * Integration test against a real PostgreSQL (migrated with `prisma migrate deploy`).
 * Skipped unless TEST_DATABASE_URL is set; the database is wiped before the run.
 *   TEST_DATABASE_URL=postgresql://… npm run test:int
 */
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SeedService } from '../seed/seed.service';
import { PrismaQuizStore } from './prisma-quiz.store';

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('PrismaQuizStore (PostgreSQL)', () => {
  let prisma: PrismaService;
  let store: PrismaQuizStore;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$executeRawUnsafe(
      'TRUNCATE attempt_answer_options, attempt_answers, attempts, answer_options, questions, quizzes',
    );
    store = new PrismaQuizStore(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('seeds once even when two instances start concurrently', async () => {
    const other = new PrismaService();
    await Promise.all([new SeedService(prisma).onModuleInit(), new SeedService(other).onModuleInit()]);
    await other.$disconnect();
    expect(await prisma.quiz.count()).toBe(2);
    expect(await prisma.question.count()).toBe(20);
    await new SeedService(prisma).onModuleInit();
    expect(await prisma.question.count()).toBe(20);
  });

  it('reads quizzes in seed order with ordered questions and options', async () => {
    const list = await store.listQuizzes();
    expect(list.map((q) => [q.id, q.questionCount])).toEqual([
      ['animal-cell-organelles', 10],
      ['organelle-structure', 10],
    ]);
    const quiz = (await store.getQuiz('organelle-structure'))!;
    expect(quiz.questions.map((q) => q.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(quiz.questions[0]).toMatchObject({ manifestId: 'mitochondrion', partId: 'cristae', type: 'single' });
  });

  it('saves answers atomically: concurrent duplicates → one saved, completed attempt → rejected', async () => {
    const quiz = (await store.getQuiz('animal-cell-organelles'))!;
    const attemptId = randomUUID();
    await store.createAttempt({ id: attemptId, quizId: quiz.id, clientId: randomUUID(), startedAt: new Date(), total: 10 });
    const [q1, q2, q3] = quiz.questions;
    const right = q1.options.find((o) => o.isCorrect)!.id;
    const save = (questionId: string, isCorrect: boolean, optionIds: string[]) =>
      store.saveAnswer({ id: randomUUID(), attemptId, questionId, isCorrect, optionIds, answeredAt: new Date() });

    const results = await Promise.all([save(q1.id, true, [right]), save(q1.id, false, []), save(q1.id, false, [])]);
    expect(results.map((r) => r.status).sort()).toEqual(['duplicate', 'duplicate', 'saved']);
    expect((await save(q2.id, true, q2.options.filter((o) => o.isCorrect).map((o) => o.id))).status).toBe('saved');

    const attempt = (await store.getAttempt(attemptId))!;
    expect(attempt.answers).toHaveLength(2);

    const completions = await Promise.all([store.completeAttempt(attemptId, new Date()), store.completeAttempt(attemptId, new Date())]);
    expect(completions.filter((c) => c!.newlyCompleted)).toHaveLength(1);
    expect(completions[0]!.completedAt.getTime()).toBe(completions[1]!.completedAt.getTime());
    const expectedScore = attempt.answers.filter((a) => a.isCorrect).length;
    expect(completions.map((c) => c!.score)).toEqual([expectedScore, expectedScore]);

    expect((await save(q3.id, false, [])).status).toBe('completed');
    expect(await store.completeAttempt(randomUUID(), new Date())).toBeNull();
    expect((await store.saveAnswer({ id: randomUUID(), attemptId: randomUUID(), questionId: q3.id, isCorrect: false, optionIds: [], answeredAt: new Date() })).status).toBe('not_found');
  });
});
