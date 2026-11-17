"""RabbitMQ consumer of quiz events (contracts.md, "RabbitMQ: события").

Topology (all declarations are idempotent, start order does not matter):
  quiz.events (topic, durable; also declared by Quiz)
    └─ quiz.#  ─▶ analytics.quiz-events (durable, x-dead-letter-exchange=analytics.dlx)
  analytics.dlx (fanout, durable) ─▶ analytics.quiz-events.dlq (durable)

Manual ack, prefetch 10. Invalid message → reject(requeue=False) → DLQ. DB error → nack(requeue=True).
"""

import asyncio
import enum
import logging
import os

import aio_pika
from aio_pika.abc import AbstractIncomingMessage, AbstractRobustConnection
from pydantic import ValidationError

from . import store
from .db import SessionLocal
from .events import AnswerSubmitted, parse_event

log = logging.getLogger("consumer")

EVENTS_EXCHANGE = "quiz.events"
QUEUE = "analytics.quiz-events"
DLX = "analytics.dlx"
DLQ = "analytics.quiz-events.dlq"
BINDING_KEY = "quiz.#"
PREFETCH = 10
RETRY_S = 3
REQUEUE_DELAY_S = 1  # avoids a hot redelivery loop while the DB is down

RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")


class Outcome(enum.Enum):
    ACK = "ack"
    REJECT = "reject"  # invalid message → DLQ
    REQUEUE = "requeue"  # transient failure → back to the queue


async def handle(body: bytes, session_factory=SessionLocal) -> Outcome:
    """Validates and stores one message. Kept free of AMQP types so it can be tested without a broker."""
    try:
        event = parse_event(body)
    except ValidationError as e:
        log.warning("Invalid message -> DLQ: %s; body=%.300r", _short(e), body)
        return Outcome.REJECT

    try:
        async with session_factory() as session, session.begin():
            if isinstance(event, AnswerSubmitted):
                new = await store.save_answer(session, event)
            else:
                new = await store.save_test_result(session, event)
    except Exception as e:  # noqa: BLE001 - any DB failure is transient for us
        log.error("Failed to store event %s (%s): %s; requeueing", event.eventId, event.type, e)
        return Outcome.REQUEUE

    if new:
        log.info("Stored %s %s", event.type, event.eventId)
    else:
        log.info("Duplicate %s %s ignored", event.type, event.eventId)
    return Outcome.ACK


def _short(e: ValidationError) -> str:
    return "; ".join(f"{'.'.join(map(str, err['loc'])) or '<root>'}: {err['msg']}" for err in e.errors()[:5])


class Consumer:
    def __init__(self, url: str = RABBITMQ_URL) -> None:
        self._url = url
        self._connection: AbstractRobustConnection | None = None
        self._consuming = False

    @property
    def ready(self) -> bool:
        """True while the connection is open and the queue is being consumed (used by /health)."""
        return self._consuming and self._connection is not None and not self._connection.is_closed

    async def run(self, db_ready: asyncio.Event) -> None:
        """Background task for the FastAPI lifespan: waits for the DB schema, then connects with retries.
        After the first successful connection `connect_robust` restores channel, queue and consumer itself."""
        await db_ready.wait()
        while True:
            try:
                await self._start()
                return
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 - keep retrying whatever happens
                log.warning("RabbitMQ connection failed (%s); retrying in %ss", e, RETRY_S)
                await self._close()
                await asyncio.sleep(RETRY_S)

    async def _start(self) -> None:
        self._connection = await aio_pika.connect_robust(self._url, reconnect_interval=RETRY_S)
        self._connection.close_callbacks.add(self._on_close)
        self._connection.reconnect_callbacks.add(self._on_reconnect)

        channel = await self._connection.channel()
        await channel.set_qos(prefetch_count=PREFETCH)

        events = await channel.declare_exchange(EVENTS_EXCHANGE, aio_pika.ExchangeType.TOPIC, durable=True)
        dlx = await channel.declare_exchange(DLX, aio_pika.ExchangeType.FANOUT, durable=True)
        dlq = await channel.declare_queue(DLQ, durable=True)
        await dlq.bind(dlx)
        queue = await channel.declare_queue(QUEUE, durable=True, arguments={"x-dead-letter-exchange": DLX})
        await queue.bind(events, routing_key=BINDING_KEY)

        await queue.consume(self._on_message, no_ack=False)
        self._consuming = True
        log.info("Consuming %s (prefetch %s)", QUEUE, PREFETCH)

    def _on_close(self, *_args) -> None:
        if self._consuming:
            log.warning("RabbitMQ connection lost; reconnecting")
        self._consuming = False

    def _on_reconnect(self, *_args) -> None:
        # connect_robust re-declares the topology and restarts the consumer before this callback fires.
        log.info("RabbitMQ reconnected")
        self._consuming = True

    async def _on_message(self, message: AbstractIncomingMessage) -> None:
        outcome = await handle(message.body)
        if outcome is Outcome.ACK:
            await message.ack()
        elif outcome is Outcome.REJECT:
            await message.reject(requeue=False)
        else:
            await asyncio.sleep(REQUEUE_DELAY_S)
            await message.nack(requeue=True)

    async def _close(self) -> None:
        self._consuming = False
        if self._connection is not None:
            try:
                await self._connection.close()
            except Exception as e:  # noqa: BLE001
                log.debug("Ignoring error while closing RabbitMQ connection: %s", e)
            self._connection = None

    async def close(self) -> None:
        await self._close()
