import pytest
from fastapi import HTTPException

from app.rate_limit import BATCH_RATE_LIMIT_CALLS, require_batch_rate_limit

# Rate-limit state is reset by the autouse `_clean_rate_limit_state` fixture
# in conftest.py.


async def test_allows_up_to_the_limit() -> None:
    for _ in range(BATCH_RATE_LIMIT_CALLS):
        await require_batch_rate_limit(x_service_key="key-a")


async def test_rejects_once_over_the_limit() -> None:
    for _ in range(BATCH_RATE_LIMIT_CALLS):
        await require_batch_rate_limit(x_service_key="key-a")
    with pytest.raises(HTTPException) as exc_info:
        await require_batch_rate_limit(x_service_key="key-a")
    assert exc_info.value.status_code == 429


async def test_keys_are_tracked_independently() -> None:
    for _ in range(BATCH_RATE_LIMIT_CALLS):
        await require_batch_rate_limit(x_service_key="key-a")
    # A different key has its own budget, unaffected by key-a's usage.
    await require_batch_rate_limit(x_service_key="key-b")
