import { beforeEach, describe, expect, it, jest } from "@jest/globals";

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
const rpc = jest.fn<(name: string, args: Record<string, unknown>) => Promise<RpcResult>>();
let role: string | null = "admin";
const loadEndpoints = jest.fn<() => Promise<{ rows: { id: string; previous_secret_expires_at: string | null }[]; failed: boolean }>>();

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: async () => (role ? { role } : null) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
jest.mock("./partners-load", () => ({ loadPartnerEndpoints: () => loadEndpoints() }));

import { reenablePartnerEndpointAction, removeMappingAction, rotatePartnerSecretAction, saveMappingAction } from "./partners-actions";
import { IDLE } from "./partners-model";

const ID = "6f1d7a2e-3b44-4c8e-9a51-0c2d1e8f7a10";
const SECRET = "f".repeat(64);
function form(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  rpc.mockReset();
  loadEndpoints.mockReset();
  loadEndpoints.mockResolvedValue({ rows: [{ id: ID, previous_secret_expires_at: "2026-10-21T10:00:00Z" }], failed: false });
  role = "admin";
});

describe("rotatePartnerSecretAction", () => {
  it("returns the secret once, with the grace end, and calls the database once", async () => {
    rpc.mockResolvedValue({ data: SECRET, error: null });
    const state = await rotatePartnerSecretAction(IDLE, form({ endpoint_id: ID, grace_hours: "24", confirm: "on" }));
    expect(state).toEqual({ status: "ok", endpointId: ID, secret: SECRET, graceEndsAt: "2026-10-21T10:00:00Z" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("rotate_partner_webhook_secret", { p_endpoint_id: ID, p_grace_hours: 24 });
  });

  it("never logs the secret", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    rpc.mockResolvedValue({ data: SECRET, error: null });
    await rotatePartnerSecretAction(IDLE, form({ endpoint_id: ID, grace_hours: "24", confirm: "on" }));
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain(SECRET);
      s.mockRestore();
    }
  });

  it("refuses a non-admin and a signed-out caller without calling the database", async () => {
    for (const r of ["clinician", null]) {
      role = r;
      expect(await rotatePartnerSecretAction(IDLE, form({ endpoint_id: ID, grace_hours: "24", confirm: "on" }))).toEqual({
        status: "error",
        message: "busops.partners.error.not_admin",
      });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("validates input: bad id, grace outside 1 to 168, missing confirmation", async () => {
    const bad: Record<string, string>[] = [
      { endpoint_id: "nope", grace_hours: "24", confirm: "on" },
      { endpoint_id: ID, grace_hours: "0", confirm: "on" },
      { endpoint_id: ID, grace_hours: "169", confirm: "on" },
      { endpoint_id: ID, grace_hours: "24" },
    ];
    for (const f of bad) {
      expect((await rotatePartnerSecretAction(IDLE, form(f))).status).toBe("error");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a grace-window refusal to a fixed sentence and returns no secret", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "the previous rotation is still in its grace window" } });
    const state = await rotatePartnerSecretAction(IDLE, form({ endpoint_id: ID, grace_hours: "24", confirm: "on" }));
    expect(state.message).toBe("busops.partners.rotate.in_grace");
    expect(state.secret).toBeUndefined();
  });

  it("fails closed on a malformed database answer", async () => {
    rpc.mockResolvedValue({ data: "short", error: null });
    const state = await rotatePartnerSecretAction(IDLE, form({ endpoint_id: ID, grace_hours: "24", confirm: "on" }));
    expect(state).toEqual({ status: "error", message: "busops.partners.error.failed" });
  });

  it("does not echo a database error message", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: `boom ${SECRET}` } });
    const state = await rotatePartnerSecretAction(IDLE, form({ endpoint_id: ID, grace_hours: "24", confirm: "on" }));
    expect(JSON.stringify(state)).not.toContain(SECRET);
  });
});

describe("reenablePartnerEndpointAction", () => {
  it("needs a typed reason of at least 10 characters", async () => {
    expect((await reenablePartnerEndpointAction(IDLE, form({ endpoint_id: ID, reason: "short" }))).status).toBe("error");
    expect((await reenablePartnerEndpointAction(IDLE, form({ endpoint_id: ID, reason: "x".repeat(301) }))).status).toBe("error");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls the audited admin function with the trimmed reason", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const state = await reenablePartnerEndpointAction(IDLE, form({ endpoint_id: ID, reason: "  partner fixed their server  " }));
    expect(state.status).toBe("ok");
    expect(rpc).toHaveBeenCalledWith("admin_reenable_partner_webhook_endpoint", { p_endpoint_id: ID, p_reason: "partner fixed their server" });
  });

  it("refuses a non-admin before the database", async () => {
    role = "clinician";
    expect((await reenablePartnerEndpointAction(IDLE, form({ endpoint_id: ID, reason: "partner fixed their server" }))).message).toBe("busops.partners.error.not_admin");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a database failure instead of success", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "55000" } });
    expect((await reenablePartnerEndpointAction(IDLE, form({ endpoint_id: ID, reason: "partner fixed their server" }))).status).toBe("error");
  });
});

describe("mapping actions", () => {
  const good = { bus_event_type: "lab_result.released", integration_event_type: "result.available", id_keys: "lab_result_id, order_id", confirm: "on" };

  it("saves a mapping with parsed id keys", async () => {
    rpc.mockResolvedValue({ data: "partner.webhook.lab_result_released", error: null });
    expect((await saveMappingAction(IDLE, form(good))).status).toBe("ok");
    expect(rpc).toHaveBeenCalledWith("set_partner_event_mapping", {
      p_bus_event_type: "lab_result.released",
      p_integration_event_type: "result.available",
      p_id_keys: ["lab_result_id", "order_id"],
    });
  });

  it("refuses person ids, unknown partner types, bad keys and a missing confirmation", async () => {
    for (const bad of [
      { ...good, id_keys: "patient_id" },
      { ...good, id_keys: "name" },
      { ...good, integration_event_type: "made.up" },
      { ...good, confirm: "" },
      { ...good, bus_event_type: "NOT VALID" },
    ]) {
      expect((await saveMappingAction(IDLE, form(bad))).status).toBe("error");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses non-admins for save and remove", async () => {
    role = "clinician";
    expect((await saveMappingAction(IDLE, form(good))).message).toBe("busops.partners.error.not_admin");
    expect((await removeMappingAction(IDLE, form({ bus_event_type: "lab_result.released", confirm: "on" }))).message).toBe("busops.partners.error.not_admin");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("removes a mapping only when confirmed", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await removeMappingAction(IDLE, form({ bus_event_type: "lab_result.released" }))).status).toBe("error");
    expect((await removeMappingAction(IDLE, form({ bus_event_type: "lab_result.released", confirm: "on" }))).status).toBe("ok");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("admin_disable_partner_event_mapping", { p_bus_event_type: "lab_result.released" });
  });
});
