import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { APP_ENV } from '../../core/config/app-config';
import { ClientIdService } from '../client-id';
import { HttpAnalyticsRepository } from './analytics-repository';
import { HttpQuizRepository } from './quiz-repository';

const CLIENT = '11111111-2222-4333-8444-555555555555';

describe('HttpQuizRepository / HttpAnalyticsRepository', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_ENV, useValue: { dataSource: 'api', apiBase: '' } },
        { provide: ClientIdService, useValue: { id: CLIENT } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('POST /attempts несёт clientId; запросы к попытке — X-Client-Id', async () => {
    const repo = TestBed.inject(HttpQuizRepository);

    const started = repo.startAttempt('cell');
    const req = http.expectOne('/api/quiz/attempts');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ quizId: 'cell', clientId: CLIENT });
    req.flush({ attemptId: 'a1', startedAt: 'T' });
    await started;

    const got = repo.getAttempt('a1');
    const r2 = http.expectOne('/api/quiz/attempts/a1');
    expect(r2.request.headers.get('X-Client-Id')).toBe(CLIENT);
    r2.flush({ attemptId: 'a1', quizId: 'cell', startedAt: 'T', completedAt: null, score: null, total: 2, answers: [] });
    await got;

    const done = repo.completeAttempt('a1');
    const r3 = http.expectOne('/api/quiz/attempts/a1/complete');
    expect(r3.request.headers.get('X-Client-Id')).toBe(CLIENT);
    r3.flush({ score: 1, total: 2, completedAt: 'T' });
    expect(await done).toEqual({ score: 1, total: 2, completedAt: 'T' });
  });

  it('ответ: пустой optionIds уходит как есть; entity нормализуется (строка или { ru })', async () => {
    const repo = TestBed.inject(HttpQuizRepository);

    const a = repo.submitAnswer('a1', 'q1', []);
    const req = http.expectOne('/api/quiz/attempts/a1/answers');
    expect(req.request.body).toEqual({ questionId: 'q1', optionIds: [] });
    expect(req.request.headers.get('X-Client-Id')).toBe(CLIENT);
    req.flush({ correct: false, correctOptionIds: ['o1'], entity: { id: 'golgi', title: { ru: 'Гольджи' }, summary: { ru: 'Сортировка' } } });
    expect(await a).toEqual({
      correct: false, correctOptionIds: ['o1'], entity: { id: 'golgi', title: 'Гольджи', summary: 'Сортировка' },
    });

    const b = repo.submitAnswer('a1', 'q2', ['o2']);
    http.expectOne('/api/quiz/attempts/a1/answers').flush({ correct: true, correctOptionIds: ['o2'], entity: null });
    expect((await b).entity).toBeNull();
  });

  it('409 пробрасывается со статусом', async () => {
    const repo = TestBed.inject(HttpQuizRepository);
    const a = repo.submitAnswer('a1', 'q1', ['o1']);
    http.expectOne('/api/quiz/attempts/a1/answers').flush({ error: 'conflict', message: '' }, { status: 409, statusText: 'Conflict' });
    await expect(a).rejects.toMatchObject({ status: 409 });
  });

  it('аналитика: questions с quizId и без', async () => {
    const repo = TestBed.inject(HttpAnalyticsRepository);
    const all = repo.getQuestions();
    http.expectOne('/api/analytics/questions').flush([]);
    await all;
    const one = repo.getQuestions('cell');
    http.expectOne('/api/analytics/questions?quizId=cell').flush([]);
    await one;
  });
});
