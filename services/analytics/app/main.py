import asyncio
import logging
import socket
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError

from . import consul, db
from .consumer import Consumer
from .db import engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("aio_pika").setLevel(logging.WARNING)
logging.getLogger("aiormq").setLevel(logging.WARNING)
log = logging.getLogger("analytics")
INSTANCE = socket.gethostname()

schema_ready = asyncio.Event()
consumer = Consumer()


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Nothing here blocks startup: schema creation and the broker connection retry in the background,
    # /health answers 503 until both are up (and Consul keeps the instance out of rotation).
    tasks = [
        asyncio.create_task(consul.registration_loop()),
        asyncio.create_task(db.create_schema_with_retries(schema_ready)),
        asyncio.create_task(consumer.run(schema_ready)),
    ]
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        await consul.deregister()
        await consumer.close()
        await engine.dispose()


app = FastAPI(title="analytics", lifespan=lifespan)


@app.middleware("http")
async def add_instance_header(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Instance"] = INSTANCE
    return response


def _unavailable(message: str) -> JSONResponse:
    return JSONResponse({"error": "unavailable", "message": message}, status_code=503)


@app.get("/health")
async def health():
    if not schema_ready.is_set():
        return _unavailable("database schema is not ready")
    try:
        await db.ping()
    except Exception as e:  # noqa: BLE001
        log.warning("Health check failed: %s", e)
        return _unavailable("database is unavailable")
    if not consumer.ready:
        return _unavailable("message broker consumer is not connected")
    return {"status": "ok"}


async def _db_unavailable(_: Request, e: Exception):
    # DB down while serving statistics → 503 in the contract's error format instead of a bare 500.
    log.error("Database error: %s", e)
    return _unavailable("database is unavailable")


for _exc in (DBAPIError, OSError, TimeoutError):
    app.add_exception_handler(_exc, _db_unavailable)
