import { jest } from "@jest/globals";

import {
  createMlClient,
  createMlClientFromEnv,
  ML_DEFAULT_TIMEOUT_MS,
  type BpControlResponse,
  type CohortAnalyticsResponse,
  type HbA1cTrajectoryResponse,
  type LabInterpretationResponse,
  type BatchPredictionResponse,
  type MlHealth,
  type Score2Response,
} from "./ml-client";

const CONFIG = { baseUrl: "http://ml.test", serviceKey: "secret" };

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("createMlClient", () => {
  const health: MlHealth = {
    status: "ok",
    service: "tarragon-ml",
    version: "0.1.0",
    environment: "test",
  };

  it("returns parsed JSON and sends the X-Service-Key header on success", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(health));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    const result = await client.health();

    expect(result).toEqual(health);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://ml.test/health");
    expect((init?.headers as Record<string, string>)["X-Service-Key"]).toBe(
      "secret",
    );
  });

  it("serialises the body and sets Content-Type for POST", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ risk: 0.12 }));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    const result = await client.post<{ risk: number }>("/risk/cvd", {
      age: 55,
    });

    expect(result).toEqual({ risk: 0.12 });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init?.body).toBe(JSON.stringify({ age: 55 }));
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  it("returns null on a non-2xx response", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("nope", { status: 500 }));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    expect(await client.health()).toBeNull();
  });

  it("returns null when fetch rejects (network error)", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    expect(await client.health()).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("<html>not json</html>", { status: 200 }));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    expect(await client.health()).toBeNull();
  });

  it("aborts and returns null when the request exceeds the timeout", async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = jest.fn<typeof fetch>().mockImplementation(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = (init as RequestInit).signal;
            signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      );
      const client = createMlClient({ ...CONFIG, fetchImpl, timeoutMs: 50 });

      const pending = client.health();
      jest.advanceTimersByTime(51);
      expect(await pending).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("typed endpoint helpers", () => {
  it("cvdRisk posts to /risk/cvd and returns the parsed response", async () => {
    const response: Score2Response = {
      cvd_risk_10yr_percent: 8.2,
      risk_level: "moderate",
      model: "SCORE2",
      risk_region: "very_high",
    };
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(response));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    const result = await client.cvdRisk({
      age: 55,
      sex: "male",
      is_smoker: false,
      systolic_bp: 130,
      total_cholesterol_mg_dl: 190,
      hdl_cholesterol_mg_dl: 50,
    });

    expect(result).toEqual(response);
    expect(fetchImpl.mock.calls[0][0]).toBe("http://ml.test/risk/cvd");
  });

  it("cvdRisk returns null on a non-2xx response", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(new Response("nope", { status: 422 }));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    const result = await client.cvdRisk({
      age: 55,
      sex: "male",
      is_smoker: false,
      systolic_bp: 130,
      total_cholesterol_mg_dl: 190,
      hdl_cholesterol_mg_dl: 50,
    });

    expect(result).toBeNull();
  });

  it("hba1cTrajectory posts to /trajectory/hba1c and returns the parsed response", async () => {
    const response: HbA1cTrajectoryResponse = {
      latest_value_percent: 7.1,
      estimated_average_glucose_mg_dl: 157.3,
      estimated_average_glucose_mmol_l: 8.7,
      trend: "stable",
      slope_percent_per_90_days: 0.02,
      r_squared: 0.4,
      projected_value_percent: 7.1,
      projected_value_ci90_low: 6.8,
      projected_value_ci90_high: 7.4,
    };
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(response));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    const result = await client.hba1cTrajectory({
      readings: [{ on: "2026-01-01", value_percent: 7.1 }],
    });

    expect(result).toEqual(response);
    expect(fetchImpl.mock.calls[0][0]).toBe("http://ml.test/trajectory/hba1c");
  });

  it("hba1cTrajectory returns null on network error", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    const result = await client.hba1cTrajectory({
      readings: [{ on: "2026-01-01", value_percent: 7.1 }],
    });

    expect(result).toBeNull();
  });

  it("bpControl posts to /assess/bp-control and returns the parsed response", async () => {
    const response: BpControlResponse = {
      window_start: "2026-01-01T00:00:00Z",
      window_end: "2026-01-31T00:00:00Z",
      readings_in_window: 4,
      control_rate_percent: 75,
      systolic_mean: 132,
      systolic_sd: 6.1,
      systolic_cv_percent: 4.6,
      morning_readings: 2,
      morning_systolic_mean: 130,
      morning_diastolic_mean: 82,
      morning_surge_flag: false,
    };
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(response));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    const result = await client.bpControl({
      readings: [{ taken_at: "2026-01-15T08:00:00Z", systolic: 130, diastolic: 82 }],
    });

    expect(result).toEqual(response);
    expect(fetchImpl.mock.calls[0][0]).toBe("http://ml.test/assess/bp-control");
  });

  it("bpControl returns null on malformed JSON", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("<html>not json</html>", { status: 200 }));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    const result = await client.bpControl({
      readings: [{ taken_at: "2026-01-15T08:00:00Z", systolic: 130, diastolic: 82 }],
    });

    expect(result).toBeNull();
  });

  it("interpretLabs posts to /interpret/labs and returns the parsed response", async () => {
    const response: LabInterpretationResponse = {
      result_status: "abnormal",
      abnormal_flags: ["hba1c"],
      analyte_results: [
        {
          code: "hba1c",
          value: 8.1,
          status: "abnormal",
          reference_range: "<5.7% (<39 mmol/mol) (normal)",
          flag: "hba1c",
          value_percent: 8.1,
          value_mmol_mol: 65,
        },
      ],
      summary: "hba1c 8.1% (65 mmol/mol) (abnormal).",
    };
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(response));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    const result = await client.interpretLabs({
      screen_type_code: "hba1c",
      sex: "female",
      age: 50,
      analytes: [{ code: "hba1c", value: 8.1 }],
    });

    expect(result).toEqual(response);
    expect(fetchImpl.mock.calls[0][0]).toBe("http://ml.test/interpret/labs");
  });

  it("interpretLabs returns null on a non-2xx response", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(new Response("nope", { status: 422 }));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    const result = await client.interpretLabs({
      screen_type_code: "hba1c",
      sex: "female",
      age: 50,
      analytes: [{ code: "hba1c", value: 8.1 }],
    });

    expect(result).toBeNull();
  });

  it("analyseCohort posts to /analytics/cohort and returns the parsed response", async () => {
    const response: CohortAnalyticsResponse = {
      cohort_size: 2,
      age_mean: 45,
      sex_distribution: { male: 1, female: 1 },
      chronic_condition_prevalence_percent: { hypertension: 50, diabetes: 0 },
      cvd_risk_level_distribution: { low: 1, moderate: 1, high: 0 },
      cvd_risk_mean_percent: 6.5,
      hba1c_trend_distribution: { improving: 0, stable: 2, worsening: 0, insufficient_data: 0 },
      bp_control_rate_mean_percent: 80,
      screening_overdue_rate_percent: 0,
      abnormal_findings_count: 0,
      top_abnormal_flags: [],
    };
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(response));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    const result = await client.analyseCohort({
      members: [
        { age: 40, sex: "male" },
        { age: 50, sex: "female" },
      ],
    });

    expect(result).toEqual(response);
    expect(fetchImpl.mock.calls[0][0]).toBe("http://ml.test/analytics/cohort");
  });

  it("analyseCohort returns null when fetch rejects", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    const result = await client.analyseCohort({ members: [{ age: 40, sex: "male" }] });

    expect(result).toBeNull();
  });

  it("batchPredict posts to /batch/predict and returns the parsed response", async () => {
    const response: BatchPredictionResponse = {
      results: [
        {
          request_id: "1",
          type: "cvd",
          ok: true,
          result: {
            cvd_risk_10yr_percent: 8.2,
            risk_level: "moderate",
            model: "SCORE2",
            risk_region: "very_high",
          },
          error: null,
        },
      ],
    };
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(response));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    const result = await client.batchPredict({
      items: [
        {
          type: "cvd",
          request_id: "1",
          payload: {
            age: 55,
            sex: "male",
            is_smoker: false,
            systolic_bp: 130,
            total_cholesterol_mg_dl: 190,
            hdl_cholesterol_mg_dl: 50,
          },
        },
      ],
    });

    expect(result).toEqual(response);
    expect(fetchImpl.mock.calls[0][0]).toBe("http://ml.test/batch/predict");
  });

  it("batchPredict returns null on a non-2xx response", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = createMlClient({ ...CONFIG, fetchImpl });

    const result = await client.batchPredict({
      items: [
        {
          type: "cvd",
          request_id: "1",
          payload: {
            age: 55,
            sex: "male",
            is_smoker: false,
            systolic_bp: 130,
            total_cholesterol_mg_dl: 190,
            hdl_cholesterol_mg_dl: 50,
          },
        },
      ],
    });

    expect(result).toBeNull();
  });
});

describe("createMlClientFromEnv", () => {
  it("returns null when env vars are missing", () => {
    expect(createMlClientFromEnv({})).toBeNull();
    expect(createMlClientFromEnv({ ML_SERVICE_URL: "http://x" })).toBeNull();
  });

  it("builds a client when both env vars are present", () => {
    const client = createMlClientFromEnv({
      ML_SERVICE_URL: "http://ml.test",
      ML_SERVICE_KEY: "secret",
    });
    expect(client).not.toBeNull();
  });

  it("exposes the documented default timeout", () => {
    expect(ML_DEFAULT_TIMEOUT_MS).toBe(5_000);
  });
});
