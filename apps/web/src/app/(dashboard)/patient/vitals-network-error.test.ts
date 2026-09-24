/**
 * logVital() used to let a thrown exception (e.g. a dropped connection
 * mid-request) propagate straight out of this Server Action. Next.js then
 * routes an uncaught Server Action exception to the dashboard's error.tsx
 * boundary, which unmounts the whole route segment — including the vitals
 * form — and discards the reading the patient had just typed. This proves a
 * network-level failure now comes back as a normal, retryable { error }
 * result instead of a thrown exception (so the form stays mounted and the
 * typed reading survives), and that the failure is still reported to
 * Sentry rather than silently swallowed.
 */

jest.mock("@/lib/acting/acting-for", () => ({
  resolveSubjectId: jest.fn().mockResolvedValue("patient-1"),
  assertNotActingFor: jest.fn(),
}));

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const captureException = jest.fn();
jest.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

const getUser = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { getUser },
  }),
}));

import { logVital } from "./actions";

function bloodPressureFormData({
  systolic = "120",
  diastolic = "80",
}: { systolic?: string; diastolic?: string } = {}) {
  const fd = new FormData();
  fd.set("vital_type", "blood_pressure");
  fd.set("systolic", systolic);
  fd.set("diastolic", diastolic);
  return fd;
}

describe("logVital — network failure during submission", () => {
  beforeEach(() => {
    getUser.mockReset();
    captureException.mockReset();
  });

  it("returns a retryable error instead of throwing when the connection drops", async () => {
    getUser.mockRejectedValue(new TypeError("fetch failed"));

    const result = await logVital(undefined, bloodPressureFormData());

    expect(result?.error).toMatch(/check your connection/i);
    expect(result?.success).toBeUndefined();
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("still returns the field validation error for bad input without touching the network", async () => {
    // systolic must be greater than diastolic — this fails the schema's own
    // refine() before any network call, and must not be reported to Sentry
    // or confused with a connectivity failure.
    const result = await logVital(undefined, bloodPressureFormData({ systolic: "80", diastolic: "120" }));

    expect(result?.error).toBeDefined();
    expect(result?.error).not.toMatch(/check your connection/i);
    expect(getUser).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("sabotage check: a rejected getUser() call is not accidentally awaited/ignored", async () => {
    // If logVitalInner's rejection were awaited outside the try/catch (e.g.
    // via a refactor that moves the call back out), this test's first
    // assertion would fail with an unhandled rejection instead of a clean
    // { error } result — confirming the try/catch is actually the thing
    // doing the catching, not some other code path that happens to also
    // return an error-shaped object.
    getUser.mockRejectedValue(new Error("ECONNRESET"));

    await expect(logVital(undefined, bloodPressureFormData())).resolves.toEqual(
      expect.objectContaining({ error: expect.stringContaining("check your connection") })
    );
  });
});
