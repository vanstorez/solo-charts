from dataclasses import asdict, dataclass
from datetime import datetime
from threading import Lock

from ..timeutil import iso, utc_now


@dataclass
class ProviderState:
    name: str
    status: str = "unknown"
    last_success_at: datetime | None = None
    last_error_at: datetime | None = None
    last_error: str | None = None
    latency_ms: int | None = None
    successes: int = 0
    failures: int = 0


_registry: dict[str, ProviderState] = {}
_lock = Lock()


def _state(name: str) -> ProviderState:
    return _registry.setdefault(name, ProviderState(name=name))


def record_success(name: str, latency_ms: int) -> None:
    with _lock:
        state = _state(name)
        state.status = "ok"
        state.last_success_at = utc_now()
        state.latency_ms = latency_ms
        state.successes += 1


def record_error(name: str, error: str, latency_ms: int | None = None) -> None:
    with _lock:
        state = _state(name)
        state.status = "error"
        state.last_error_at = utc_now()
        state.last_error = error[:300]
        state.latency_ms = latency_ms
        state.failures += 1


def snapshot() -> list[dict]:
    with _lock:
        rows = []
        for state in _registry.values():
            item = asdict(state)
            item["last_success_at"] = iso(state.last_success_at)
            item["last_error_at"] = iso(state.last_error_at)
            rows.append(item)
    return sorted(rows, key=lambda row: row["name"])
