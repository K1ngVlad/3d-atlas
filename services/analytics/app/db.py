import asyncio
import logging
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from .models import metadata

log = logging.getLogger("db")

RETRY_S = 3

engine = create_async_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

# Several replicas may start at once (`--scale analytics=2`): CREATE TABLE races on the catalog,
# so schema creation runs under a transaction-scoped advisory lock (arbitrary constant key).
SCHEMA_LOCK_KEY = 7_311_002


async def create_schema() -> None:
    async with engine.begin() as conn:
        await conn.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": SCHEMA_LOCK_KEY})
        await conn.run_sync(metadata.create_all)


async def create_schema_with_retries(ready: asyncio.Event) -> None:
    """Runs in lifespan as a background task: the service starts even if the DB is not up yet."""
    while True:
        try:
            await create_schema()
            log.info("Database schema is ready")
            ready.set()
            return
        except Exception as e:  # noqa: BLE001 - keep retrying whatever happens
            log.warning("Schema creation failed (%s); retrying in %ss", e, RETRY_S)
            await asyncio.sleep(RETRY_S)


async def ping() -> None:
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
