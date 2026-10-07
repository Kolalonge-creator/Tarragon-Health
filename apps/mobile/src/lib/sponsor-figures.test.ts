jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn() } }));

import { supabase } from "./supabase";
import { figureLines, isSponsorStaffRole, shellForRole, loadFigures, loadProgrammes, parseFigures, parseProgrammes } from "./sponsor-figures";

const rpc = supabase.rpc as unknown as jest.Mock;
const withheld = { suppressed: true, reason: "under_minimum", minimum: 20 };
const full = {
  members: { suppressed: false, joined: 40, agreed_to_share: 30, agreed_pct: 75 },
  bp_control_90d: { suppressed: false, n: 30, controlled: 18, uncontrolled: 9, insufficient_data: 3, rate_strict_pct: 60, rate_among_measured_pct: 66.7, missing_pct: 10 },
  change_among_measured: { suppressed: false, n: 27, mean_systolic_change: -8.4, mean_diastolic_change: -4.1 },
  adherence_separate: { suppressed: false, n: 25, mean_pct: 81.5 },
  engagement_separate: { suppressed: false, n: 30, logged_a_reading_in_30_days_pct: 70 },
  limitations: "Only members who agreed are counted.",
};

beforeEach(() => rpc.mockReset());

describe("isSponsorStaffRole", () => {
  it("is true only for the three institution roles", () => {
    expect(["hmo_admin", "corporate_admin", "ngo_admin"].every(isSponsorStaffRole)).toBe(true);
    for (const r of ["patient", "clinician", "admin", "payer_admin", "", null, undefined]) expect(isSponsorStaffRole(r as string | null)).toBe(false);
  });
});

describe("shellForRole", () => {
  it("sends only sponsor staff to the sponsor app and everyone else, including no role, to the patient app", () => {
    expect(["hmo_admin", "corporate_admin", "ngo_admin"].map(shellForRole)).toEqual(["sponsor", "sponsor", "sponsor"]);
    for (const r of ["patient", "clinician", "admin", "payer_admin", "", null, undefined]) expect(shellForRole(r as string | null)).toBe("patient");
  });
});

describe("figureLines", () => {
  it("words every figure when nothing is withheld", () => {
    const lines = figureLines(full)!;
    expect(lines.map((l) => l.value)).toEqual(["30 of 40 (75%)", "60% of 30 people", "66.7%", "10%", "-8.4 / -4.1 mmHg", "81.5%", "70%"]);
  });
  it("words a withheld figure as withheld, never as zero", () => {
    const lines = figureLines({ ...full, bp_control_90d: withheld, adherence_separate: withheld })!;
    expect(lines[1].value).toBe("Fewer than 20 people, so nothing is shown");
    expect(lines.find((l) => l.label.startsWith("Medicines"))!.value).toContain("nothing is shown");
    expect(lines.some((l) => l.value === "0%")).toBe(false);
  });
  it("says a small group is withheld when one group is small", () => {
    const lines = figureLines({ ...full, members: { suppressed: true, reason: "small_cell", minimum: 20 } })!;
    expect(lines[0].value).toBe("A group is smaller than 20, so the counts are withheld");
  });
  it("rejects a month with a missing number instead of showing 0% or a placeholder", () => {
    expect(figureLines({ ...full, members: { suppressed: false, joined: 40, agreed_to_share: 30 } })).toBeNull();
    expect(figureLines({ ...full, adherence_separate: { suppressed: false, n: 25 } })).toBeNull();
  });
  it("words a held-back month as held back and shows no numbers", () => {
    const lines = figureLines({ held_back: true, reason: "small_change", minimum: 20, limitations: "x" })!;
    expect(lines).toHaveLength(1);
    expect(lines[0].value).toContain("Held back");
    expect(lines[0].value).not.toMatch(/\d/);
  });
  it("rejects a payload with a missing section instead of inventing one", () => {
    expect(figureLines({ members: full.members })).toBeNull();
    expect(figureLines(null)).toBeNull();
  });
});

describe("parsers", () => {
  it("parses programmes and keeps a missing code null", () => {
    const r = parseProgrammes({ sponsor: "Acme", programmes: [{ id: "1", name: "Staff", code: null, valid_from: "2026-01-01", valid_to: "2026-12-31", status: "closed", latest_period: "2026-09-01" }] });
    expect(r?.programmes[0]).toMatchObject({ code: null, status: "closed", latestPeriod: "2026-09-01" });
    expect(parseProgrammes({ sponsor: "Acme", programmes: [{ id: "1" }] })).toBeNull();
  });
  it("labels each month and carries the limitations note", () => {
    const r = parseFigures({ ok: true, months: [{ period: "2026-09-01", generated_at: "x", figures: full }] })!;
    expect(r[0].label).toBe("September 2026");
    expect(r[0].note).toContain("agreed");
    expect(parseFigures({ ok: true, months: [{ period: "2026-09-01", figures: {} }] })).toBeNull();
    expect(parseFigures({ ok: false })).toBeNull();
    expect(parseFigures([])).toBeNull();
  });
});

describe("loaders", () => {
  it("reports a refusal as a failure, never as an empty list", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "sponsor_not_authorised" } });
    expect(await loadFigures("c")).toEqual({ ok: false });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await loadProgrammes()).toEqual({ ok: false });
  });
  it("treats the database's own refusal ({ok:false}) as a failure", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: false }, error: null });
    expect(await loadFigures("c")).toEqual({ ok: false });
  });
  it("reports a thrown error as a failure", async () => {
    rpc.mockRejectedValueOnce(new Error("offline"));
    expect(await loadFigures("c")).toEqual({ ok: false });
  });
  it("asks only for the one programme it was given", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true, months: [] }, error: null });
    expect(await loadFigures("abc")).toEqual({ ok: true, months: [] });
    expect(rpc).toHaveBeenCalledWith("sponsor_staff_figures", { p_cohort: "abc" });
  });
});
