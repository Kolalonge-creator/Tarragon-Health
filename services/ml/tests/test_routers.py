"""Integration tests for the Sprint 4 week-7 endpoints — auth wiring and
request/response shape through real HTTP, on top of the unit-tested maths in
test_score2.py / test_hba1c.py / test_bp_control.py."""

from httpx import AsyncClient

from tests.conftest import TEST_SERVICE_KEY

AUTH = {"X-Service-Key": TEST_SERVICE_KEY}


async def test_cvd_risk_requires_service_key(client: AsyncClient) -> None:
    resp = await client.post(
        "/risk/cvd",
        json={
            "age": 55,
            "sex": "male",
            "is_smoker": False,
            "systolic_bp": 130,
            "total_cholesterol_mg_dl": 190,
            "hdl_cholesterol_mg_dl": 50,
        },
    )
    assert resp.status_code == 401


async def test_cvd_risk_happy_path(client: AsyncClient) -> None:
    resp = await client.post(
        "/risk/cvd",
        headers=AUTH,
        json={
            "age": 55,
            "sex": "male",
            "is_smoker": False,
            "systolic_bp": 130,
            "total_cholesterol_mg_dl": 190,
            "hdl_cholesterol_mg_dl": 50,
            "risk_region": "moderate",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["cvd_risk_10yr_percent"] == 4.6
    assert body["risk_level"] == "low"
    assert body["model"] == "SCORE2"


async def test_cvd_risk_rejects_age_below_40(client: AsyncClient) -> None:
    resp = await client.post(
        "/risk/cvd",
        headers=AUTH,
        json={
            "age": 39,
            "sex": "male",
            "is_smoker": False,
            "systolic_bp": 130,
            "total_cholesterol_mg_dl": 190,
            "hdl_cholesterol_mg_dl": 50,
        },
    )
    assert resp.status_code == 422


async def test_hba1c_trajectory_happy_path(client: AsyncClient) -> None:
    resp = await client.post(
        "/trajectory/hba1c",
        headers=AUTH,
        json={
            "readings": [
                {"on": "2025-01-01", "value_percent": 6.5},
                {"on": "2025-04-01", "value_percent": 7.2},
                {"on": "2025-07-01", "value_percent": 7.9},
            ]
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["trend"] == "worsening"
    assert body["latest_value_percent"] == 7.9
    assert body["estimated_average_glucose_mg_dl"] == 180.0


async def test_hba1c_trajectory_requires_service_key(client: AsyncClient) -> None:
    resp = await client.post(
        "/trajectory/hba1c", json={"readings": [{"on": "2025-01-01", "value_percent": 6.5}]}
    )
    assert resp.status_code == 401


async def test_bp_control_happy_path(client: AsyncClient) -> None:
    resp = await client.post(
        "/assess/bp-control",
        headers=AUTH,
        json={
            "readings": [
                {"taken_at": "2026-06-01T08:00:00+01:00", "systolic": 135, "diastolic": 85},
                {"taken_at": "2026-06-02T08:00:00+01:00", "systolic": 150, "diastolic": 95},
            ]
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["readings_in_window"] == 2
    assert body["control_rate_percent"] == 50.0


async def test_bp_control_requires_service_key(client: AsyncClient) -> None:
    resp = await client.post(
        "/assess/bp-control",
        json={
            "readings": [
                {"taken_at": "2026-06-01T08:00:00+01:00", "systolic": 135, "diastolic": 85}
            ]
        },
    )
    assert resp.status_code == 401


async def test_bp_control_rejects_naive_datetime(client: AsyncClient) -> None:
    resp = await client.post(
        "/assess/bp-control",
        headers=AUTH,
        json={"readings": [{"taken_at": "2026-06-01T08:00:00", "systolic": 135, "diastolic": 85}]},
    )
    assert resp.status_code == 422
