import { asNotice, dueLabel, itemLabel, parseAuditForm } from "./model";

const form = { safety_items: ["consent_checked", "red_flags_asked"], quality_items: ["clarity", "plan"], quality_max: 4 };
const data = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k]! : null) });
const full = { "safety:consent_checked": "pass", "safety:red_flags_asked": "pass", "quality:clarity": "3", "quality:plan": "4", rationale: "  fine  " };

describe("parseAuditForm", () => {
  it("reads a complete form", () => {
    expect(parseAuditForm(data(full), form)).toEqual({
      ok: true,
      safety: { consent_checked: true, red_flags_asked: true },
      quality: { clarity: 3, plan: 4 },
      rationale: "fine",
    });
  });
  it("records a fail as false, never as a pass", () => {
    const r = parseAuditForm(data({ ...full, "safety:red_flags_asked": "fail" }), form);
    expect(r.ok && r.safety.red_flags_asked).toBe(false);
  });
  it("stops when a safety item is unanswered, so a half-filled form is never a pass", () => {
    const rest: Record<string, string> = { ...full };
    delete rest["safety:consent_checked"];
    expect(parseAuditForm(data(rest), form)).toEqual({ ok: false, error: "missing_item" });
    expect(parseAuditForm(data({ ...full, "safety:consent_checked": "maybe" }), form)).toEqual({ ok: false, error: "missing_item" });
  });
  it("stops when a quality item is blank, fractional or out of range", () => {
    expect(parseAuditForm(data({ ...full, "quality:plan": "" }), form)).toEqual({ ok: false, error: "missing_item" });
    expect(parseAuditForm(data({ ...full, "quality:plan": "2.5" }), form)).toEqual({ ok: false, error: "bad_score" });
    expect(parseAuditForm(data({ ...full, "quality:plan": "5" }), form)).toEqual({ ok: false, error: "bad_score" });
    expect(parseAuditForm(data({ ...full, "quality:plan": "-1" }), form)).toEqual({ ok: false, error: "bad_score" });
  });
  it("a score of zero is a real answer", () => {
    const r = parseAuditForm(data({ ...full, "quality:plan": "0" }), form);
    expect(r.ok && r.quality.plan).toBe(0);
  });
});

describe("labels and notices", () => {
  it("tidies a key into words", () => {
    expect(itemLabel("consent_checked")).toBe("Consent checked");
    expect(itemLabel("")).toBe("");
  });
  it("accepts only the fixed notice tokens", () => {
    expect(asNotice("audit_submitted")).toBe("audit_submitted");
    expect(asNotice("<script>")).toBeNull();
    expect(asNotice(undefined)).toBeNull();
  });
  it("orders what needs attention", () => {
    expect(dueLabel({ state: "unassigned", overdue: false })).toBe("unassigned");
    expect(dueLabel({ state: "assigned", overdue: true })).toBe("overdue");
    expect(dueLabel({ state: "assigned", overdue: false })).toBe("open");
    expect(dueLabel({ state: "submitted", overdue: false })).toBe("done");
  });
});
