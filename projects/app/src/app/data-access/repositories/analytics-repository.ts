import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { APP_ENV } from '../../core/config/app-config';

// Типы — по docs/lab/contracts.md, «Analytics Service → API».

export interface AnalyticsSummary {
  attemptsCompleted: number;
  avgScorePct: number;
  answersTotal: number;
  correctRatePct: number;
  /** ISO-время последнего события; `null` — событий ещё не было. */
  lastEventAt: string | null;
}

export interface EntityStat {
  entityId: string;
  answersTotal: number;
  correctRatePct: number;
}

export interface QuestionStat {
  questionId: string;
  quizId: string;
  entityId: string;
  answersTotal: number;
  correctRatePct: number;
}

export interface AnalyticsRepository {
  getSummary(): Promise<AnalyticsSummary>;
  /** По возрастанию доли верных — самые трудные сверху. */
  getEntities(): Promise<EntityStat[]>;
  /** `quizId` не задан — по всем тестам. */
  getQuestions(quizId?: string | null): Promise<QuestionStat[]>;
}

@Injectable({ providedIn: 'root' })
export class HttpAnalyticsRepository implements AnalyticsRepository {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(APP_ENV).apiBase}/api/analytics`;

  getSummary(): Promise<AnalyticsSummary> {
    return firstValueFrom(this.http.get<AnalyticsSummary>(`${this.base}/summary`));
  }

  getEntities(): Promise<EntityStat[]> {
    return firstValueFrom(this.http.get<EntityStat[]>(`${this.base}/entities`));
  }

  getQuestions(quizId?: string | null): Promise<QuestionStat[]> {
    const params = quizId ? new HttpParams().set('quizId', quizId) : undefined;
    return firstValueFrom(this.http.get<QuestionStat[]>(`${this.base}/questions`, { params }));
  }
}

export const ANALYTICS_REPO = new InjectionToken<AnalyticsRepository>('ANALYTICS_REPO', {
  providedIn: 'root',
  factory: () => inject(HttpAnalyticsRepository),
});
