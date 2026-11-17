import { Controller, Get, HttpException, Logger } from '@nestjs/common';
import { QuizEventsPublisher } from './events/quiz-events.publisher';
import { PrismaService } from './prisma.service';

/** `200 {"status":"ok"}` only when the database and the message broker are reachable (contracts.md). */
@Controller('health')
export class HealthController {
  private readonly log = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: QuizEventsPublisher,
  ) {}

  @Get()
  async health(): Promise<{ status: string }> {
    const problems: string[] = [];
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      this.log.warn(`Health check: database failed: ${(e as Error).message}`);
      problems.push('database is unavailable');
    }
    if (!this.events.isReady()) problems.push('message broker is unavailable');
    if (problems.length) {
      throw new HttpException({ error: 'unavailable', message: problems.join('; ') }, 503);
    }
    return { status: 'ok' };
  }
}
