"""Quiz event envelope and payloads (contracts.md, "RabbitMQ: события")."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, TypeAdapter


class _Model(BaseModel):
    # Unknown extra fields are ignored: a publisher may add fields without breaking the consumer.
    model_config = ConfigDict(extra="ignore", frozen=True)


class AnswerSubmittedPayload(_Model):
    attemptId: UUID
    quizId: str = Field(min_length=1)
    questionId: UUID
    questionType: Literal["single", "multiple"]
    entityId: str = Field(min_length=1)
    optionIds: list[UUID]
    correct: bool
    clientId: UUID
    answeredAt: AwareDatetime


class TestCompletedPayload(_Model):
    __test__ = False  # not a pytest test class

    attemptId: UUID
    quizId: str = Field(min_length=1)
    clientId: UUID
    score: int = Field(ge=0)
    total: int = Field(ge=0)
    startedAt: AwareDatetime
    completedAt: AwareDatetime
    durationMs: int = Field(ge=0)


class _Envelope(_Model):
    eventId: UUID
    version: Literal[1]
    occurredAt: AwareDatetime
    source: str


class AnswerSubmitted(_Envelope):
    type: Literal["AnswerSubmitted"]
    payload: AnswerSubmittedPayload


class TestCompleted(_Envelope):
    __test__ = False  # not a pytest test class

    type: Literal["TestCompleted"]
    payload: TestCompletedPayload


QuizEvent = Annotated[AnswerSubmitted | TestCompleted, Field(discriminator="type")]

_adapter: TypeAdapter[QuizEvent] = TypeAdapter(QuizEvent)


def parse_event(body: bytes) -> AnswerSubmitted | TestCompleted:
    """Parses and validates a raw message body. Raises `pydantic.ValidationError` on anything invalid
    (not JSON, unknown `type`, missing or malformed fields)."""
    return _adapter.validate_json(body)
