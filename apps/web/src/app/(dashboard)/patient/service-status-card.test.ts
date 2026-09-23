import { afterEach, describe, expect, it, jest } from "@jest/globals";

/**
 * The defect this guards against: a broken RPC or a genuine access refusal
 * rendering as "monitoring active" (or any other confident status) instead
 * of the card quietly hiding itself. This is the opposite failure direction
 * from worklist-counts.test.ts (which must never render a failed query as a
 * confident 0) -- here, "no answer" must fail CLOSED to null, never render a
 * clinician relationship that isn't actually funded.
 */

const mockRpc =
  jest.fn<(fn: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>>();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest
    .fn<() => Promise<{ rpc: typeof mockRpc }>>()
    .mockResolvedValue({ rpc: mockRpc }),
}));

import { resolveServiceAccess, type ServiceAccess } from "./service-status-card";

describe("resolveServiceAccess", () => {
  afterEach(() => {
    mockRpc.mockReset();
  });

  it("returns the resolved status on a successful RPC call", async () => {
    const access: ServiceAccess = {
      status: "monitoring_active",
      monitoringExpiresAt: "2026-12-22T00:00:00.000Z",
      healthCheckReviewRequestedAt: null,
      resolvedAt: "2026-09-23T00:00:00.000Z",
    };
    mockRpc.mockResolvedValue({ data: access, error: null });

    await expect(resolveServiceAccess("patient-1")).resolves.toEqual(access);
    expect(mockRpc).toHaveBeenCalledWith("resolve_patient_service_access", { p_patient_id: "patient-1" });
  });

  it("fails closed to null rather than throwing or defaulting to an active status when the RPC errors", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });

    await expect(resolveServiceAccess("patient-1")).resolves.toBeNull();
  });
});
