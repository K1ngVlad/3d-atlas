import asyncio
import logging
import socket
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from . import consul
from .db import SessionLocal, engine

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("analytics")
INSTANCE = socket.gethostname()


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(consul.registration_loop())
    try:
        yield
    finally:
        task.cancel()
        await consul.deregister()
        await engine.dispose()


app = FastAPI(title="analytics", lifespan=lifespan)


@app.middleware("http")
async def add_instance_header(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Instance"] = INSTANCE
    return response


@app.get("/health")
async def health():
    try:
        async with SessionLocal() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ok"}
    except Exception as e:  # noqa: BLE001
        log.warning("Health check failed: %s", e)
        return JSONResponse({"error": "unavailable", "message": "database is unavailable"}, status_code=503)
