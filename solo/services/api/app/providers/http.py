import asyncio
import time
from typing import Any

import httpx

from ..config import get_settings
from .health import record_error, record_success

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
BASE_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/plain, application/xml, text/xml, */*",
    "Accept-Language": "en-US,en;q=0.9",
}


class ProviderError(RuntimeError):
    pass


async def fetch_text(
    provider: str,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float | None = None,
    retries: int = 1,
) -> str:
    settings = get_settings()
    timeout_value = timeout or settings.http_timeout_seconds
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(
                timeout=timeout_value, follow_redirects=True, headers={**BASE_HEADERS, **(headers or {})}
            ) as client:
                response = await client.get(url, params=params)
                response.raise_for_status()
                text = response.text
            record_success(provider, int((time.perf_counter() - started) * 1000))
            return text
        except Exception as exc:  # pragma: no cover - exact transport errors vary
            last_error = exc
            if attempt < retries:
                await asyncio.sleep(0.4 + attempt * 0.6)
    latency = int((time.perf_counter() - started) * 1000)
    message = str(last_error) or last_error.__class__.__name__
    record_error(provider, message, latency)
    raise ProviderError(message) from last_error


async def fetch_json(
    provider: str,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float | None = None,
    retries: int = 1,
) -> Any:
    text = await fetch_text(
        provider, url, params=params, headers=headers, timeout=timeout, retries=retries
    )
    try:
        import json

        return json.loads(text)
    except ValueError as exc:
        record_error(provider, "Invalid JSON response")
        raise ProviderError("Invalid JSON response") from exc


async def post_json(
    provider: str,
    url: str,
    *,
    payload: dict[str, Any],
    headers: dict[str, str] | None = None,
    timeout: float | None = None,
) -> Any:
    settings = get_settings()
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(
            timeout=timeout or settings.http_timeout_seconds,
            follow_redirects=True,
            headers={**BASE_HEADERS, **(headers or {})},
        ) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            value = response.json()
        record_success(provider, int((time.perf_counter() - started) * 1000))
        return value
    except Exception as exc:  # pragma: no cover - exact transport errors vary
        record_error(provider, str(exc), int((time.perf_counter() - started) * 1000))
        raise ProviderError(str(exc)) from exc
