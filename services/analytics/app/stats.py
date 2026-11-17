"""Statistics queries (contracts.md, "Analytics Service" -> API). Percentages are rounded to one decimal
in SQL (`round(numeric, 1)`, half away from zero); no data → zeros and `lastEventAt: null`."""

from datetime import datetime

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class Summary(BaseModel):
    attemptsCompleted: int
    avgScorePct: float
    answersTotal: int
    correctRatePct: float
    lastEventAt: datetime | None


class EntityStats(BaseModel):
    entityId: str
    answersTotal: int
    correctRatePct: float


class QuestionStats(BaseModel):
    questionId: str
    quizId: str
    entityId: str
    answersTotal: int
    correctRatePct: float


_SUMMARY = text(
    """
    SELECT
      (SELECT count(*) FROM test_results) AS attempts_completed,
      (SELECT coalesce(round(avg(score * 100.0 / nullif(total, 0)), 1), 0) FROM test_results) AS avg_score_pct,
      (SELECT coalesce(sum(answers_total), 0) FROM question_stats) AS answers_total,
      (SELECT coalesce(round(sum(answers_correct) * 100.0 / nullif(sum(answers_total), 0), 1), 0)
         FROM question_stats) AS correct_rate_pct,
      greatest(
        (SELECT max(occurred_at) FROM answer_events),
        (SELECT max(completed_at) FROM test_results)
      ) AS last_event_at
    """
)

_ENTITIES = text(
    """
    SELECT entity_id,
           count(*) AS answers_total,
           round(count(*) FILTER (WHERE correct) * 100.0 / count(*), 1) AS correct_rate_pct
    FROM answer_events
    GROUP BY entity_id
    ORDER BY correct_rate_pct, answers_total DESC, entity_id
    """
)

_QUESTIONS = text(
    """
    SELECT question_id, quiz_id, entity_id, answers_total,
           coalesce(round(answers_correct * 100.0 / nullif(answers_total, 0), 1), 0) AS correct_rate_pct
    FROM question_stats
    WHERE CAST(:quiz_id AS text) IS NULL OR quiz_id = :quiz_id
    ORDER BY quiz_id, correct_rate_pct, question_id
    """
)


async def summary(session: AsyncSession) -> Summary:
    r = (await session.execute(_SUMMARY)).one()
    return Summary(
        attemptsCompleted=r.attempts_completed,
        avgScorePct=float(r.avg_score_pct),
        answersTotal=int(r.answers_total),
        correctRatePct=float(r.correct_rate_pct),
        lastEventAt=r.last_event_at,
    )


async def entities(session: AsyncSession) -> list[EntityStats]:
    rows = (await session.execute(_ENTITIES)).all()
    return [
        EntityStats(entityId=r.entity_id, answersTotal=r.answers_total, correctRatePct=float(r.correct_rate_pct))
        for r in rows
    ]


async def questions(session: AsyncSession, quiz_id: str | None) -> list[QuestionStats]:
    rows = (await session.execute(_QUESTIONS, {"quiz_id": quiz_id})).all()
    return [
        QuestionStats(
            questionId=str(r.question_id),
            quizId=r.quiz_id,
            entityId=r.entity_id,
            answersTotal=r.answers_total,
            correctRatePct=float(r.correct_rate_pct),
        )
        for r in rows
    ]
