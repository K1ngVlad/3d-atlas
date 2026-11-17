"""Idempotent writes of quiz events (contracts.md: `eventId` is the primary key of the raw event)."""

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from .events import AnswerSubmitted, TestCompleted
from .models import answer_events, question_stats, test_results


async def save_answer(session: AsyncSession, event: AnswerSubmitted) -> bool:
    """Inserts the raw event and, only if it was new, bumps `question_stats` — in the caller's transaction.
    Returns False for a duplicate `eventId`."""
    p = event.payload
    inserted = (
        await session.execute(
            insert(answer_events)
            .values(
                event_id=event.eventId,
                attempt_id=p.attemptId,
                quiz_id=p.quizId,
                question_id=p.questionId,
                entity_id=p.entityId,
                correct=p.correct,
                client_id=p.clientId,
                occurred_at=event.occurredAt,
                payload=p.model_dump(mode="json"),
            )
            .on_conflict_do_nothing()
            .returning(answer_events.c.event_id)
        )
    ).scalar_one_or_none()
    if inserted is None:
        return False

    correct = 1 if p.correct else 0
    stmt = insert(question_stats).values(
        question_id=p.questionId,
        quiz_id=p.quizId,
        entity_id=p.entityId,
        answers_total=1,
        answers_correct=correct,
        updated_at=func.now(),
    )
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[question_stats.c.question_id],
            set_={
                "answers_total": question_stats.c.answers_total + 1,
                "answers_correct": question_stats.c.answers_correct + correct,
                "quiz_id": stmt.excluded.quiz_id,
                "entity_id": stmt.excluded.entity_id,
                "updated_at": func.now(),
            },
        )
    )
    return True


async def save_test_result(session: AsyncSession, event: TestCompleted) -> bool:
    """Inserts the attempt result; a repeated event (same `eventId` or `attemptId`) is ignored.
    Returns False for a duplicate."""
    p = event.payload
    inserted = (
        await session.execute(
            insert(test_results)
            .values(
                attempt_id=p.attemptId,
                event_id=event.eventId,
                quiz_id=p.quizId,
                client_id=p.clientId,
                score=p.score,
                total=p.total,
                duration_ms=p.durationMs,
                completed_at=p.completedAt,
            )
            .on_conflict_do_nothing()
            .returning(test_results.c.attempt_id)
        )
    ).scalar_one_or_none()
    return inserted is not None
