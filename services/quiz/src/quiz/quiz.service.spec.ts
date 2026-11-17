import { jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import type { CatalogClient } from '../catalog/catalog.client';
import type { QuizEventsPublisher } from '../events/quiz-events.publisher';
import { QuizService } from './quiz.service';
import { InMemoryQuizStore } from './testing/in-memory-quiz.store';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ENTITY = { id: 'mitochondrion', title: 'Митохондрия', summary: '…' };

async function status(p: Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() };
    throw e;
  }
  throw new Error('expected an HTTP error');
}

describe('QuizService', () => {
  let store: InMemoryQuizStore;
  let catalog: { getEntity: jest.Mock<CatalogClient['getEntity']> };
  let events: { answerSubmitted: jest.Mock; testCompleted: jest.Mock; isReady: jest.Mock };
  let service: QuizService;

  const quiz = () => store.quizzes[0];
  const question = (type: 'single' | 'multiple') => quiz().questions.find((q) => q.type === type)!;
  const start = async () => (await service.startAttempt({ quizId: quiz().id, clientId: CLIENT })).attemptId;

  beforeEach(() => {
    store = new InMemoryQuizStore();
    catalog = { getEntity: jest.fn<CatalogClient['getEntity']>().mockResolvedValue(ENTITY) };
    events = { answerSubmitted: jest.fn(), testCompleted: jest.fn(), isReady: jest.fn().mockReturnValue(true) };
    service = new QuizService(store, catalog as unknown as CatalogClient, events as unknown as QuizEventsPublisher);
  });

  it('lists quizzes with question counts', async () => {
    const list = await service.listQuizzes();
    expect(list).toEqual([
      expect.objectContaining({ id: 'animal-cell-organelles', manifestId: 'animal-cell', questionCount: 10 }),
      expect.objectContaining({ id: 'organelle-structure', manifestId: 'animal-cell', questionCount: 10 }),
    ]);
  });

  it('never exposes isCorrect in the quiz body', async () => {
    const view = await service.getQuiz(quiz().id);
    expect(JSON.stringify(view)).not.toMatch(/isCorrect|is_correct|correct/i);
    expect(view.questions[0]).toEqual({
      id: expect.any(String),
      order: 1,
      type: 'single',
      text: expect.any(String),
      manifestId: 'animal-cell',
      partId: 'mitochondria',
      options: expect.arrayContaining([{ id: expect.any(String), text: expect.any(String) }]),
    });
    expect((await status(service.getQuiz('nope'))).status).toBe(404);
  });

  it('validates attempt creation', async () => {
    expect((await status(service.startAttempt({ quizId: quiz().id, clientId: 'not-a-uuid' }))).status).toBe(400);
    expect((await status(service.startAttempt({ quizId: 'missing', clientId: CLIENT }))).status).toBe(404);
    const res = await service.startAttempt({ quizId: quiz().id, clientId: CLIENT });
    expect(res.attemptId).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.attempts.get(res.attemptId)?.total).toBe(10);
  });

  it('single: correct only for the correct option', async () => {
    const id = await start();
    const q = question('single');
    const right = q.options.find((o) => o.isCorrect)!.id;
    const res = await service.answer(id, CLIENT, { questionId: q.id, optionIds: [right] });
    expect(res).toEqual({ correct: true, correctOptionIds: [right], entity: ENTITY });
    const q2 = quiz().questions.filter((x) => x.type === 'single')[1];
    const wrong = q2.options.find((o) => !o.isCorrect)!.id;
    expect((await service.answer(id, CLIENT, { questionId: q2.id, optionIds: [wrong] })).correct).toBe(false);
  });

  it('multiple: correct only when the chosen set equals the correct set exactly', async () => {
    const qs = quiz().questions.filter((q) => q.type === 'multiple');
    expect(qs.length).toBeGreaterThanOrEqual(2);
    const [qa, qb] = qs;
    const correctA = qa.options.filter((o) => o.isCorrect).map((o) => o.id);
    const correctB = qb.options.filter((o) => o.isCorrect).map((o) => o.id);
    const wrongB = qb.options.find((o) => !o.isCorrect)!.id;

    const a1 = await start();
    const partial = await service.answer(a1, CLIENT, { questionId: qa.id, optionIds: correctA.slice(1) });
    expect(partial).toMatchObject({ correct: false, correctOptionIds: correctA });
    const extra = await service.answer(a1, CLIENT, { questionId: qb.id, optionIds: [...correctB, wrongB] });
    expect(extra.correct).toBe(false);

    const a2 = await start();
    const exact = await service.answer(a2, CLIENT, { questionId: qa.id, optionIds: [...correctA].reverse() });
    expect(exact.correct).toBe(true);
  });

  it('empty answer («Не знаю») is wrong and still returns the correct options', async () => {
    const id = await start();
    const q = question('multiple');
    const res = await service.answer(id, CLIENT, { questionId: q.id, optionIds: [] });
    expect(res.correct).toBe(false);
    expect(res.correctOptionIds).toEqual(q.options.filter((o) => o.isCorrect).map((o) => o.id));
  });

  it('rejects foreign options, >1 option for single and unknown questions with 400', async () => {
    const id = await start();
    const single = question('single');
    const other = quiz().questions[1].options[0].id;
    expect((await status(service.answer(id, CLIENT, { questionId: single.id, optionIds: [other] }))).status).toBe(400);
    const two = single.options.slice(0, 2).map((o) => o.id);
    expect((await status(service.answer(id, CLIENT, { questionId: single.id, optionIds: two }))).status).toBe(400);
    const foreignQuestion = store.quizzes[1].questions[0].id;
    expect((await status(service.answer(id, CLIENT, { questionId: foreignQuestion, optionIds: [] }))).status).toBe(400);
    expect((await status(service.answer(id, CLIENT, { questionId: single.id }))).status).toBe(400);
    expect(store.attempts.get(id)!.answers).toHaveLength(0);
  });

  it('409 on a repeated answer and on answering a completed attempt', async () => {
    const id = await start();
    const [q1, q2] = quiz().questions;
    await service.answer(id, CLIENT, { questionId: q1.id, optionIds: [] });
    const again = await status(service.answer(id, CLIENT, { questionId: q1.id, optionIds: [q1.options[0].id] }));
    expect(again).toEqual({ status: 409, body: { error: 'already_answered', message: expect.any(String) } });
    expect(events.answerSubmitted).toHaveBeenCalledTimes(1);

    await service.complete(id, CLIENT);
    const late = await status(service.answer(id, CLIENT, { questionId: q2.id, optionIds: [] }));
    expect(late).toEqual({ status: 409, body: { error: 'attempt_completed', message: expect.any(String) } });
  });

  it('404 for a missing or foreign X-Client-Id on every attempt request', async () => {
    const id = await start();
    const q = quiz().questions[0];
    for (const client of [undefined, '', OTHER, 'garbage']) {
      expect((await status(service.getAttempt(id, client))).status).toBe(404);
      expect((await status(service.answer(id, client, { questionId: q.id, optionIds: [] }))).status).toBe(404);
      expect((await status(service.complete(id, client))).status).toBe(404);
    }
    expect((await status(service.getAttempt('not-a-uuid', CLIENT))).status).toBe(404);
    expect(store.attempts.get(id)!.answers).toHaveLength(0);
    expect(await service.getAttempt(id, CLIENT.toUpperCase())).toMatchObject({ attemptId: id });
  });

  it('returns entity: null when Catalog is unavailable, the answer is still checked and saved', async () => {
    catalog.getEntity.mockResolvedValue(null);
    const id = await start();
    const q = question('single');
    const right = q.options.find((o) => o.isCorrect)!.id;
    const res = await service.answer(id, CLIENT, { questionId: q.id, optionIds: [right] });
    expect(res).toEqual({ correct: true, correctOptionIds: [right], entity: null });
    expect(catalog.getEntity).toHaveBeenCalledWith(q.entityId);
    expect(store.attempts.get(id)!.answers).toHaveLength(1);
  });

  it('publishes AnswerSubmitted after saving', async () => {
    const id = await start();
    const q = question('single');
    const right = q.options.find((o) => o.isCorrect)!.id;
    events.answerSubmitted.mockImplementation(() => {
      expect(store.attempts.get(id)!.answers).toHaveLength(1); // already committed
    });
    await service.answer(id, CLIENT, { questionId: q.id, optionIds: [right] });
    expect(events.answerSubmitted).toHaveBeenCalledWith({
      attemptId: id,
      quizId: quiz().id,
      questionId: q.id,
      questionType: 'single',
      entityId: q.entityId,
      optionIds: [right],
      correct: true,
      clientId: CLIENT,
      answeredAt: expect.any(String),
    });
  });

  it('complete: score counts correct answers, unanswered are wrong; idempotent without a second event', async () => {
    const id = await start();
    const [q1, q2, q3] = quiz().questions;
    const right = (q: typeof q1) => q.options.filter((o) => o.isCorrect).map((o) => o.id);
    await service.answer(id, CLIENT, { questionId: q1.id, optionIds: right(q1) });
    await service.answer(id, CLIENT, { questionId: q2.id, optionIds: right(q2) });
    await service.answer(id, CLIENT, { questionId: q3.id, optionIds: [] });

    const first = await service.complete(id, CLIENT);
    expect(first).toEqual({ score: 2, total: 10, completedAt: expect.any(String) });
    const second = await service.complete(id, CLIENT);
    expect(second).toEqual(first);
    expect(events.testCompleted).toHaveBeenCalledTimes(1);
    expect(events.testCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: id, quizId: quiz().id, clientId: CLIENT, score: 2, total: 10, durationMs: expect.any(Number) }),
    );

    const view = await service.getAttempt(id, CLIENT);
    expect(view).toMatchObject({ attemptId: id, score: 2, total: 10, completedAt: first.completedAt });
    expect(view.answers.map((a) => [a.questionId, a.correct])).toEqual([
      [q1.id, true],
      [q2.id, true],
      [q3.id, false],
    ]);
    expect(view.answers[2]).toEqual({ questionId: q3.id, optionIds: [], correct: false, correctOptionIds: right(q3) });
  });
});
