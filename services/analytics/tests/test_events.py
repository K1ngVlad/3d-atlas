"""Envelope and payload validation (no DB)."""

import json

import pytest
from pydantic import ValidationError

from app.events import AnswerSubmitted, TestCompleted, parse_event
from conftest import answer_event, completed_event


def dump(obj) -> bytes:
    return json.dumps(obj).encode()


def test_parses_answer_submitted():
    event = parse_event(dump(answer_event()))
    assert isinstance(event, AnswerSubmitted)


def test_parses_test_completed():
    event = parse_event(dump(completed_event()))
    assert isinstance(event, TestCompleted)
    assert event.payload.durationMs == 61234


def test_ignores_unknown_extra_fields():
    raw = answer_event()
    raw["traceId"] = "x"
    raw["payload"]["extra"] = 1
    assert isinstance(parse_event(dump(raw)), AnswerSubmitted)


def _without(raw: dict, key: str) -> dict:
    raw["payload"].pop(key)
    return raw


@pytest.mark.parametrize(
    "body",
    [
        b"not json",
        b"",
        dump({"foo": 1}),
        dump([]),
        dump({**answer_event(), "type": "SomethingElse"}),
        dump({**answer_event(), "version": 2}),
        dump({**answer_event(), "eventId": "not-a-uuid"}),
        dump({**answer_event(), "occurredAt": "2026-11-20T10:00:00"}),  # no timezone
        dump(_without(answer_event(), "correct")),
        dump(_without(answer_event(), "entityId")),
        dump({**answer_event(), "payload": completed_event()["payload"]}),  # payload of another type
        dump(_without(completed_event(), "score")),
        dump({**completed_event(), "payload": {**completed_event()["payload"], "score": -1}}),
    ],
)
def test_rejects_invalid(body: bytes):
    with pytest.raises(ValidationError):
        parse_event(body)
