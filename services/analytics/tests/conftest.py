"""Tests run against a real PostgreSQL (ON CONFLICT … RETURNING is the point of the idempotency tests).

    TEST_DATABASE_URL=postgresql+asyncpg://postgres:test@localhost:55432/analytics_test pytest

Without TEST_DATABASE_URL the DB tests are skipped; pure validation tests still run.
"""

import os
import uuid
from datetime import UTC, datetime

import pytest

TEST_DB = os.environ.get("TEST_DATABASE_URL")
# app.db builds its engine at import time from DATABASE_URL.
os.environ.setdefault("DATABASE_URL", TEST_DB or "postgresql+asyncpg://unused:unused@localhost:1/unused")

requires_db = pytest.mark.skipif(not TEST_DB, reason="TEST_DATABASE_URL is not set")


@pytest.fixture
async def clean_db():
    from sqlalchemy import text

    from app import db

    await db.create_schema()
    async with db.engine.begin() as conn:
        await conn.execute(text("TRUNCATE answer_events, test_results, question_stats"))
    yield db


def iso(dt: datetime | None = None) -> str:
    return (dt or datetime.now(UTC)).isoformat().replace("+00:00", "Z")


def answer_event(
    *, event_id=None, question_id=None, entity_id="mitochondrion", correct=True, quiz_id="cell-organelles"
):
    return {
        "eventId": str(event_id or uuid.uuid4()),
        "type": "AnswerSubmitted",
        "version": 1,
        "occurredAt": iso(),
        "source": "quiz",
        "payload": {
            "attemptId": str(uuid.uuid4()),
            "quizId": quiz_id,
            "questionId": str(question_id or uuid.uuid4()),
            "questionType": "single",
            "entityId": entity_id,
            "optionIds": [str(uuid.uuid4())],
            "correct": correct,
            "clientId": str(uuid.uuid4()),
            "answeredAt": iso(),
        },
    }


def completed_event(*, event_id=None, attempt_id=None, score=7, total=10, quiz_id="cell-organelles"):
    return {
        "eventId": str(event_id or uuid.uuid4()),
        "type": "TestCompleted",
        "version": 1,
        "occurredAt": iso(),
        "source": "quiz",
        "payload": {
            "attemptId": str(attempt_id or uuid.uuid4()),
            "quizId": quiz_id,
            "clientId": str(uuid.uuid4()),
            "score": score,
            "total": total,
            "startedAt": iso(),
            "completedAt": iso(),
            "durationMs": 61234,
        },
    }
