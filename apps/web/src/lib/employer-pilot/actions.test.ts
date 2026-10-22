import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const rpc = jest.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>();
const getCurrentUser = jest.fn<() => Promise<{ id: string } | null>>();

jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
  getCurrentUser: () => getCurrentUser(),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { closePilot, confirmPilotPayment, createPilot, issuePilotInvoice } from "./actions";

const ID = "6f1d6c1e-4f5e-4a52-9d57-2a3c1d3b8f10";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  rpc.mockReset();
  getCurrentUser.mockReset();
  getCurrentUser.mockResolvedValue({ id: "u1" });
});

describe("employer pilot finance actions", () => {
  it("refuses when nobody is signed in and never calls the database", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect(await createPilot(undefined, form({}))).toEqual({ error: "Not signed in" });
    expect(await confirmPilotPayment(undefined, form({}))).toEqual({ error: "Not signed in" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("validates the create form before any database call", async () => {
    const res = await createPilot(undefined, form({ organisationId: ID, benefitPackageId: ID, seats: "0", startsOn: "2026-11-02", endsOn: "2026-12-02", termsVersion: "t1" }));
    expect(res?.error).toMatch(/at least 1/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("creates a pilot through the one database function with the caller's own session", async () => {
    rpc.mockResolvedValue({ data: ID, error: null });
    const res = await createPilot(undefined, form({ organisationId: ID, benefitPackageId: ID, seats: "12", startsOn: "2026-11-02", endsOn: "2026-12-02", termsVersion: "terms-v1" }));
    expect(res?.message).toMatch(/Pilot created/);
    expect(rpc).toHaveBeenCalledWith("create_employer_seat_pilot", {
      p_org: ID, p_benefit_package: ID, p_seats: 12, p_starts_on: "2026-11-02", p_ends_on: "2026-12-02", p_terms_version: "terms-v1",
    });
  });

  it("turns a database refusal into plain words and does not echo the raw message", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "pilot_not_authorised" } });
    const res = await issuePilotInvoice(undefined, form({ pilotId: ID, organisationId: ID }));
    expect(res).toEqual({ error: "Only finance can do this." });
    rpc.mockResolvedValue({ data: null, error: { message: 'syntax error at or near "select"' } });
    const res2 = await issuePilotInvoice(undefined, form({ pilotId: ID, organisationId: ID }));
    expect(res2?.error).toBe("Something went wrong. Please try again.");
  });

  it("will not call the database for a malformed pilot id", async () => {
    expect(await issuePilotInvoice(undefined, form({ pilotId: "not-a-uuid", organisationId: ID }))).toEqual({ error: "That pilot was not found." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records a payment only with a method and a real reference, and reports a replay honestly", async () => {
    const bad = await confirmPilotPayment(undefined, form({ pilotId: ID, organisationId: ID, method: "cash", reference: "PSK-1001" }));
    expect(bad?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: { result: "replay", granted: 0 }, error: null });
    const replay = await confirmPilotPayment(undefined, form({ pilotId: ID, organisationId: ID, method: "paystack_link", reference: "PSK-1001" }));
    expect(replay?.message).toMatch(/Nothing changed/);
    rpc.mockResolvedValue({ data: { result: "activated", granted: 2 }, error: null });
    const ok = await confirmPilotPayment(undefined, form({ pilotId: ID, organisationId: ID, method: "bank_transfer", reference: "BANK-2002" }));
    expect(ok?.message).toMatch(/pilot is active/);
  });

  it("closing needs a reason of ten characters", async () => {
    const short = await closePilot(undefined, form({ pilotId: ID, organisationId: ID, reason: "no" }));
    expect(short?.error).toBeDefined();
    rpc.mockResolvedValue({ data: "ended", error: null });
    const ok = await closePilot(undefined, form({ pilotId: ID, organisationId: ID, reason: "Pilot review completed" }));
    expect(ok?.message).toMatch(/Members keep/);
  });
});
