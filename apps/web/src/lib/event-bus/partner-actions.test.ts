import { beforeEach, describe, expect, it, jest } from "@jest/globals";

type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
const rpc = jest.fn<Rpc>();
let role: string | null = "admin";
let endpoint: { is_active: boolean; auto_disabled_at: string | null } | null = { is_active: false, auto_disabled_at: "2026-10-19T00:00:00Z" };

jest.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: async () => (role ? { role } : null) }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: endpoint, error: null }) }) }) }),
  }),
}));

import { reenableEndpointAction, removeMappingAction, rotateKeyAction, setMappingAction } from "./partner-actions";

const ID = "6f1d7a2e-3b44-4c8e-9a51-0c2d1e8f7a10";
const SECRET = "a".repeat(64);
function form(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}
async function redirected(fn: () => Promise<void>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as Error).message;
  }
  return "no redirect";
}

beforeEach(() => {
  rpc.mockReset();
  role = "admin";
  endpoint = { is_active: false, auto_disabled_at: "2026-10-19T00:00:00Z" };
});

describe("rotateKeyAction", () => {
  it("returns the new key once, from the database function, and never redirects with it", async () => {
    rpc.mockResolvedValue({ data: SECRET, error: null });
    expect(await rotateKeyAction({ status: "idle" }, form({ endpoint_id: ID, grace_hours: "12" }))).toEqual({ status: "rotated", secret: SECRET });
    expect(rpc).toHaveBeenCalledWith("rotate_partner_webhook_secret", { p_endpoint_id: ID, p_grace_hours: 12 });
  });

  it("is refused for anyone who is not an admin, without touching the database", async () => {
    role = "clinician";
    expect(await rotateKeyAction({ status: "idle" }, form({ endpoint_id: ID, grace_hours: "12" }))).toEqual({ status: "forbidden" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a bad id or hours, and says so when the previous rotation is still in its grace window", async () => {
    expect((await rotateKeyAction({ status: "idle" }, form({ endpoint_id: "x", grace_hours: "12" }))).status).toBe("invalid");
    expect((await rotateKeyAction({ status: "idle" }, form({ endpoint_id: ID, grace_hours: "500" }))).status).toBe("invalid");
    rpc.mockResolvedValue({ data: null, error: { code: "55000" } });
    expect((await rotateKeyAction({ status: "idle" }, form({ endpoint_id: ID, grace_hours: "12" }))).status).toBe("window_open");
  });

  it("a failure or a malformed answer is a failure, never a made-up key", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect((await rotateKeyAction({ status: "idle" }, form({ endpoint_id: ID, grace_hours: "12" }))).status).toBe("failed");
    rpc.mockResolvedValue({ data: "short", error: null });
    expect((await rotateKeyAction({ status: "idle" }, form({ endpoint_id: ID, grace_hours: "12" }))).status).toBe("failed");
  });
});

describe("reenableEndpointAction", () => {
  it("switches back on an endpoint the platform switched off", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await redirected(() => reenableEndpointAction(form({ endpoint_id: ID })))).toBe("REDIRECT:/admin/ops/event-bus/partners?r=reenabled");
  });

  it("refuses an endpoint that is on, or was switched off by hand", async () => {
    endpoint = { is_active: true, auto_disabled_at: null };
    expect(await redirected(() => reenableEndpointAction(form({ endpoint_id: ID })))).toBe("REDIRECT:/admin/ops/event-bus/partners?r=failed");
    endpoint = { is_active: false, auto_disabled_at: null };
    expect(await redirected(() => reenableEndpointAction(form({ endpoint_id: ID })))).toBe("REDIRECT:/admin/ops/event-bus/partners?r=failed");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("setMappingAction / removeMappingAction", () => {
  const good = { bus_event_type: "observation.recorded", integration_event_type: "result.available", id_keys: "observation_id", confirm: "yes" };

  it("saves a mapping only with the confirmation ticked", async () => {
    rpc.mockResolvedValue({ data: "partner.webhook.observation_recorded", error: null });
    expect(await redirected(() => setMappingAction(form(good)))).toBe("REDIRECT:/admin/ops/event-bus/partners?r=mapped");
    expect(rpc).toHaveBeenCalledWith("set_partner_event_mapping", {
      p_bus_event_type: "observation.recorded",
      p_integration_event_type: "result.available",
      p_id_keys: ["observation_id"],
    });
    rpc.mockClear();
    expect(await redirected(() => setMappingAction(form({ ...good, confirm: "" })))).toBe("REDIRECT:/admin/ops/event-bus/partners?r=invalid");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an id key that names a person, an unknown partner event and a non-admin", async () => {
    expect(await redirected(() => setMappingAction(form({ ...good, id_keys: "patient_id" })))).toContain("r=invalid");
    expect(await redirected(() => setMappingAction(form({ ...good, integration_event_type: "made.up" })))).toContain("r=invalid");
    role = "clinician";
    expect(await redirected(() => setMappingAction(form(good)))).toContain("r=failed");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("removes a mapping by sending no partner event type, and reports a failure", async () => {
    rpc.mockResolvedValue({ data: "k", error: null });
    expect(await redirected(() => removeMappingAction(form({ bus_event_type: "observation.recorded" })))).toContain("r=unmapped");
    expect(rpc).toHaveBeenCalledWith("set_partner_event_mapping", { p_bus_event_type: "observation.recorded", p_integration_event_type: null });
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(await redirected(() => removeMappingAction(form({ bus_event_type: "observation.recorded" })))).toContain("r=failed");
  });
});
