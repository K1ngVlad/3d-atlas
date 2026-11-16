import { Controller, Get, HttpException, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('health')
export class HealthController {
  private readonly log = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health(): Promise<{ status: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch (e) {
      this.log.warn(`Health check failed: ${(e as Error).message}`);
      throw new HttpException({ error: 'unavailable', message: 'database is unavailable' }, 503);
    }
  }
}
