import type { QuestionType } from '../seed/seed-data';

/** Payloads from contracts.md, "RabbitMQ: события". Dates are ISO 8601 strings. */
export interface AnswerSubmittedPayload {
  attemptId: string;
  quizId: string;
  questionId: string;
  questionType: QuestionType;
  entityId: string;
  optionIds: string[];
  correct: boolean;
  clientId: string;
  answeredAt: string;
}

export interface TestCompletedPayload {
  attemptId: string;
  quizId: string;
  clientId: string;
  score: number;
  total: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

/**
 * Extension point for quiz events. Called by QuizService only **after** the transaction commits.
 * Methods never throw and never block the HTTP response: a broker failure is logged (decision 43).
 */
export abstract class QuizEventsPublisher {
  abstract answerSubmitted(payload: AnswerSubmittedPayload): void;
  abstract testCompleted(payload: TestCompletedPayload): void;
  /** Whether events can be delivered right now; feeds `GET /health`. */
  abstract isReady(): boolean;
}

