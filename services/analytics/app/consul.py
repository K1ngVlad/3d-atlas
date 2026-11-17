"""Consul registration (contracts.md): retries on start, re-register every 30 s, deregister on shutdown."""

import asyncio
import logging
import os
import socket

import httpx

log = logging.getLogger("consul")

NAME = "analytics"
PORT = 8080
RETRY_S = 3
REREGISTER_S = 30

CONSUL = os.environ.get("CONSUL_HTTP_ADDR", "http://consul:8500").rstrip("/")
SERVICE_ID = f"{NAME}-{socket.gethostname()}"


def container_ip() -> str:
    return socket.gethostbyname(socket.gethostname())


async def register(client: httpx.AsyncClient) -> None:
    ip = container_ip()
    res = await client.put(
        f"{CONSUL}/v1/agent/service/register",
        json={
            "Name": NAME,
            "ID": SERVICE_ID,
            "Address": ip,
            "Port": PORT,
            "Check": {
                "HTTP": f"http://{ip}:{PORT}/health",
                "Interval": "5s",
                "Timeout": "2s",
                "DeregisterCriticalServiceAfter": "1m",
            },
        },
    )
    res.raise_for_status()


async def registration_loop() -> None:
    registered = False
    async with httpx.AsyncClient(timeout=5) as client:
        while True:
            delay = REREGISTER_S
            try:
                await register(client)
                if not registered:
                    log.info("Registered %s in Consul", SERVICE_ID)
                registered = True
            except Exception as e:  # noqa: BLE001 - keep retrying whatever happens
                log.warning("Consul registration failed (%s); retrying", e)
                delay = RETRY_S
            await asyncio.sleep(delay)


async def deregister() -> None:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            res = await client.put(f"{CONSUL}/v1/agent/service/deregister/{SERVICE_ID}")
            log.info("Deregistered %s from Consul: %s", SERVICE_ID, res.status_code)
    except Exception as e:  # noqa: BLE001
        log.warning("Consul deregistration failed: %s", e)
