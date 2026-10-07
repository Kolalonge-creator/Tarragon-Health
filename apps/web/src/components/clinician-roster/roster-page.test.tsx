/** @jest-environment node */
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import type { RosterRow } from "@/lib/clinician-roster/model";

const row = (over: Partial<RosterRow>): RosterRow => ({
  id: "11111111-1111-4111-8111-111111111111", full_name: "Dr A", doctor_tier: "senior_medical_officer", employment_type: "employed", status: "active", active: true,
  level: 2, suspended_at: null, suspended_reason: null, license_expires_at: "2027-01-01T00:00:00Z", indemnity_expires_at: null, indemnity_required: false,
  eligible: true, is_self: false, competencies: ["hypertension"], pending_requests: [], ...over,
});
let rows: RosterRow[] = [];
let ok = true;
jest.mock("@/lib/clinician-roster/load", () => ({
  loadRoster: async () => (ok ? { ok: true, data: rows } : { ok: false, denied: false }),
  loadCompetencies: async () => ({ ok: true, data: [{ code: "hypertension", label: "Hypertension", requires_level: 1, is_active: true }, { code: "diabetes", label: "Diabetes", requires_level: 1, is_active: true }] }),
}));
jest.mock("@/lib/clinician-roster/actions", () => {
  const a = async () => undefined;
  return { leadDecideAction: a, leadGrantAction: a, leadReinstateAction: a, leadRevokeAction: a, leadSuspendAction: a, opsRequestAction: a, opsSuspendAction: a };
});

import { RosterPage } from "./roster-page";

const html = async (door: "ops" | "lead", n?: string) => renderToStaticMarkup(await RosterPage({ door, locale: "en", noticeParam: n }));

describe("RosterPage", () => {
  it("ops sees suspend and the request form, and no reinstate, grant or decision button", async () => {
    rows = [row({ status: "suspended", active: false, eligible: false, suspended_reason: "licence lapsed", pending_requests: [{ id: "22222222-2222-4222-8222-222222222222", kind: "reinstatement", competency_code: null, reason: "renewed", requested_at: "2026-10-06", requested_by_name: "Ops", requested_by_me: true }] })];
    const h = await html("ops");
    expect(h).toContain("Send request");
    expect(h).toContain("licence lapsed");
    expect(h).not.toContain(">Reinstate<");
    expect(h).not.toContain(">Approve<");
    expect(h).not.toContain(">Grant<");
  });
  it("the lead sees approve and decline on a request someone else made, grant, and reinstate on a suspended clinician", async () => {
    rows = [
      row({ id: "33333333-3333-4333-8333-333333333333", pending_requests: [{ id: "22222222-2222-4222-8222-222222222222", kind: "competency_grant", competency_code: "diabetes", reason: "trained", requested_at: "2026-10-06", requested_by_name: "Ops", requested_by_me: false }] }),
      row({ status: "suspended", active: false, eligible: false }),
    ];
    const h = await html("lead");
    expect(h).toContain(">Approve<");
    expect(h).toContain(">Decline<");
    expect(h).toContain(">Grant<");
    expect(h).toContain(">Reinstate<");
  });
  it("never offers a person actions on themselves", async () => {
    rows = [row({ is_self: true })];
    const h = await html("lead");
    expect(h).not.toContain("Pause access");
    expect(h).not.toContain(">Grant<");
  });
  it("a failed load says so and shows no list", async () => {
    ok = false;
    const h = await html("ops");
    ok = true;
    expect(h).toContain("could not be loaded");
    expect(h).not.toContain("Dr A");
  });
  it("shows a failure notice as an alert", async () => {
    rows = [row({})];
    expect(await html("ops", "suspend_failed")).toContain('role="alert"');
    expect(await html("ops", "suspended")).toContain('role="status"');
  });
});
