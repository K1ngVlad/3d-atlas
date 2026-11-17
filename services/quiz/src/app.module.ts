import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { CatalogClient } from './catalog/catalog.client';
import { ApiErrorFilter } from './common/api-error';
import { ConsulRegistrar } from './consul-registrar.service';
import { LoggingQuizEventsPublisher, QuizEventsPublisher } from './events/quiz-events.publisher';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { PrismaQuizStore } from './quiz/prisma-quiz.store';
import { QuizController } from './quiz/quiz.controller';
import { QuizService } from './quiz/quiz.service';
import { QuizStore } from './quiz/quiz.store';
import { SeedService } from './seed/seed.service';

@Module({
  controllers: [HealthController, QuizController],
  providers: [
    PrismaService,
    SeedService,
    ConsulRegistrar,
    CatalogClient,
    QuizService,
    { provide: QuizStore, useClass: PrismaQuizStore },
    { provide: QuizEventsPublisher, useClass: LoggingQuizEventsPublisher },
    { provide: APP_FILTER, useClass: ApiErrorFilter },
  ],
})
export class AppModule {}
