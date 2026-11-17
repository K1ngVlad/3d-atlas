import { Module } from '@nestjs/common';
import { ConsulRegistrar } from './consul-registrar.service';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { SeedService } from './seed/seed.service';

@Module({
  controllers: [HealthController],
  providers: [PrismaService, SeedService, ConsulRegistrar],
})
export class AppModule {}
