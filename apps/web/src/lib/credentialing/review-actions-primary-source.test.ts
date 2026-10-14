import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const rpc = jest.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>>();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args) }) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
class Redirect extends Error {
  constructor(readonly to: string) {
    super(to);
  }
}
jest.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));

import { recordCheck, recordCredentialDates, recordPrimarySource } from "./review-actions";

const STAFF = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
const APP = "33333333-3333-4333-8333-333333333333";

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}
async function outcome(action: (fd: FormData) => Promise<void>, fd: FormData): Promise<string> {
  try {
    await action(fd);
  } catch (e) {
    if (e instanceof Redirect) return e.to;
    throw e;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
});

describe("recordPrimarySource (Q14, Q15)", () => {
  it("sends the route, reference, date, evidence file and notes to the database function", async () => {
    rpc.mockResolvedValue({ data: "id", error: null });
    const to = await outcome(recordPrimarySource, form({ staffId: STAFF, documentId: DOC, route: "mdcn_dataflow", reference: "  DF-1234  ", verified_on: "2026-10-05", notes: "checked", returnTo: "/admin/credentialing" }));
    expect(rpc).toHaveBeenCalledWith("record_primary_source_verification", {
      p_staff: STAFF, p_route: "mdcn_dataflow", p_reference: "DF-1234", p_verified_on: "2026-10-05", p_evidence_document: DOC, p_notes: "checked",
    });
    expect(to).toContain("ok=");
  });
  it("shows the database's own refusal to the reviewer and never swallows it", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "this reference is already recorded", code: "23514" } });
    const to = await outcome(recordPrimarySource, form({ staffId: STAFF, documentId: DOC, route: "mdcn_dataflow", reference: "DF-1234", verified_on: "2026-10-05", returnTo: "/clinician/credentialing" }));
    expect(to).toContain("error=");
    expect(decodeURIComponent(to)).toContain("this reference is already recorded");
  });
  it("an unknown route or a malformed date never reaches the database", async () => {
    const to = await outcome(recordPrimarySource, form({ staffId: STAFF, documentId: DOC, route: "phone_call", reference: "DF-1234", verified_on: "2026-10-05", returnTo: "/admin/credentialing" }));
    expect(to).toContain("error=");
    const to2 = await outcome(recordPrimarySource, form({ staffId: STAFF, documentId: DOC, route: "mdcn_dataflow", reference: "DF-1234", verified_on: "5 Oct", returnTo: "/admin/credentialing" }));
    expect(to2).toContain("error=");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("recordCheck for the primary-source check", () => {
  it("passes the verification details to record_credential_check", async () => {
    await outcome(recordCheck, form({ applicationId: APP, kind: "primary_source", result: "passed", route: "mdcn_written_confirmation", reference: "MDCN-77", verified_on: "2026-10-05", returnTo: "/admin/credentialing/x" }));
    expect(rpc).toHaveBeenCalledWith("record_credential_check", expect.objectContaining({
      p_kind: "primary_source", p_result: "passed", p_details: { route: "mdcn_written_confirmation", reference: "MDCN-77", verified_on: "2026-10-05" },
    }));
  });
  it("a failed check needs no details", async () => {
    await outcome(recordCheck, form({ applicationId: APP, kind: "primary_source", result: "failed", notes: "no such registration", returnTo: "/admin/credentialing/x" }));
    expect(rpc).toHaveBeenCalledWith("record_credential_check", expect.objectContaining({ p_result: "failed", p_details: {} }));
  });
});

describe("recordCredentialDates (OQ-109)", () => {
  it("sends end-of-day Lagos times and the note", async () => {
    await outcome(recordCredentialDates, form({ staffId: STAFF, licence_expires_on: "2027-03-31", indemnity_expires_on: "", note: "read from the licence card", returnTo: "/admin/credentialing/expiry" }));
    expect(rpc).toHaveBeenCalledWith("record_clinician_credential_dates", {
      p_staff: STAFF, p_licence_expires_at: "2027-03-31T23:59:59+01:00", p_indemnity_expires_at: null, p_note: "read from the licence card",
    });
  });
  it("with no date entered nothing is sent", async () => {
    const to = await outcome(recordCredentialDates, form({ staffId: STAFF, note: "read from the licence card", returnTo: "/admin/credentialing/expiry" }));
    expect(to).toContain("error=");
    expect(rpc).not.toHaveBeenCalled();
  });
});
