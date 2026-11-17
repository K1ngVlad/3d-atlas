import { EventEmitter } from 'node:events';
import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { EXCHANGE, RabbitQuizEventsPublisher, ROUTING_KEYS } from './rabbit-quiz-events.publisher';

type PublishFn = (exchange: string, key: string, content: Buffer, options: Record<string, unknown>) => Promise<boolean>;

class FakeChannel extends EventEmitter {
  publish = jest.fn<PublishFn>().mockResolvedValue(true);
  close = jest.fn(async () => undefined);
  setup?: (ch: unknown) => Promise<void>;
}

class FakeConnection extends EventEmitter {
  connected = false;
  channel = new FakeChannel();
  options?: Record<string, unknown>;
  isConnected = () => this.connected;
  createChannel = (opts: Record<string, unknown>) => {
    this.options = opts;
    this.channel.setup = opts.setup as FakeChannel['setup'];
    return this.channel;
  };
  close = jest.fn(async () => undefined);
}

const flush = () => new Promise((r) => setImmediate(r));

describe('RabbitQuizEventsPublisher', () => {
  let conn: FakeConnection;
  let publisher: RabbitQuizEventsPublisher;
  let errors: string[];

  beforeEach(() => {
    errors = [];
    Logger.overrideLogger({
      log: () => undefined,
      warn: () => undefined,
      debug: () => undefined,
      verbose: () => undefined,
      error: (m: unknown) => void errors.push(String(m)),
    });
    conn = new FakeConnection();
    publisher = new RabbitQuizEventsPublisher();
    publisher.url = 'amqp://u:p@broker:5672';
    publisher.connectFn = ((urls: unknown, opts: unknown) => {
      expect(urls).toEqual(['amqp://u:p@broker:5672']);
      expect(opts).toMatchObject({ reconnectTimeInSeconds: expect.any(Number) });
      return conn;
    }) as unknown as RabbitQuizEventsPublisher['connectFn'];
    publisher.onModuleInit();
  });

  it('uses a confirm channel that declares the durable topic exchange on every (re)connect', async () => {
    expect(conn.options).toMatchObject({ confirm: true, json: false, publishTimeout: expect.any(Number) });
    const ch = { assertExchange: jest.fn(async () => ({})) };
    await conn.channel.setup!(ch);
    expect(ch.assertExchange).toHaveBeenCalledWith('quiz.events', 'topic', { durable: true });
  });

  it('is ready only while connected and the channel is set up', () => {
    expect(publisher.isReady()).toBe(false);
    conn.connected = true;
    expect(publisher.isReady()).toBe(false);
    conn.channel.emit('connect');
    expect(publisher.isReady()).toBe(true);
    conn.connected = false;
    conn.emit('disconnect', { err: new Error('gone') });
    expect(publisher.isReady()).toBe(false);
  });

  it('publishes the contract envelope: persistent JSON, message_id = eventId, routing key by type', async () => {
    const payload = {
      attemptId: 'a',
      quizId: 'q',
      questionId: 'x',
      questionType: 'single' as const,
      entityId: 'mitochondrion',
      optionIds: ['o'],
      correct: true,
      clientId: 'c',
      answeredAt: '2026-11-20T10:00:00.000Z',
    };
    publisher.answerSubmitted(payload);
    publisher.testCompleted({
      attemptId: 'a',
      quizId: 'q',
      clientId: 'c',
      score: 1,
      total: 2,
      startedAt: '2026-11-20T10:00:00.000Z',
      completedAt: '2026-11-20T10:01:00.000Z',
      durationMs: 60000,
    });
    expect(conn.channel.publish).toHaveBeenCalledTimes(2);
    const [exchange, key, content, options] = conn.channel.publish.mock.calls[0];
    expect(exchange).toBe(EXCHANGE);
    expect(key).toBe(ROUTING_KEYS.AnswerSubmitted);
    const body = JSON.parse(content.toString('utf8'));
    expect(body).toEqual({
      eventId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      type: 'AnswerSubmitted',
      version: 1,
      occurredAt: expect.any(String),
      source: 'quiz',
      payload,
    });
    expect(options).toMatchObject({ persistent: true, contentType: 'application/json', messageId: body.eventId });
    const second = conn.channel.publish.mock.calls[1];
    expect(second[1]).toBe('quiz.test.completed');
    const body2 = JSON.parse(second[2].toString('utf8'));
    expect(body2).toMatchObject({ type: 'TestCompleted', payload: { score: 1, total: 2, durationMs: 60000 } });
    expect(body2.eventId).not.toBe(body.eventId);
  });

  it('never throws when the broker rejects or times out: the error is logged', async () => {
    conn.channel.publish.mockRejectedValueOnce(new Error('timeout'));
    expect(() => publisher.testCompleted({} as never)).not.toThrow();
    await flush();
    expect(errors.some((e) => e.includes('lost') && e.includes('timeout'))).toBe(true);
  });

  it('closes channel and connection on shutdown', async () => {
    await publisher.onApplicationShutdown();
    expect(conn.channel.close).toHaveBeenCalled();
    expect(conn.close).toHaveBeenCalled();
  });
});
