import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { connect, type AmqpConnectionManager, type ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel } from 'amqplib';
import { AnswerSubmittedPayload, QuizEventsPublisher, TestCompletedPayload } from './quiz-events.publisher';

export const EXCHANGE = 'quiz.events';
export const ROUTING_KEYS = {
  AnswerSubmitted: 'quiz.answer.submitted',
  TestCompleted: 'quiz.test.completed',
} as const;
export type QuizEventType = keyof typeof ROUTING_KEYS;

/** Envelope from contracts.md, "RabbitMQ: события". */
export interface QuizEventEnvelope<P> {
  eventId: string;
  type: QuizEventType;
  version: 1;
  occurredAt: string;
  source: 'quiz';
  payload: P;
}

export function envelope<P>(type: QuizEventType, payload: P, now = new Date()): QuizEventEnvelope<P> {
  return { eventId: randomUUID(), type, version: 1, occurredAt: now.toISOString(), source: 'quiz', payload };
}

/** A message waits for a (re)connection and a broker confirm at most this long, then it is logged as lost. */
export const PUBLISH_TIMEOUT_MS = 10_000;

/**
 * QuizEventsPublisher on RabbitMQ: plain amqplib + amqp-connection-manager (reconnects, re-declares the
 * exchange on every connection), confirm channel, persistent JSON messages with `message_id = eventId`.
 * Not `@nestjs/microservices`: it would wrap messages into `{pattern, data}` (stage-3 doc).
 */
@Injectable()
export class RabbitQuizEventsPublisher extends QuizEventsPublisher implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('QuizEvents');
  private connection?: AmqpConnectionManager;
  private channel?: ChannelWrapper;
  private channelReady = false;

  /** Overridable in tests. */
  connectFn: typeof connect = connect;
  url = process.env.RABBITMQ_URL ?? 'amqp://rabbitmq:5672';

  onModuleInit(): void {
    // Connects in the background: the service starts (and reports 503 on /health) even without a broker.
    const connection = this.connectFn([this.url], { heartbeatIntervalInSeconds: 5, reconnectTimeInSeconds: 3 });
    this.connection = connection;
    connection.on('connect', ({ url }) => this.log.log(`Connected to RabbitMQ ${redact(url)}`));
    connection.on('connectFailed', ({ err }) => this.log.warn(`RabbitMQ connection failed: ${errorText(err)}`));
    connection.on('disconnect', ({ err }) => {
      this.channelReady = false;
      this.log.warn(`Disconnected from RabbitMQ${err ? `: ${errorText(err)}` : ''}`);
    });
    this.channel = connection.createChannel({
      name: 'quiz-events',
      confirm: true,
      json: false,
      publishTimeout: PUBLISH_TIMEOUT_MS,
      setup: async (ch: ConfirmChannel) => {
        await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
      },
    });
    this.channel.on('connect', () => {
      this.channelReady = true;
      this.log.log(`Exchange "${EXCHANGE}" declared, publisher ready`);
    });
    this.channel.on('error', (err) => {
      this.channelReady = false;
      this.log.error(`RabbitMQ channel setup failed: ${(err as Error)?.message ?? err}`);
    });
  }

  isReady(): boolean {
    return !!this.connection?.isConnected() && this.channelReady;
  }

  answerSubmitted(payload: AnswerSubmittedPayload): void {
    this.publish('AnswerSubmitted', payload);
  }

  testCompleted(payload: TestCompletedPayload): void {
    this.publish('TestCompleted', payload);
  }

  private publish<P>(type: QuizEventType, payload: P): void {
    const event = envelope(type, payload);
    if (!this.channel) {
      this.log.error(`Event ${type} ${event.eventId} lost: publisher is not initialised`);
      return;
    }
    if (!this.isReady()) this.log.warn(`RabbitMQ is unavailable; ${type} ${event.eventId} waits up to ${PUBLISH_TIMEOUT_MS} ms`);
    this.channel
      .publish(EXCHANGE, ROUTING_KEYS[type], Buffer.from(JSON.stringify(event)), {
        persistent: true,
        contentType: 'application/json',
        messageId: event.eventId,
        type,
        appId: 'quiz',
        timestamp: Math.floor(Date.parse(event.occurredAt) / 1000),
      })
      .then(
        () => this.log.debug(`Published ${type} ${event.eventId}`),
        (err: Error) => this.log.error(`Event ${type} ${event.eventId} lost (decision 43): ${err.message}`),
      );
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch (e) {
      this.log.warn(`RabbitMQ close failed: ${(e as Error).message}`);
    }
  }
}

function redact(url: unknown): string {
  return typeof url === 'string' ? url.replace(/\/\/[^@/]*@/, '//***@') : 'broker';
}

/** ECONNREFUSED arrives as an AggregateError with an empty message. */
function errorText(err: unknown): string {
  const e = err as { message?: string; code?: string; errors?: unknown[] };
  if (e?.message) return e.message;
  if (e?.code) return e.code;
  if (Array.isArray(e?.errors) && e.errors.length) return errorText(e.errors[0]);
  return String(err);
}
