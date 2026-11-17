import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { httpStatus } from '../../core/http/http-status';
import { QuizProgressStorage } from '../../data-access/quiz-progress.storage';
import { QUIZ_REPO, type QuizSummary } from '../../data-access/repositories/quiz-repository';
import { QuizCanvas } from './quiz-canvas.service';
import { QuizListComponent, type QuizCard, type QuizListStatus } from './ui/quiz-list.component';

/** Модель на холсте, пока тестов нет или список не загрузился. */
const FALLBACK_MANIFEST = 'animal-cell';

/** `/quiz`: список тестов; на холсте — модель первого теста, без выбора и сносок. */
@Component({
  selector: 'app-quiz-list-page',
  imports: [QuizListComponent],
  template: `
    <app-quiz-list
      [status]="status()"
      [cards]="cards()"
      (startQuiz)="open($event)"
      (resumeQuiz)="open($event)"
      (restartQuiz)="restart($event)"
      (retry)="load()"
    />
  `,
  styles: `:host { display: block; flex: 1; min-height: 0; overflow-y: auto; }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuizListPageComponent {
  private readonly repo = inject(QUIZ_REPO);
  private readonly progress = inject(QuizProgressStorage);
  private readonly canvas = inject(QuizCanvas);
  private readonly router = inject(Router);

  readonly status = signal<QuizListStatus>('loading');
  readonly cards = signal<QuizCard[]>([]);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.status.set('loading');
    let quizzes: QuizSummary[];
    try {
      quizzes = await this.repo.listQuizzes();
    } catch {
      this.status.set('error');
      this.showModel(FALLBACK_MANIFEST);
      return;
    }
    this.cards.set(quizzes.map((q) => this.toCard(q)));
    this.status.set('ready');
    this.showModel(quizzes[0]?.manifestId ?? FALLBACK_MANIFEST);
    for (const card of this.cards()) {
      if (card.state === 'progress') void this.loadProgress(card.id);
    }
  }

  open(quizId: string): void {
    void this.router.navigate(['/quiz', quizId]);
  }

  /** «Начать заново»: забыть незавершённую попытку (она остаётся в БД) и начать новую. */
  restart(quizId: string): void {
    this.progress.forgetAttempt(quizId);
    this.open(quizId);
  }

  private toCard(q: QuizSummary): QuizCard {
    const inProgress = this.progress.getAttemptId(q.id) !== null;
    const last = this.progress.getLastResult(q.id);
    return {
      id: q.id,
      title: q.title,
      description: q.description,
      questionCount: q.questionCount,
      state: inProgress ? 'progress' : last ? 'done' : 'new',
      answered: null,
      last,
    };
  }

  /** «Пройдено N из M» — по попытке с сервера; завершённая или чужая — забыть. */
  private async loadProgress(quizId: string): Promise<void> {
    const attemptId = this.progress.getAttemptId(quizId);
    if (!attemptId) return;
    let patch: Partial<QuizCard>;
    try {
      const a = await this.repo.getAttempt(attemptId);
      if (a.completedAt) {
        this.progress.forgetAttempt(quizId);
        const last = this.progress.getLastResult(quizId);
        patch = { state: last ? 'done' : 'new', last };
      } else {
        patch = { answered: a.answers.length };
      }
    } catch (err) {
      if (httpStatus(err) !== 404) return; // сеть — оставляем «Есть незавершённая попытка»
      this.progress.forgetAttempt(quizId);
      const last = this.progress.getLastResult(quizId);
      patch = { state: last ? 'done' : 'new', last };
    }
    this.cards.update((cards) => cards.map((c) => (c.id === quizId ? { ...c, ...patch } : c)));
  }

  private showModel(manifestId: string): void {
    this.canvas.show({ manifestId, key: 'list', focusPartId: null, labels: 'none' });
  }
}
