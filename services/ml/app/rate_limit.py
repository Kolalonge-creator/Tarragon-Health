"""In-process rate limiting for the batch prediction endpoint.

Sliding-window limiter keyed by the caller's `X-Service-Key`. This is
intentionally in-memory rather than backed by Upstash Redis: the ML service
is stateless with no external stores (CLAUDE.md), and per-process limiting
is enough to blunt an accidental hot loop from a single caller. It is NOT a
multi-instance-safe limiter — if the service scales to more than one
Railway/Render replica, each replica enforces its own window, so the
effective ceiling becomes `limit * replica_count`. That's an accepted
trade-off for a service-to-service guard rail, not a security boundary.
"""

import time
from collections import defaultdict

from fastapi import Header, HTTPException, status

BATCH_RATE_LIMIT_CALLS = 2
BATCH_RATE_LIMIT_WINDOW_SECONDS = 60.0

_call_log: dict[str, list[float]] = defaultdict(list)


def reset_rate_limit_state() -> None:
    """Clear all tracked call history. Test-only — production has no need
    to reset a sliding window mid-process."""
    _call_log.clear()


def _prune(timestamps: list[float], now: float) -> list[float]:
    cutoff = now - BATCH_RATE_LIMIT_WINDOW_SECONDS
    return [t for t in timestamps if t > cutoff]


async def require_batch_rate_limit(
    x_service_key: str | None = Header(default=None, alias="X-Service-Key"),
) -> None:
    """Reject a batch call once a caller exceeds `BATCH_RATE_LIMIT_CALLS`
    per `BATCH_RATE_LIMIT_WINDOW_SECONDS`.

    Listed after `require_service_key` in the router's dependencies, so by
    the time this runs the key is already known-valid; it's read again here
    (not passed through) because FastAPI dependencies don't share state with
    each other.
    """
    key = x_service_key or ""
    now = time.monotonic()
    timestamps = _prune(_call_log[key], now)
    if len(timestamps) >= BATCH_RATE_LIMIT_CALLS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Batch rate limit exceeded: max {BATCH_RATE_LIMIT_CALLS} calls per "
            f"{int(BATCH_RATE_LIMIT_WINDOW_SECONDS)}s per key.",
        )
    timestamps.append(now)
    _call_log[key] = timestamps
