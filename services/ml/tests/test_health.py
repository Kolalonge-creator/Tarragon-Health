from httpx import AsyncClient


async def test_health_ok(client: AsyncClient) -> None:
    resp = await client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "tarragon-ml"
    assert body["environment"] == "test"
    assert body["version"]


async def test_health_needs_no_service_key(client: AsyncClient) -> None:
    # Liveness must work without the X-Service-Key header.
    resp = await client.get("/health")
    assert resp.status_code == 200
