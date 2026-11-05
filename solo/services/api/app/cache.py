import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

T = TypeVar("T")


class TTLCache:
    """Small in-process cache. Redis is intentionally replaceable later."""

    def __init__(self) -> None:
        self._values: dict[str, tuple[float, Any]] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    def get(self, key: str) -> Any | None:
        hit = self._values.get(key)
        if not hit:
            return None
        expiry, value = hit
        if expiry <= time.time():
            self._values.pop(key, None)
            return None
        return value

    def set(self, key: str, value: Any, ttl_seconds: float) -> Any:
        self._values[key] = (time.time() + max(0.1, ttl_seconds), value)
        return value

    def clear(self, prefix: str = "") -> None:
        for key in list(self._values):
            if key.startswith(prefix):
                self._values.pop(key, None)

    async def get_or_set(
        self, key: str, ttl_seconds: float, factory: Callable[[], Awaitable[T]]
    ) -> T:
        cached = self.get(key)
        if cached is not None:
            return cached
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            cached = self.get(key)
            if cached is not None:
                return cached
            value = await factory()
            return self.set(key, value, ttl_seconds)


cache = TTLCache()
