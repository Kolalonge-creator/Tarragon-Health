import { isHeldBack, parseStaffFigures, parseStaffProgrammes, staffFiguresToCsv } from "./staff-figures";

const withheld = { suppressed: true, reason: "under_minimum", minimum: 20 };
const report = {
  cohort: { name: "Staff", sponsor: "Acme", valid_from: "2026-01-01", valid_to: "2026-12-31" }, minimum_cell: 20,
  members: { suppressed: false, joined: 40, agreed_to_share: 30, agreed_pct: 75 },
  bp_control_90d: withheld, change_among_measured: withheld, adherence_separate: withheld, engagement_separate: withheld,
  range: { from: null, to: "2026-09-30" }, definition: "d", limitations: "l", not_a_causal_claim: true, generated_at: "2026-10-03T00:00:00Z",
};
const held = { held_back: true, reason: "small_change", minimum: 20, limitations: "held" };

describe("parsers", () => {
  it("parses programmes", () => {
    expect(parseStaffProgrammes({ sponsor: "Acme", programmes: [{ id: "6f1d7a52-0000-4000-8000-000000000001", name: "Staff", code: null, valid_from: "a", valid_to: "b", status: "closed", latest_period: null }] })?.programmes[0].code).toBeNull();
    expect(parseStaffProgrammes({ sponsor: "Acme" })).toBeNull();
  });
  it("accepts a full month and a held-back month, rejects anything else", () => {
    const months = parseStaffFigures({ ok: true, months: [{ period: "2026-09-01", generated_at: "x", figures: report }, { period: "2026-08-01", generated_at: "x", figures: held }] })!;
    expect(months).toHaveLength(2);
    expect(isHeldBack(months[1].figures)).toBe(true);
    expect(parseStaffFigures({ ok: false })).toBeNull();
    expect(parseStaffFigures({ ok: true, months: [{ period: "not a date", generated_at: "x", figures: report }] })).toBeNull();
    expect(parseStaffFigures({ ok: true, months: [{ period: "2026-09-01", generated_at: "x", figures: {} }] })).toBeNull();
  });
});

describe("staffFiguresToCsv", () => {
  const months = parseStaffFigures({ ok: true, months: [{ period: "2026-09-01", generated_at: "x", figures: report }, { period: "2026-08-01", generated_at: "x", figures: held }] })!;
  const csv = staffFiguresToCsv(months);
  it("carries a period column and says a held-back month is held back, with no numbers for it", () => {
    expect(csv.split("\r\n")[0]).toBe("period,section,item,value");
    expect(csv).toContain("2026-08-01,report,status,held_back");
    expect(csv.split("\r\n").filter((l) => l.startsWith("2026-08-01")).join("")).not.toMatch(/agreed|controlled|mean/);
  });
  it("writes a withheld figure as withheld, never as zero", () => {
    expect(csv).toContain("2026-09-01,bp_control_90d,status,withheld");
    expect(csv).not.toMatch(/bp_control_90d,people,0/);
  });
  it("takes the programme name from the figures and neutralises one that starts like a formula", () => {
    expect(csv).toContain("all,programme,name,Staff");
    const bad = parseStaffFigures({ ok: true, months: [{ period: "2026-09-01", generated_at: "x", figures: { ...report, cohort: { ...report.cohort, name: "=HYPERLINK(1)" } } }] })!;
    expect(staffFiguresToCsv(bad)).toContain("'=HYPERLINK(1)");
  });
  it("keeps a line break inside a quoted cell in one row", () => {
    const multi = parseStaffFigures({ ok: true, months: [{ period: "2026-09-01", generated_at: "x", figures: { ...report, definition: "line one\nline two" } }] })!;
    expect(staffFiguresToCsv(multi)).toContain('2026-09-01,notes,definition,"line one\nline two"');
  });
});
