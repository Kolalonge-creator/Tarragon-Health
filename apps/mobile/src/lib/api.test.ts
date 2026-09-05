/**
 * api.ts's request() is the single choke point every mobile write goes
 * through, and its retry policy carries a real safety rule: a request that
 * NEVER reached the server may be retried, one that reached it and came back
 * an error may not — that one may already have taken effect. It also
 * produces the exact NETWORK_ERROR_MESSAGE string offline-vitals-queue.ts
 * compares against to decide "stop draining, the device is offline", so a
 * copy edit to that wording silently breaks retry classification.
 */
import {
  API_BASE_URL,
  NETWORK_ERROR_MESSAGE,
  fetchVitalsThresholds,
  postDeviceReading,
  postVitalReading,
} from "./api";
import { supabase } from "./supabase";

jest.mock("./supabase", () => ({
  supabase: { auth: { getSession: jest.fn() } },
}));

const getSession = supabase.auth.getSession as jest.MockedFunction<typeof supabase.auth.getSession>;
const mockFetch = jest.fn();

function signedIn(token = "jwt-abc"): void {
  getSession.mockResolvedValue({
    data: { session: { access_token: token } },
    error: null,
  } as unknown as Awaited<ReturnType<typeof supabase.auth.getSession>>);
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockReset();
  signedIn();
});

describe("authentication", () => {
  it("refuses to send anything when there is no session, rather than calling unauthenticated", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null } as unknown as Awaited<
      ReturnType<typeof supabase.auth.getSession>
    >);

    await expect(postDeviceReading({ systolic: 120 })).resolves.toEqual({
      success: false,
      error: "Not signed in",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends the session's own JWT as a bearer token to the platform host", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, {}));
    await postDeviceReading({ systolic: 120 });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/api/mobile/device-readings`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer jwt-abc",
      "Content-Type": "application/json",
    });
  });
});

describe("error handling", () => {
  it("surfaces the server's own error message so a patient sees why", async () => {
    mockFetch.mockResolvedValue(jsonResponse(400, { error: "Systolic must be at least 60 mmHg" }));
    await expect(postDeviceReading({ systolic: 1 })).resolves.toEqual({
      success: false,
      error: "Systolic must be at least 60 mmHg",
    });
  });

  it("falls back to the status code when the server sends no error field", async () => {
    mockFetch.mockResolvedValue(jsonResponse(503, {}));
    await expect(postDeviceReading({ systolic: 120 })).resolves.toEqual({
      success: false,
      error: "Request failed (503)",
    });
  });

  it("treats an unparseable body as a network failure, not a success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token <");
      },
    } as unknown as Response);

    await expect(postDeviceReading({ systolic: 120 })).resolves.toEqual({
      success: false,
      error: NETWORK_ERROR_MESSAGE,
    });
  });
});

describe("retry policy", () => {
  it("retries exactly once when the request never reached the server", async () => {
    jest.useFakeTimers();
    try {
      mockFetch.mockRejectedValue(new Error("Network request failed"));
      const promise = postDeviceReading({ systolic: 120 });
      await jest.advanceTimersByTimeAsync(1_500);
      await expect(promise).resolves.toEqual({ success: false, error: NETWORK_ERROR_MESSAGE });
    } finally {
      jest.useRealTimers();
    }
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("succeeds on the retry when the first attempt was just a flaky beat", async () => {
    jest.useFakeTimers();
    try {
      mockFetch.mockRejectedValueOnce(new Error("Network request failed")).mockResolvedValue(jsonResponse(200, {}));
      const promise = postDeviceReading({ systolic: 120 });
      await jest.advanceTimersByTimeAsync(1_500);
      await expect(promise).resolves.toEqual({ success: true });
    } finally {
      jest.useRealTimers();
    }
  });

  it("never retries a request the server answered — it may already have taken effect", async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, { error: "boom" }));
    await postDeviceReading({ systolic: 120 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("postVitalReading body shape", () => {
  it("omits the acting-for and idempotency fields when they are not set", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, {}));
    await postVitalReading({ vital_type: "weight", weight_kg: 70 });

    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ vital_type: "weight", weight_kg: 70 });
  });

  it("carries the beneficiary and the client_reading_id when they are", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, {}));
    await postVitalReading(
      { vital_type: "blood_pressure", systolic: 150, diastolic: 95 },
      "beneficiary-1",
      "client-reading-1"
    );

    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      vital_type: "blood_pressure",
      systolic: 150,
      diastolic: 95,
      beneficiary_profile_id: "beneficiary-1",
      client_reading_id: "client-reading-1",
    });
  });
});

describe("fetchVitalsThresholds", () => {
  it("returns the served thresholds", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { version: "v9", glucose: {}, bp: {} }));
    await expect(fetchVitalsThresholds()).resolves.toEqual({ version: "v9", glucose: {}, bp: {} });
  });

  it("returns null rather than throwing on any failure, so the caller keeps its bundled defaults", async () => {
    mockFetch.mockResolvedValue(jsonResponse(401, { error: "Invalid or expired session" }));
    await expect(fetchVitalsThresholds()).resolves.toBeNull();
  });
});
