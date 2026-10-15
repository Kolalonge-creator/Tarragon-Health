/**
 * The cloud wearable adapters behind the DeviceSource interface (S70a). The wrapper is a refactor: these prove it does what the code it
 * wraps did, and that pullConnection, which now calls it, keeps its quiet returns and its exception.
 */
jest.mock("server-only", () => ({}));
const getValidAccessToken = jest.fn();
jest.mock("./connection-tokens", () => ({
  getValidAccessToken: (...a: unknown[]) => getValidAccessToken(...a),
  consentFromConnection: () => ({ activity: true, heart_rate: true, sleep: true, weight: true }),
  WEARABLE_CREDENTIAL_COLUMNS: "*",
}));
const fetchSince = jest.fn();
const readInline = jest.fn();
jest.mock("./providers", () => ({
  PROVIDER_ADAPTERS: {
    dexcom: { fetchSince: (...a: unknown[]) => fetchSince(...a) },
    garmin: { readInline: (...a: unknown[]) => readInline(...a) },
    oura: {},
    whoop: {},
    fitbit: {},
  },
}));
const ingestReadings = jest.fn();
jest.mock("./ingest", () => {
  class WearableIngestError extends Error {}
  return { ingestReadings: (...a: unknown[]) => ingestReadings(...a), WearableIngestError };
});

import { buildWearableSourceRegistry, cloudDeviceSource } from "./device-sources";
import { pullConnection } from "./sync";

const rpc = jest.fn();
const updateEq = jest.fn();
const svc = {
  rpc: (...a: unknown[]) => rpc(...a),
  from: () => ({ update: () => ({ eq: (...a: unknown[]) => updateEq(...a) }) }),
} as never;
const connection = { id: "c1", provider: "dexcom", patient_id: "p1", organisation_id: "o1" } as never;
const window = { since: new Date("2026-10-01T00:00:00Z"), until: new Date("2026-10-02T00:00:00Z") };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DEXCOM_CLIENT_ID;
  delete process.env.DEXCOM_CLIENT_SECRET;
});

describe("cloud wearable DeviceSource", () => {
  it("registers the five existing providers, each a vendor cloud, none behind a new switch (the Connect card is live)", () => {
    const registry = buildWearableSourceRegistry(svc);
    expect(registry.list().map((s) => s.id).sort()).toEqual(["dexcom", "fitbit", "garmin", "oura", "whoop"]);
    for (const s of registry.list()) {
      expect(s.kind).toBe("vendor_cloud");
      expect(s.goLiveKey).toBeNull();
    }
  });

  it("connect: not configured while there are no developer credentials, a redirect once there are", async () => {
    const source = cloudDeviceSource("dexcom", svc);
    expect(await source.connect({ patientId: "p", organisationId: "o", redirectUri: "https://x/cb", state: "s" })).toMatchObject({ ok: false, reason: "not_configured" });
    process.env.DEXCOM_CLIENT_ID = "id";
    process.env.DEXCOM_CLIENT_SECRET = "secret";
    const res = await source.connect({ patientId: "p", organisationId: "o", redirectUri: "https://x/cb", state: "s" });
    expect(res).toMatchObject({ ok: true, kind: "redirect" });
    expect(res.ok && res.kind === "redirect" && res.url).toContain("state=s");
  });

  it("sync: a push-only provider is not pullable, a missing token is quiet, a provider failure keeps its original exception", async () => {
    expect(await cloudDeviceSource("garmin", svc).sync(connection, window)).toMatchObject({ ok: false, code: "not_pullable" });
    getValidAccessToken.mockResolvedValueOnce({ ok: false, error: "expired" });
    expect(await cloudDeviceSource("dexcom", svc).sync(connection, window)).toMatchObject({ ok: false, code: "no_token" });
    const boom = new Error("provider down");
    getValidAccessToken.mockResolvedValueOnce({ ok: true, accessToken: "t" });
    fetchSince.mockRejectedValueOnce(boom);
    const res = await cloudDeviceSource("dexcom", svc).sync(connection, window);
    expect(res).toMatchObject({ ok: false, code: "provider_error", retryable: true });
    expect(!res.ok && res.cause).toBe(boom);
  });

  it("sync: hands back the adapter's readings in the shared shape", async () => {
    getValidAccessToken.mockResolvedValueOnce({ ok: true, accessToken: "t" });
    fetchSince.mockResolvedValueOnce([{ readingType: "glucose", value: 6.1, unit: "mmol/L", recordedAt: "2026-10-01T10:00:00Z", externalReadingId: "g-1" }]);
    const res = await cloudDeviceSource("dexcom", svc).sync(connection, window);
    expect(res).toEqual({ ok: true, readings: [{ readingType: "glucose", value: 6.1, unit: "mmol/L", recordedAt: "2026-10-01T10:00:00Z", externalReadingId: "g-1" }] });
    expect(fetchSince).toHaveBeenCalledWith("t", window.since, window.until);
  });

  it("normalise: reads inline pushes, and never throws on a shape it does not know", () => {
    readInline.mockReturnValueOnce([{ externalId: "a", readings: [{ readingType: "steps", value: 100, unit: "count", recordedAt: "2026-10-01T10:00:00Z", externalReadingId: "s-1" }] }]);
    expect(cloudDeviceSource("garmin", svc).normalise({})).toHaveLength(1);
    readInline.mockImplementationOnce(() => {
      throw new Error("bad body");
    });
    expect(cloudDeviceSource("garmin", svc).normalise("junk")).toEqual([]);
    expect(cloudDeviceSource("oura", svc).normalise({})).toEqual([]);
  });

  it("revoke: runs the existing revoke function and reports its error", async () => {
    rpc.mockResolvedValueOnce({ error: null });
    expect(await cloudDeviceSource("oura", svc).revoke(connection)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("revoke_wearable_connection", { p_connection_id: "c1" });
    rpc.mockResolvedValueOnce({ error: { message: "nope" } });
    expect(await cloudDeviceSource("oura", svc).revoke(connection)).toEqual({ ok: false, error: "nope" });
  });
});

describe("pullConnection through the wrapper keeps its behaviour", () => {
  beforeEach(() => {
    ingestReadings.mockResolvedValue({ vitalsInserted: 1, wearableInserted: 0, implausible: 0, deniedByConsent: 0, consentDeniedSafetyRetained: 0, failed: 0, safetyAssessmentFailed: false });
  });

  it("returns an empty outcome, quietly, for a provider that is not pulled", async () => {
    const out = await pullConnection(svc, { ...(connection as object), provider: "garmin" } as never, null);
    expect(out.connectionsTouched).toBe(0);
    expect(fetchSince).not.toHaveBeenCalled();
  });

  it("returns an empty outcome, quietly, when there is no usable token", async () => {
    getValidAccessToken.mockResolvedValueOnce({ ok: false, error: "expired" });
    expect((await pullConnection(svc, connection, null)).connectionsTouched).toBe(0);
    expect(ingestReadings).not.toHaveBeenCalled();
  });

  it("rethrows a provider failure unchanged, exactly as before", async () => {
    const boom = new Error("provider down");
    getValidAccessToken.mockResolvedValueOnce({ ok: true, accessToken: "t" });
    fetchSince.mockRejectedValueOnce(boom);
    await expect(pullConnection(svc, connection, null)).rejects.toBe(boom);
  });

  it("ingests what the provider returned and re-covers an hour of overlap", async () => {
    getValidAccessToken.mockResolvedValueOnce({ ok: true, accessToken: "t" });
    fetchSince.mockResolvedValueOnce([{ readingType: "glucose", value: 6, unit: "mmol/L", recordedAt: "2026-10-01T10:00:00Z", externalReadingId: "g" }]);
    const cursor = "2026-10-01T12:00:00.000Z";
    const out = await pullConnection(svc, connection, cursor);
    expect(out.connectionsTouched).toBe(1);
    expect(out.vitalsInserted).toBe(1);
    const since = fetchSince.mock.calls[0]?.[1] as Date;
    expect(since.toISOString()).toBe("2026-10-01T11:00:00.000Z");
  });
});
