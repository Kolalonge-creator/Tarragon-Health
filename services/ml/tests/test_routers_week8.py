"""Integration tests for the Sprint 4 week-8 endpoints — auth wiring,
request/response shape, and rate limiting through real HTTP, on top of the
unit-tested logic in test_lab_reference.py / test_screening_interpretation.py
/ test_cohort_analytics.py / test_rate_limit.py."""

from httpx import AsyncClient

from app.rate_limit import BATCH_RATE_LIMIT_CALLS
from tests.conftest import TEST_SERVICE_KEY

AUTH = {"X-Service-Key": TEST_SERVICE_KEY}


async def test_interpret_labs_requires_service_key(client: AsyncClient) -> None:
    resp = await client.post(
        "/interpret/labs",
        json={
            "screen_type_code": "hba1c",
            "sex": "male",
            "age": 45,
            "analytes": [{"code": "hba1c", "value": 8.1}],
        },
    )
    assert resp.status_code == 401


async def test_interpret_labs_abnormal_hba1c(client: AsyncClient) -> None:
    resp = await client.post(
        "/interpret/labs",
        headers=AUTH,
        json={
            "screen_type_code": "hba1c",
            "sex": "male",
            "age": 45,
            "analytes": [{"code": "hba1c", "value": 8.1}],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["result_status"] == "abnormal"
    assert body["abnormal_flags"] == ["hba1c"]


async def test_interpret_labs_hba1c_in_mmol_mol(client: AsyncClient) -> None:
    resp = await client.post(
        "/interpret/labs",
        headers=AUTH,
        json={
            "screen_type_code": "hba1c",
            "sex": "female",
            "age": 45,
            "analytes": [{"code": "hba1c", "value": 65, "hba1c_unit": "mmol_mol"}],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["result_status"] == "abnormal"
    analyte = body["analyte_results"][0]
    assert analyte["value_mmol_mol"] == 65
    assert analyte["value_percent"] == 8.1


async def test_interpret_labs_rejects_hba1c_unit_on_other_analytes(client: AsyncClient) -> None:
    resp = await client.post(
        "/interpret/labs",
        headers=AUTH,
        json={
            "screen_type_code": "lipid_panel",
            "sex": "male",
            "age": 45,
            "analytes": [{"code": "total_cholesterol", "value": 180, "hba1c_unit": "mmol_mol"}],
        },
    )
    assert resp.status_code == 422


async def test_interpret_labs_qualitative_positive(client: AsyncClient) -> None:
    resp = await client.post(
        "/interpret/labs",
        headers=AUTH,
        json={
            "screen_type_code": "hiv",
            "sex": "female",
            "age": 30,
            "qualitative_result": "positive",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["result_status"] == "abnormal"


async def test_interpret_labs_rejects_no_input(client: AsyncClient) -> None:
    resp = await client.post(
        "/interpret/labs",
        headers=AUTH,
        json={"screen_type_code": "hba1c", "sex": "male", "age": 45},
    )
    assert resp.status_code == 422


async def test_cohort_analytics_requires_service_key(client: AsyncClient) -> None:
    resp = await client.post("/analytics/cohort", json={"members": [{"age": 40, "sex": "male"}]})
    assert resp.status_code == 401


async def test_cohort_analytics_happy_path(client: AsyncClient) -> None:
    resp = await client.post(
        "/analytics/cohort",
        headers=AUTH,
        json={
            "members": [
                {"age": 40, "sex": "male", "chronic_conditions": ["hypertension"]},
                {"age": 60, "sex": "female", "cvd_risk_level": "high"},
            ]
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["cohort_size"] == 2
    assert body["chronic_condition_prevalence_percent"]["hypertension"] == 50.0


async def test_batch_predict_requires_service_key(client: AsyncClient) -> None:
    resp = await client.post("/batch/predict", json={"items": []})
    assert resp.status_code == 401


async def test_batch_predict_mixed_items(client: AsyncClient) -> None:
    resp = await client.post(
        "/batch/predict",
        headers=AUTH,
        json={
            "items": [
                {
                    "type": "cvd",
                    "request_id": "r1",
                    "payload": {
                        "age": 55,
                        "sex": "male",
                        "is_smoker": False,
                        "systolic_bp": 130,
                        "total_cholesterol_mg_dl": 190,
                        "hdl_cholesterol_mg_dl": 50,
                    },
                },
                {
                    "type": "hba1c",
                    "request_id": "r2",
                    "payload": {"readings": [{"on": "2026-01-01", "value_percent": 6.0}]},
                },
            ]
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["results"]) == 2
    assert body["results"][0]["ok"] is True
    assert body["results"][0]["request_id"] == "r1"
    assert body["results"][1]["result"]["trend"] == "insufficient_data"


async def test_batch_predict_rate_limited_after_threshold(client: AsyncClient) -> None:
    item = {
        "items": [
            {
                "type": "cvd",
                "request_id": "r",
                "payload": {
                    "age": 55,
                    "sex": "male",
                    "is_smoker": False,
                    "systolic_bp": 130,
                    "total_cholesterol_mg_dl": 190,
                    "hdl_cholesterol_mg_dl": 50,
                },
            }
        ]
    }
    for _ in range(BATCH_RATE_LIMIT_CALLS):
        resp = await client.post("/batch/predict", headers=AUTH, json=item)
        assert resp.status_code == 200
    resp = await client.post("/batch/predict", headers=AUTH, json=item)
    assert resp.status_code == 429
