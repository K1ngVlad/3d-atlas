import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { APP_ENV } from '../../core/config/app-config';
import { ClientIdService } from '../client-id';

// Типы — по docs/lab/contracts.md, «Quiz Service → API».

export type QuestionType = 'single' | 'multiple';

export interface QuizSummary {
  id: string;
  title: string;
  description: string;
  manifestId: string;
  questionCount: number;
}

export interface QuizOption {
  id: string;
  text: string;
}

export interface QuizQuestion {
  id: string;
  order: number;
  type: QuestionType;
  text: string;
  manifestId: string | null;
  partId: string | null;
  options: QuizOption[];
}

export interface QuizDetail {
  id: string;
  title: string;
  description: string;
  manifestId: string;
  questions: QuizQuestion[];
}

export interface AttemptStarted {
  attemptId: string;
  startedAt: string;
}

/** Сущность каталога в ответе Quiz (Quiz сам ходит в Catalog). */
export interface AnswerEntity {
  id: string;
  title: string;
  summary: string;
}

export interface AnswerResult {
  correct: boolean;
  correctOptionIds: string[];
  /** `null` — Catalog недоступен, ответ всё равно проверен. */
  entity: AnswerEntity | null;
}

export interface CompleteResult {
  score: number;
  total: number;
  completedAt: string;
}

export interface AttemptAnswer {
  questionId: string;
  optionIds: string[];
  correct: boolean;
  correctOptionIds: string[];
}

export interface AttemptDetail {
  attemptId: string;
  quizId: string;
  startedAt: string;
  completedAt: string | null;
  score: number | null;
  total: number;
  answers: AttemptAnswer[];
}

/**
 * Ошибки — исходные `HttpErrorResponse` (статус читает `httpStatus`):
 * `404` — нет теста / попытки (или чужой `X-Client-Id`), `409` — уже отвечено / попытка завершена.
 */
export interface QuizRepository {
  listQuizzes(): Promise<QuizSummary[]>;
  getQuiz(id: string): Promise<QuizDetail>;
  startAttempt(quizId: string): Promise<AttemptStarted>;
  /** Пустой `optionIds` — «Не знаю». */
  submitAnswer(attemptId: string, questionId: string, optionIds: string[]): Promise<AnswerResult>;
  completeAttempt(attemptId: string): Promise<CompleteResult>;
  getAttempt(attemptId: string): Promise<AttemptDetail>;
}

type RawText = string | { ru?: string } | null | undefined;

/** Контракт не уточняет форму `title` / `summary` сущности: строка или `{ ru }`, как в Catalog. */
function plainText(v: RawText): string {
  if (typeof v === 'string') return v;
  return v?.ru ?? '';
}

function normalizeEntity(raw: unknown): AnswerEntity | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as { id?: string; title?: RawText; summary?: RawText };
  if (!e.id) return null;
  return { id: e.id, title: plainText(e.title) || e.id, summary: plainText(e.summary) };
}

@Injectable({ providedIn: 'root' })
export class HttpQuizRepository implements QuizRepository {
  private readonly http = inject(HttpClient);
  private readonly clientId = inject(ClientIdService);
  private readonly base = `${inject(APP_ENV).apiBase}/api/quiz`;

  private attemptUrl(attemptId: string, tail = ''): string {
    return `${this.base}/attempts/${encodeURIComponent(attemptId)}${tail}`;
  }

  private headers(): HttpHeaders {
    return new HttpHeaders({ 'X-Client-Id': this.clientId.id });
  }

  listQuizzes(): Promise<QuizSummary[]> {
    return firstValueFrom(this.http.get<QuizSummary[]>(`${this.base}/quizzes`));
  }

  getQuiz(id: string): Promise<QuizDetail> {
    return firstValueFrom(
      this.http.get<QuizDetail>(`${this.base}/quizzes/${encodeURIComponent(id)}`),
    );
  }

  startAttempt(quizId: string): Promise<AttemptStarted> {
    return firstValueFrom(
      this.http.post<AttemptStarted>(
        `${this.base}/attempts`,
        { quizId, clientId: this.clientId.id },
        { headers: this.headers() },
      ),
    );
  }

  async submitAnswer(
    attemptId: string,
    questionId: string,
    optionIds: string[],
  ): Promise<AnswerResult> {
    const raw = await firstValueFrom(
      this.http.post<AnswerResult>(
        this.attemptUrl(attemptId, '/answers'),
        { questionId, optionIds },
        { headers: this.headers() },
      ),
    );
    return {
      correct: raw.correct,
      correctOptionIds: raw.correctOptionIds ?? [],
      entity: normalizeEntity(raw.entity),
    };
  }

  completeAttempt(attemptId: string): Promise<CompleteResult> {
    return firstValueFrom(
      this.http.post<CompleteResult>(
        this.attemptUrl(attemptId, '/complete'),
        {},
        { headers: this.headers() },
      ),
    );
  }

  getAttempt(attemptId: string): Promise<AttemptDetail> {
    return firstValueFrom(
      this.http.get<AttemptDetail>(this.attemptUrl(attemptId), { headers: this.headers() }),
    );
  }
}

export const QUIZ_REPO = new InjectionToken<QuizRepository>('QUIZ_REPO', {
  providedIn: 'root',
  factory: () => inject(HttpQuizRepository),
});
