import { loadSeedFile, toRows } from '../../seed/seed-data';
import { CompleteResult, QuizStore, QuizSummary, SaveAnswerResult, StoredAttempt, StoredQuiz } from '../quiz.store';

/** QuizStore over the real seed file, kept in memory (unit tests only). */
export class InMemoryQuizStore extends QuizStore {
  readonly quizzes: StoredQuiz[];
  readonly attempts = new Map<string, StoredAttempt>();

  constructor() {
    super();
    const rows = toRows(loadSeedFile());
    this.quizzes = rows.quizzes.map((q) => ({
      ...q,
      questions: rows.questions
        .filter((x) => x.quizId === q.id)
        .map((x) => ({
          ...x,
          options: rows.options
            .filter((o) => o.questionId === x.id)
            .sort((a, b) => a.position - b.position)
            .map(({ questionId: _, ...o }) => o),
        })),
    }));
  }

  async listQuizzes(): Promise<QuizSummary[]> {
    return this.quizzes.map(({ questions, ...q }) => ({ ...q, questionCount: questions.length }));
  }

  async getQuiz(id: string): Promise<StoredQuiz | null> {
    return structuredClone(this.quizzes.find((q) => q.id === id) ?? null);
  }

  async createAttempt(a: { id: string; quizId: string; clientId: string; startedAt: Date; total: number }): Promise<void> {
    this.attempts.set(a.id, { ...a, completedAt: null, score: null, answers: [] });
  }

  async getAttempt(id: string): Promise<StoredAttempt | null> {
    return structuredClone(this.attempts.get(id) ?? null);
  }

  async saveAnswer(a: {
    attemptId: string;
    questionId: string;
    isCorrect: boolean;
    optionIds: string[];
    answeredAt: Date;
  }): Promise<SaveAnswerResult> {
    const attempt = this.attempts.get(a.attemptId);
    if (!attempt) return { status: 'not_found' };
    if (attempt.completedAt) return { status: 'completed' };
    if (attempt.answers.some((x) => x.questionId === a.questionId)) return { status: 'duplicate' };
    attempt.answers.push({ questionId: a.questionId, isCorrect: a.isCorrect, optionIds: [...a.optionIds], answeredAt: a.answeredAt });
    return { status: 'saved', answeredAt: a.answeredAt };
  }

  async completeAttempt(attemptId: string, completedAt: Date): Promise<CompleteResult | null> {
    const a = this.attempts.get(attemptId);
    if (!a) return null;
    const attempt = { id: a.id, quizId: a.quizId, clientId: a.clientId, startedAt: a.startedAt, total: a.total };
    if (a.completedAt) return { attempt, score: a.score ?? 0, completedAt: a.completedAt, newlyCompleted: false };
    a.score = a.answers.filter((x) => x.isCorrect).length;
    a.completedAt = completedAt;
    return { attempt, score: a.score, completedAt, newlyCompleted: true };
  }
}
