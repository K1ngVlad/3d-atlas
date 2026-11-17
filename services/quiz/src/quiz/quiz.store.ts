import type { QuestionType } from '../seed/seed-data';

export interface StoredOption {
  id: string;
  position: number;
  text: string;
  isCorrect: boolean;
}

export interface StoredQuestion {
  id: string;
  quizId: string;
  position: number;
  type: QuestionType;
  text: string;
  entityId: string;
  manifestId: string | null;
  partId: string | null;
  options: StoredOption[]; // ordered by position
}

export interface StoredQuiz {
  id: string;
  title: string;
  description: string;
  manifestId: string;
  questions: StoredQuestion[]; // ordered by position
}

export interface QuizSummary {
  id: string;
  title: string;
  description: string;
  manifestId: string;
  questionCount: number;
}

export interface StoredAnswer {
  questionId: string;
  isCorrect: boolean;
  answeredAt: Date;
  optionIds: string[];
}

export interface StoredAttempt {
  id: string;
  quizId: string;
  clientId: string;
  startedAt: Date;
  completedAt: Date | null;
  score: number | null;
  total: number;
  answers: StoredAnswer[];
}

export type SaveAnswerResult =
  | { status: 'saved'; answeredAt: Date }
  | { status: 'duplicate' }
  | { status: 'completed' }
  | { status: 'not_found' };

export interface CompleteResult {
  attempt: Pick<StoredAttempt, 'id' | 'quizId' | 'clientId' | 'startedAt' | 'total'>;
  score: number;
  completedAt: Date;
  /** false when the attempt had already been completed (idempotent repeat: no event). */
  newlyCompleted: boolean;
}

/** Persistence port of the Quiz service (Prisma in production, in-memory in unit tests). */
export abstract class QuizStore {
  abstract listQuizzes(): Promise<QuizSummary[]>;
  abstract getQuiz(id: string): Promise<StoredQuiz | null>;
  abstract createAttempt(a: { id: string; quizId: string; clientId: string; startedAt: Date; total: number }): Promise<void>;
  abstract getAttempt(id: string): Promise<StoredAttempt | null>;
  /** Atomic: locks the attempt, rejects completed attempts and repeated answers. */
  abstract saveAnswer(a: {
    id: string;
    attemptId: string;
    questionId: string;
    isCorrect: boolean;
    optionIds: string[];
    answeredAt: Date;
  }): Promise<SaveAnswerResult>;
  /** Atomic and idempotent: the first call fixes score and completedAt, later calls return them. */
  abstract completeAttempt(attemptId: string, completedAt: Date): Promise<CompleteResult | null>;
}
