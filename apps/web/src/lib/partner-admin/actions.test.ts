import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const rpc = jest.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>>();
let role: string | null = "admin";

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: async () => (role ? { role } : null) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { reenableEndpointAction, removeMappingAction, rotateSecretAction, saveMappingAction } from "./actions";

const ID = "6f1d7a2e-3b44-4c8e-9a51-0c2d1e8f7a10";
const SECRET = "a".repeat(64);

describe("partner webhook admin actions", () => {
  beforeEach(() => {
    rpc.mockReset();
    role = "admin";
  });

  it("refuses everything for a non admin without calling the database", async () => {
    for (const r of [null, "clinician", "patient"]) {
      role = r;
      expect(await rotateSecretAction(ID, 24)).toEqual({ ok: false, error: "forbidden" });
      expect(await reenableEndpointAction(ID, "a good enough reason")).toEqual({ ok: false, error: "forbidden" });
      expect(await saveMappingAction("lab_result.released", "result.available", "lab_result_id")).toEqual({ ok: false, error: "forbidden" });
      expect(await removeMappingAction("lab_result.released")).toEqual({ ok: false, error: "forbidden" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rotates and returns the key once, in the result only", async () => {
    rpc.mockResolvedValue({ data: SECRET, error: null });
    expect(await rotateSecretAction(ID, 24)).toEqual({ ok: true, secret: SECRET });
    expect(rpc).toHaveBeenCalledWith("rotate_partner_webhook_secret", { p_endpoint_id: ID, p_grace_hours: 24 });
  });

  it("rejects a bad id or grace period before the database", async () => {
    expect(await rotateSecretAction("nope", 24)).toEqual({ ok: false, error: "invalid" });
    expect(await rotateSecretAction(ID, 0)).toEqual({ ok: false, error: "invalid" });
    expect(await rotateSecretAction(ID, 169)).toEqual({ ok: false, error: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a rotation inside the grace window as a fixed word, without the database message", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "55000", message: `leaky ${SECRET}` } });
    const r = await rotateSecretAction(ID, 24);
    expect(r).toEqual({ ok: false, error: "grace_open" });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("a rotation that returns no usable key is a failure, not a success", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await rotateSecretAction(ID, 24)).toEqual({ ok: false, error: "generic" });
  });

  it("re-enable needs a reason of at least 10 characters before it calls the database", async () => {
    expect(await reenableEndpointAction(ID, "short")).toEqual({ ok: false, error: "reason" });
    expect(await reenableEndpointAction(ID, "          ")).toEqual({ ok: false, error: "reason" });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await reenableEndpointAction(ID, "  Receiver fixed their certificate  ")).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("admin_reenable_partner_webhook_endpoint", { p_endpoint_id: ID, p_reason: "Receiver fixed their certificate" });
  });

  it("surfaces a database failure on re-enable instead of reporting ok", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
    expect(await reenableEndpointAction(ID, "a good enough reason")).toEqual({ ok: false, error: "generic" });
  });

  it("saves a mapping with validated id keys and refuses a person id", async () => {
    rpc.mockResolvedValue({ data: "partner.webhook.lab_result_released", error: null });
    expect(await saveMappingAction("lab_result.released", "result.available", "lab_result_id, order_ids")).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("set_partner_event_mapping", {
      p_bus_event_type: "lab_result.released",
      p_integration_event_type: "result.available",
      p_id_keys: ["lab_result_id", "order_ids"],
    });
    rpc.mockClear();
    expect(await saveMappingAction("lab_result.released", "result.available", "patient_id")).toEqual({ ok: false, error: "invalid" });
    expect(await saveMappingAction("lab_result.released", "not.a.partner.event", "")).toEqual({ ok: false, error: "invalid" });
    expect(await saveMappingAction("Bad Key;", "result.available", "")).toEqual({ ok: false, error: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("removes a mapping and reports a database refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await removeMappingAction("lab_result.released")).toEqual({ ok: true });
    rpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
    expect(await removeMappingAction("lab_result.released")).toEqual({ ok: false, error: "not_found" });
  });
});
