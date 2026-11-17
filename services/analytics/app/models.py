"""analytics_db schema (contracts.md, "Analytics Service" -> "Таблицы (3)").

The schema is created with `metadata.create_all` at startup (see `db.create_schema`): three tables,
no migrations yet. `create_all` is idempotent (CREATE TABLE only for missing tables).
"""

from sqlalchemy import BigInteger, Boolean, Column, DateTime, Integer, MetaData, Table, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID

metadata = MetaData()

answer_events = Table(
    "answer_events",
    metadata,
    Column("event_id", UUID(as_uuid=True), primary_key=True),
    Column("attempt_id", UUID(as_uuid=True), nullable=False),
    Column("quiz_id", Text, nullable=False),
    Column("question_id", UUID(as_uuid=True), nullable=False),
    Column("entity_id", Text, nullable=False, index=True),
    Column("correct", Boolean, nullable=False),
    Column("client_id", UUID(as_uuid=True), nullable=False),
    Column("occurred_at", DateTime(timezone=True), nullable=False),
    Column("payload", JSONB, nullable=False),
)

test_results = Table(
    "test_results",
    metadata,
    Column("attempt_id", UUID(as_uuid=True), primary_key=True),
    Column("event_id", UUID(as_uuid=True), nullable=False, unique=True),
    Column("quiz_id", Text, nullable=False),
    Column("client_id", UUID(as_uuid=True), nullable=False),
    Column("score", Integer, nullable=False),
    Column("total", Integer, nullable=False),
    Column("duration_ms", BigInteger, nullable=False),
    Column("completed_at", DateTime(timezone=True), nullable=False),
)

question_stats = Table(
    "question_stats",
    metadata,
    Column("question_id", UUID(as_uuid=True), primary_key=True),
    Column("quiz_id", Text, nullable=False, index=True),
    Column("entity_id", Text, nullable=False),
    Column("answers_total", Integer, nullable=False),
    Column("answers_correct", Integer, nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)
