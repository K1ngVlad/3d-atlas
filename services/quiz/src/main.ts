import 'reflect-metadata';
import { hostname } from 'node:os';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  // X-Instance on every response (contracts.md); Fastify hook, not Express middleware.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (_req, reply) => {
      reply.header('X-Instance', hostname());
    });
  app.enableShutdownHooks();
  await app.listen(8080, '0.0.0.0');
}

void bootstrap();
