/**
 * The patient action always scores the SESSION's own id (never a caller-supplied one), writes through the service-role client only,
 * and turns the engine's answer into a band and tier, or a named not-scored reason.
 */
const getUser = jest.fn();
const assess = jest.fn();
const sourceFactory = jest.fn((user: unknown, service: unknown) => ({ user, service }));

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ auth: { getUser: (...a: unknown[]) => getUser(...a) } }),
}));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: jest.fn(() => ({ role: "service" })) }));
jest.mock("@/lib/cv-risk/who-2019", () => ({
  assessCvdWho2019: (...a: unknown[]) => assess(...a),
  supabaseCvdDataSource: (u: unknown, s: unknown) => sourceFactory(u, s),
}));

import { runMyCvdRiskAssessment } from "./cvd-risk-actions";

describe("runMyCvdRiskAssessment", () => {
  beforeEach(() => {
    getUser.mockReset();
    assess.mockReset();
  });

  it("refuses when nobody is signed in and assesses nothing", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await runMyCvdRiskAssessment()).toEqual({ ok: false, error: "not_signed_in" });
    expect(assess).not.toHaveBeenCalled();
  });

  it("scores the session's own id and returns a band, never a percentage", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "me" } } });
    assess.mockResolvedValue({ ok: true, id: "r1", outcome: { status: "scored", model: "lab", bandCode: "10to20", tier: "moderate", furtherAssessment: false } });
    const r = await runMyCvdRiskAssessment();
    expect(assess).toHaveBeenCalledWith(expect.anything(), "me", { recordedBy: "me" });
    expect(r).toEqual({ ok: true, status: "scored", bandCode: "10to20", tier: "moderate", furtherAssessment: false });
    expect(JSON.stringify(r)).not.toMatch(/pct|percent|risk/i);
  });

  it("passes the service-role client only as the write side", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "me" } } });
    assess.mockResolvedValue({ ok: true, id: "r1", outcome: { status: "not_scored_instrument_off" } });
    await runMyCvdRiskAssessment();
    expect(sourceFactory).toHaveBeenCalledWith(expect.objectContaining({ auth: expect.anything() }), { role: "service" });
  });

  it("names the reason when it did not score", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "me" } } });
    assess.mockResolvedValue({ ok: true, id: "r1", outcome: { status: "not_scored_known_diabetes" } });
    expect(await runMyCvdRiskAssessment()).toEqual({ ok: true, status: "not_scored", reason: "not_scored_known_diabetes" });
  });

  it("reports unavailable when the run could not be stored", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "me" } } });
    assess.mockResolvedValue({ ok: false, reason: "write_failed" });
    expect(await runMyCvdRiskAssessment()).toEqual({ ok: false, error: "unavailable" });
  });
});
