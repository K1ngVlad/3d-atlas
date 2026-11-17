import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { loadSeedFile, toRows } from './seed-data';

/** Arbitrary constant key for pg_advisory_xact_lock: serialises seeding across `--scale quiz=N`. */
const SEED_LOCK_KEY = 0x71_75_69_7a; // "quiz"

/**
 * Loads prisma/seed/quizzes.json into an empty database on start (contracts.md, "Начальные данные").
 * An invalid seed file aborts the start with the list of problems.
 */
@Injectable()
export class SeedService implements OnModuleInit {
  private readonly log = new Logger(SeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const seed = loadSeedFile(process.env.QUIZ_SEED_FILE || undefined);
    const rows = toRows(seed);
    const inserted = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(${SEED_LOCK_KEY})) AS l`;
        if ((await tx.quiz.count()) > 0) return false;
        await tx.quiz.createMany({ data: rows.quizzes });
        await tx.question.createMany({ data: rows.questions });
        await tx.answerOption.createMany({ data: rows.options });
        return true;
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
    if (inserted) {
      this.log.log(
        `Seeded ${rows.quizzes.length} quizzes, ${rows.questions.length} questions, ${rows.options.length} options`,
      );
    } else {
      this.log.log('Quizzes already present, seed skipped');
    }
  }
}
