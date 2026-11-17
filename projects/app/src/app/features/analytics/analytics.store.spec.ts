import { TestBed } from '@angular/core/testing';
import { ANALYTICS_REPO } from '../../data-access/repositories/analytics-repository';
import { QUIZ_REPO } from '../../data-access/repositories/quiz-repository';
import { STRUCTURE_REPO } from '../../data-access/repositories/structure-repository';
import { AnalyticsStore } from './analytics.store';

const SUMMARY = {
  attemptsCompleted: 3, avgScorePct: 66.7, answersTotal: 20, correctRatePct: 55, lastEventAt: '2026-11-23T10:00:00Z',
};

describe('AnalyticsStore', () => {
  let analytics: { getSummary: ReturnType<typeof vi.fn>; getEntities: ReturnType<typeof vi.fn>; getQuestions: ReturnType<typeof vi.fn> };
  let store: AnalyticsStore;

  beforeEach(() => {
    analytics = {
      getSummary: vi.fn(() => Promise.resolve(SUMMARY)),
      getEntities: vi.fn(() => Promise.resolve([{ entityId: 'golgi', answersTotal: 4, correctRatePct: 25 }])),
      getQuestions: vi.fn(() =>
        Promise.resolve([
          { questionId: 'q2', quizId: 'cell', entityId: 'golgi', answersTotal: 4, correctRatePct: 75 },
          { questionId: 'q1', quizId: 'cell', entityId: 'golgi', answersTotal: 4, correctRatePct: 25 },
        ]),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        AnalyticsStore,
        { provide: ANALYTICS_REPO, useValue: analytics },
        {
          provide: QUIZ_REPO,
          useValue: {
            listQuizzes: () => Promise.resolve([{ id: 'cell', title: 'Органоиды', description: '', manifestId: 'animal-cell', questionCount: 2 }]),
            getQuiz: () =>
              Promise.resolve({
                id: 'cell', title: 'Органоиды', description: '', manifestId: 'animal-cell',
                questions: [
                  { id: 'q1', order: 1, type: 'single', text: 'Что выделено?', manifestId: null, partId: null, options: [] },
                  { id: 'q2', order: 2, type: 'single', text: 'Где синтез АТФ?', manifestId: null, partId: null, options: [] },
                ],
              }),
          },
        },
        {
          provide: STRUCTURE_REPO,
          useValue: {
            getEntity: (id: string) => Promise.resolve({ id, kind: 'organelle', title: { ru: 'Аппарат Гольджи' }, summary: { ru: '' } }),
          },
        },
      ],
    });
    store = TestBed.inject(AnalyticsStore);
  });

  it('загружает сводку и таблицы, названия — из Catalog и Quiz', async () => {
    await store.loadQuizzes();
    await store.refresh();
    await vi.waitFor(() => expect(store.questionRows()[0].label).toBe('Что выделено?'));
    expect(store.status()).toBe('ready');
    expect(store.summary()).toEqual(SUMMARY);
    expect(store.entityRows()).toEqual([
      { key: 'golgi', label: 'Аппарат Гольджи', answersTotal: 4, correctRatePct: 25 },
    ]);
    // самые трудные сверху; при «Все тесты» в подсказке — тест и органоид
    expect(store.questionRows().map((r) => r.key)).toEqual(['q1', 'q2']);
    expect(store.questionRows()[0].hint).toBe('Органоиды · Аппарат Гольджи');
  });

  it('пустая аналитика → empty', async () => {
    analytics.getSummary.mockResolvedValue({ ...SUMMARY, attemptsCompleted: 0, answersTotal: 0, lastEventAt: null });
    await store.refresh();
    expect(store.empty()).toBe(true);
  });

  it('ошибка первой загрузки → error; ошибка обновления — данные остаются', async () => {
    analytics.getSummary.mockRejectedValueOnce(new Error('503'));
    await store.refresh();
    expect(store.status()).toBe('error');

    await store.refresh();
    expect(store.status()).toBe('ready');
    analytics.getSummary.mockRejectedValueOnce(new Error('503'));
    await store.refresh();
    expect(store.status()).toBe('ready');
    expect(store.refreshFailed()).toBe(true);
    expect(store.summary()).toEqual(SUMMARY);
  });

  it('параллельные обновления (кнопка + таймер) склеиваются в один запрос', async () => {
    await Promise.all([store.refresh(), store.refresh()]);
    expect(analytics.getSummary).toHaveBeenCalledTimes(1);
  });

  it('фильтр по тесту запрашивает вопросы с quizId', async () => {
    await store.refresh();
    store.setQuizFilter('cell');
    await vi.waitFor(() => expect(analytics.getQuestions).toHaveBeenLastCalledWith('cell'));
  });
});
