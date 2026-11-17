"""Statistics endpoints (contracts.md, "Analytics Service" -> API). The app is called without lifespan,
so no Consul / RabbitMQ connections are made."""

import json
import uuid

import httpx

from app.consumer import Outcome, handle
from app.main import app
from conftest import answer_event, completed_event, requires_db

pytestmark = requires_db


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def feed(*events):
    for e in events:
        assert await handle(json.dumps(e).encode()) is Outcome.ACK


async def test_empty_database_gives_zeros(clean_db):
    async with client() as c:
        r = await c.get("/api/analytics/summary")
        assert r.status_code == 200
        assert r.json() == {
            "attemptsCompleted": 0,
            "avgScorePct": 0.0,
            "answersTotal": 0,
            "correctRatePct": 0.0,
            "lastEventAt": None,
        }
        assert r.headers["X-Instance"]
        assert (await c.get("/api/analytics/entities")).json() == []
        assert (await c.get("/api/analytics/questions")).json() == []


async def test_statistics(clean_db):
    q1, q2, q3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    await feed(
        answer_event(question_id=q1, entity_id="mitochondrion", correct=True),
        answer_event(question_id=q1, entity_id="mitochondrion", correct=False),
        answer_event(question_id=q1, entity_id="mitochondrion", correct=False),
        answer_event(question_id=q2, entity_id="golgi", correct=True),
        answer_event(question_id=q3, entity_id="nucleus", correct=True, quiz_id="organelle-structure"),
        completed_event(score=2, total=3),
        completed_event(score=1, total=3),
    )
    async with client() as c:
        s = (await c.get("/api/analytics/summary")).json()
        assert s["attemptsCompleted"] == 2
        assert s["avgScorePct"] == 50.0  # (66.67 + 33.33) / 2
        assert s["answersTotal"] == 5
        assert s["correctRatePct"] == 60.0
        assert s["lastEventAt"].endswith("Z")

        entities = (await c.get("/api/analytics/entities")).json()
        assert entities[0] == {"entityId": "mitochondrion", "answersTotal": 3, "correctRatePct": 33.3}
        assert [e["entityId"] for e in entities[1:]] == ["golgi", "nucleus"]  # both 100 %, then by id

        all_q = (await c.get("/api/analytics/questions")).json()
        assert len(all_q) == 3
        only = (await c.get("/api/analytics/questions", params={"quizId": "organelle-structure"})).json()
        assert only == [
            {
                "questionId": str(q3),
                "quizId": "organelle-structure",
                "entityId": "nucleus",
                "answersTotal": 1,
                "correctRatePct": 100.0,
            }
        ]
        assert (await c.get("/api/analytics/questions", params={"quizId": "missing"})).json() == []


async def test_health_is_503_without_broker(clean_db):
    # Schema is ready and DB answers, but the consumer never connected (no lifespan here).
    from app import main

    main.schema_ready.set()
    async with client() as c:
        r = await c.get("/health")
    assert r.status_code == 503
    assert r.json()["error"] == "unavailable"
