"""Message handling against a real PostgreSQL: idempotency and DLQ routing decisions."""

import json
import uuid

from sqlalchemy import func, select

from app.consumer import Outcome, handle
from app.models import answer_events, question_stats, test_results
from conftest import answer_event, completed_event, requires_db

pytestmark = requires_db


def dump(obj) -> bytes:
    return json.dumps(obj).encode()


async def _count(db, table) -> int:
    async with db.SessionLocal() as s:
        return (await s.execute(select(func.count()).select_from(table))).scalar_one()


async def _stats(db, question_id):
    async with db.SessionLocal() as s:
        row = (
            await s.execute(
                select(question_stats.c.answers_total, question_stats.c.answers_correct).where(
                    question_stats.c.question_id == question_id
                )
            )
        ).one()
        return tuple(row)


async def test_answer_updates_question_stats(clean_db):
    q = uuid.uuid4()
    assert await handle(dump(answer_event(question_id=q, correct=True))) is Outcome.ACK
    assert await handle(dump(answer_event(question_id=q, correct=False))) is Outcome.ACK
    assert await _stats(clean_db, q) == (2, 1)


async def test_redelivered_event_id_does_not_change_question_stats(clean_db):
    q = uuid.uuid4()
    body = dump(answer_event(question_id=q, correct=True))
    assert await handle(body) is Outcome.ACK
    before = await _stats(clean_db, q)

    # Same eventId delivered again (broker redelivery or manual republish) → acked, nothing changes.
    assert await handle(body) is Outcome.ACK
    assert await handle(body) is Outcome.ACK

    assert await _stats(clean_db, q) == before == (1, 1)
    assert await _count(clean_db, answer_events) == 1


async def test_test_completed_is_idempotent(clean_db):
    attempt = uuid.uuid4()
    body = dump(completed_event(attempt_id=attempt))
    assert await handle(body) is Outcome.ACK
    assert await handle(body) is Outcome.ACK
    # A second TestCompleted for the same attempt with a new eventId is ignored too (attempt_id is the PK).
    assert await handle(dump(completed_event(attempt_id=attempt, score=1))) is Outcome.ACK

    async with clean_db.SessionLocal() as s:
        rows = (await s.execute(select(test_results.c.score))).scalars().all()
    assert rows == [7]


async def test_invalid_message_is_rejected_and_not_stored(clean_db):
    bad = answer_event()
    del bad["payload"]["correct"]
    for body in (b"not json", dump({"foo": 1}), dump(bad), dump({**answer_event(), "type": "Unknown"})):
        assert await handle(body) is Outcome.REJECT

    assert await _count(clean_db, answer_events) == 0
    assert await _count(clean_db, question_stats) == 0
    assert await _count(clean_db, test_results) == 0


async def test_db_error_requeues():
    def broken_session_factory():
        raise ConnectionRefusedError("db is down")

    assert await handle(dump(answer_event()), session_factory=broken_session_factory) is Outcome.REQUEUE
