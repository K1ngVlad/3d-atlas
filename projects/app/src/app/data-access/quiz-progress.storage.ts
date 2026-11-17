import { Injectable } from '@angular/core';

export interface LastQuizResult {
  score: number;
  total: number;
  completedAt: string;
}

const attemptKey = (quizId: string) => `atlas.quiz.${quizId}.attemptId`;
const resultKey = (quizId: string) => `atlas.quiz.${quizId}.lastResult`;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // приватный режим / квота — прогресс просто не переживёт перезагрузку
  }
}

/**
 * Ключи к попыткам в этом браузере (docs/lab/quiz-ux.md, Т7 и Т11):
 * `atlas.quiz.<quizId>.attemptId` и `atlas.quiz.<quizId>.lastResult`.
 */
@Injectable({ providedIn: 'root' })
export class QuizProgressStorage {
  getAttemptId(quizId: string): string | null {
    return read(attemptKey(quizId));
  }

  saveAttemptId(quizId: string, attemptId: string): void {
    write(attemptKey(quizId), attemptId);
  }

  forgetAttempt(quizId: string): void {
    write(attemptKey(quizId), null);
  }

  getLastResult(quizId: string): LastQuizResult | null {
    const raw = read(resultKey(quizId));
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as Partial<LastQuizResult>;
      if (typeof v.score !== 'number' || typeof v.total !== 'number') return null;
      return { score: v.score, total: v.total, completedAt: String(v.completedAt ?? '') };
    } catch {
      return null;
    }
  }

  saveLastResult(quizId: string, result: LastQuizResult): void {
    write(resultKey(quizId), JSON.stringify(result));
  }
}
