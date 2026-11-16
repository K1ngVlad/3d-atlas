import { Module } from '@nestjs/common';
import { ConsulRegistrar } from './consul-registrar.service';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';

@Module({
  controllers: [HealthController],
  providers: [PrismaService, ConsulRegistrar],
})
export class AppModule {}
