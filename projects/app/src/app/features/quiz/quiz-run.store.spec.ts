import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { SceneManifest, Selection } from '@atlas/viewer-core';
import {
  QUIZ_REPO,
  type AttemptDetail,
  type QuizDetail,
  type QuizRepository,
} from '../../data-access/repositories/quiz-repository';
import { STRUCTURE_REPO, type StructureRepository } from '../../data-access/repositories/structure-repository';
import { QuizProgressStorage } from '../../data-access/quiz-progress.storage';
import { ViewerService } from '../../viewer/viewer.service';
import { QuizCanvas } from './quiz-canvas.service';
import { QuizRunStore } from './quiz-run.store';

const QUIZ: QuizDetail = {
  id: 'cell-organelles',
  title: 'Органоиды животной клетки',
  description: '',
  manifestId: 'animal-cell',
  questions: [
    {
      id: 'q1', order: 1, type: 'single', text: 'Что выделено на модели?',
      manifestId: 'animal-cell', partId: 'nucleus',
      options: [{ id: 'o11', text: 'Ядро' }, { id: 'o12', text: 'Митохондрия' }],
    },
    {
      id: 'q2', order: 2, type: 'multiple', text: 'Какие органоиды мембранные?',
      manifestId: null, partId: null,
      options: [{ id: 'o21', text: 'ЭПР' }, { id: 'o22', text: 'Гольджи' }, { id: 'o23', text: 'Рибосома' }],
    },
    {
      id: 'q3', order: 3, type: 'single', text: 'Что выделено?',
      manifestId: 'mitochondrion', partId: 'granules',
      options: [{ id: 'o31', text: 'Гранулы' }, { id: 'o32', text: 'Кристы' }],
    },
  ],
};

const MANIFESTS: Record<string, SceneManifest> = {
  'animal-cell': {
    schemaVersion: 1, id: 'animal-cell', model: { url: 'models/cell.glb' },
    parts: [{ id: 'nucleus', entity: 'nucleus', nodes: ['Nucleus'] }],
  } as unknown as SceneManifest,
  mitochondrion: {
    schemaVersion: 1, id: 'mitochondrion', model: { url: 'models/mito.glb' },
    parts: [{ id: 'granules', entity: 'granules', nodes: ['G'], select: 'each' }],
  } as unknown as SceneManifest,
};

function attempt(partial: Partial<AttemptDetail> = {}): AttemptDetail {
  return {
    attemptId: 'a1', quizId: QUIZ.id, startedAt: '2026-11-20T10:00:00Z',
    completedAt: null, score: null, total: 3, answers: [], ...partial,
  };
}

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

class FakeViewer {
  readonly owner = signal<'atlas' | 'quiz' | null>('quiz');
  readonly selection = signal<Selection | null>(null);
  readonly hover = signal<Selection | null>(null);
  readonly loading = signal(null);
  readonly error = signal(null);
  readonly labels = signal([]);
  readonly options = signal({ labels: false, hover: false, exploded: false, isolate: false });
  readonly isAttached = true;
  load = vi.fn(() => Promise.resolve());
  select = vi.fn((sel: Selection | null) => this.selection.set(sel));
  setOptions = vi.fn();
  resetCamera = vi.fn();
  listInstances = vi.fn(() => ['g-1', 'g-2']);
}

/** Промисы репозиториев и эффекты сигналов. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    TestBed.tick();
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe('QuizRunStore', () => {
  let repo: { [K in keyof QuizRepository]: ReturnType<typeof vi.fn> };
  let viewer: FakeViewer;
  let store: QuizRunStore;
  let progress: QuizProgressStorage;

  beforeEach(() => {
    localStorage.clear();
    repo = {
      listQuizzes: vi.fn(),
      getQuiz: vi.fn(() => Promise.resolve(QUIZ)),
      startAttempt: vi.fn(() => Promise.resolve({ attemptId: 'new-1', startedAt: '' })),
      submitAnswer: vi.fn(),
      completeAttempt: vi.fn(),
      getAttempt: vi.fn(),
    };
    viewer = new FakeViewer();
    const structure: StructureRepository = {
      getManifest: (id) => Promise.resolve(MANIFESTS[id]),
      getEntity: () => Promise.resolve(null),
      manifestExists: () => Promise.resolve(true),
    };
    TestBed.configureTestingModule({
      providers: [
        QuizRunStore,
        QuizCanvas,
        { provide: QUIZ_REPO, useValue: repo },
        { provide: STRUCTURE_REPO, useValue: structure },
        { provide: ViewerService, useValue: viewer },
      ],
    });
    store = TestBed.inject(QuizRunStore);
    progress = TestBed.inject(QuizProgressStorage);
  });

  it('без сохранённой попытки создаёт новую и запоминает attemptId', async () => {
    await store.start(QUIZ.id);
    expect(repo.startAttempt).toHaveBeenCalledWith(QUIZ.id);
    expect(progress.getAttemptId(QUIZ.id)).toBe('new-1');
    expect(store.phase()).toBe('question');
    expect(store.current()?.id).toBe('q1');
  });

  it('продолжает незавершённую попытку с первого неотвеченного вопроса', async () => {
    progress.saveAttemptId(QUIZ.id, 'a1');
    repo.getAttempt.mockResolvedValue(
      attempt({
        answers: [{ questionId: 'q1', optionIds: ['o11'], correct: true, correctOptionIds: ['o11'] }],
      }),
    );
    await store.start(QUIZ.id);
    expect(repo.getAttempt).toHaveBeenCalledWith('a1');
    expect(repo.startAttempt).not.toHaveBeenCalled();
    expect(store.attemptId()).toBe('a1');
    expect(store.current()?.id).toBe('q2');
    expect(store.segments().map((s) => s.state)).toEqual(['correct', 'pending', 'pending']);
  });

  it('завершённую или ненайденную сохранённую попытку забывает и начинает новую', async () => {
    progress.saveAttemptId(QUIZ.id, 'old');
    repo.getAttempt.mockRejectedValue(httpError(404));
    await store.start(QUIZ.id);
    expect(repo.startAttempt).toHaveBeenCalled();
    expect(store.attemptId()).toBe('new-1');

    progress.saveAttemptId(QUIZ.id, 'done');
    repo.getAttempt.mockResolvedValue(attempt({ attemptId: 'done', completedAt: '2026-11-20T11:00:00Z' }));
    await store.start(QUIZ.id);
    expect(store.attemptId()).toBe('new-1');
    expect(store.current()?.id).toBe('q1');
  });

  it('тест не найден → not-found; сеть → ошибка с «Повторить»', async () => {
    repo.getQuiz.mockRejectedValueOnce(httpError(404));
    await store.start('nope');
    expect(store.phase()).toBe('not-found');

    repo.getQuiz.mockRejectedValueOnce(httpError(0));
    await store.start(QUIZ.id);
    expect(store.phase()).toBe('error');

    store.retry();
    await settle();
    expect(store.phase()).toBe('question');
  });

  it('«Не знаю» отправляет пустой optionIds и показывает правильный ответ', async () => {
    await store.start(QUIZ.id);
    store.toggle('o12');
    repo.submitAnswer.mockResolvedValue({ correct: false, correctOptionIds: ['o11'], entity: null });
    await store.dontKnow();
    expect(repo.submitAnswer).toHaveBeenCalledWith('new-1', 'q1', []);
    expect(store.currentAnswer()).toEqual({
      optionIds: [], correct: false, correctOptionIds: ['o11'], entity: null,
    });
    expect(store.selected().size).toBe(0);
  });

  it('409 на ответ → перечитывает попытку и показывает сохранённый результат вопроса', async () => {
    await store.start(QUIZ.id);
    store.toggle('o12');
    repo.submitAnswer.mockRejectedValue(httpError(409));
    repo.getAttempt.mockResolvedValue(
      attempt({
        attemptId: 'new-1',
        answers: [{ questionId: 'q1', optionIds: ['o11'], correct: true, correctOptionIds: ['o11'] }],
      }),
    );
    await store.submit();
    expect(repo.getAttempt).toHaveBeenCalledWith('new-1');
    expect(store.currentAnswer()).toMatchObject({ optionIds: ['o11'], correct: true });
    expect(store.currentAnswer()?.entity).toBeUndefined();
    expect(store.actionError()).toBeNull();
    expect(store.busy()).toBe(false);
  });

  it('409 «попытка завершена» → итог', async () => {
    await store.start(QUIZ.id);
    store.toggle('o11');
    repo.submitAnswer.mockRejectedValue(httpError(409));
    repo.getAttempt.mockResolvedValue(
      attempt({ attemptId: 'new-1', completedAt: '2026-11-20T11:00:00Z', score: 1, total: 3 }),
    );
    await store.submit();
    expect(store.phase()).toBe('result');
    expect(store.result()).toEqual({ score: 1, total: 3, completedAt: '2026-11-20T11:00:00Z' });
  });

  it('сеть при ответе → сообщение, выбор сохраняется, «Ответить» снова доступна', async () => {
    await store.start(QUIZ.id);
    store.toggle('o11');
    repo.submitAnswer.mockRejectedValue(httpError(503));
    await store.submit();
    expect(store.actionError()).toContain('Не удалось отправить ответ');
    expect([...store.selected()]).toEqual(['o11']);
    expect(store.canSubmit()).toBe(true);
  });

  it('multiple: флажки переключаются; single: один вариант', async () => {
    await store.start(QUIZ.id);
    store.toggle('o11');
    store.toggle('o12');
    expect([...store.selected()]).toEqual(['o12']);
    repo.submitAnswer.mockResolvedValue({ correct: false, correctOptionIds: ['o11'], entity: null });
    await store.submit();
    await store.next();
    expect(store.current()?.type).toBe('multiple');
    store.pressDigit(1);
    store.pressDigit(2);
    store.pressDigit(1);
    expect([...store.selected()]).toEqual(['o22']);
  });

  it('завершение: сохраняет результат для списка, забывает попытку', async () => {
    progress.saveAttemptId(QUIZ.id, 'a1');
    repo.getAttempt.mockResolvedValue(
      attempt({
        answers: [
          { questionId: 'q1', optionIds: ['o11'], correct: true, correctOptionIds: ['o11'] },
          { questionId: 'q2', optionIds: ['o21'], correct: false, correctOptionIds: ['o21', 'o22'] },
          { questionId: 'q3', optionIds: ['o31'], correct: true, correctOptionIds: ['o31'] },
        ],
      }),
    );
    await store.start(QUIZ.id);
    expect(store.current()?.id).toBe('q3');
    expect(store.isLast()).toBe(true);
    repo.completeAttempt.mockResolvedValue({ score: 2, total: 3, completedAt: 'T' });
    await store.next();
    expect(repo.completeAttempt).toHaveBeenCalledWith('a1');
    expect(store.phase()).toBe('result');
    expect(progress.getAttemptId(QUIZ.id)).toBeNull();
    expect(progress.getLastResult(QUIZ.id)).toEqual({ score: 2, total: 3, completedAt: 'T' });
    expect(store.resultItems()[1]).toMatchObject({ correct: false, correctTexts: ['ЭПР', 'Гольджи'] });
  });

  describe('холст', () => {
    it('«Что выделено?» — выбор части с подлётом и изоляцией, наведение/сноски/расслоение выкл.', async () => {
      await store.start(QUIZ.id);
      await settle();
      expect(viewer.load).toHaveBeenCalledWith(MANIFESTS['animal-cell']);
      expect(viewer.select).toHaveBeenLastCalledWith({ partId: 'nucleus' }, { fly: true });
      expect(viewer.setOptions).toHaveBeenLastCalledWith({
        labels: false, hover: false, exploded: false, isolate: true,
      });
    });

    it('клик по модели во время вопроса возвращает выбор вопроса без подлёта', async () => {
      await store.start(QUIZ.id);
      await settle();
      viewer.selection.set({ partId: 'membrane' });
      await settle();
      expect(viewer.select).toHaveBeenLastCalledWith({ partId: 'nucleus' }, { fly: false });
    });

    it('после ответа на вопрос с частью включается сноска; обычный вопрос — без выбора, исходный вид', async () => {
      await store.start(QUIZ.id);
      store.toggle('o11');
      repo.submitAnswer.mockResolvedValue({ correct: true, correctOptionIds: ['o11'], entity: null });
      await store.submit();
      await settle();
      expect(viewer.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ labels: true }));
      expect(TestBed.inject(QuizCanvas).labelsOnly()).toEqual({ partId: 'nucleus' });

      await store.next();
      await settle();
      expect(viewer.select).toHaveBeenLastCalledWith(null, { fly: false });
      expect(viewer.resetCamera).toHaveBeenCalled();
      expect(viewer.setOptions).toHaveBeenLastCalledWith(
        expect.objectContaining({ labels: false, isolate: false }),
      );
    });

    it('часть с select: "each" — первый экземпляр из listInstances; другая модель загружается', async () => {
      progress.saveAttemptId(QUIZ.id, 'a1');
      repo.getAttempt.mockResolvedValue(
        attempt({
          answers: [
            { questionId: 'q1', optionIds: [], correct: false, correctOptionIds: ['o11'] },
            { questionId: 'q2', optionIds: [], correct: false, correctOptionIds: ['o21'] },
          ],
        }),
      );
      await store.start(QUIZ.id);
      await settle();
      expect(viewer.load).toHaveBeenCalledWith(MANIFESTS['mitochondrion']);
      expect(viewer.listInstances).toHaveBeenCalledWith('granules');
      expect(viewer.select).toHaveBeenLastCalledWith(
        { partId: 'granules', instance: 'g-1' },
        { fly: true },
      );
    });
  });
});
