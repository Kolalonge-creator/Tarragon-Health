import { awaitingMe, dueLabel, extraRpcArgs, isFailureNotice, parseAuditForm, reviewerCandidates, type StaffOption } from "./model";

const form = { safety_items: ["consent_checked", "red_flags_asked"], quality_items: ["clarity", "plan"], quality_max: 4 };
const data = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k]! : null) });
const full = { "safety:consent_checked": "pass", "safety:red_flags_asked": "pass", "quality:clarity": "3", "quality:plan": "4", rationale: "fine" };
const form2 = {
  ...form,
  phases: ["assessment", "decision", "action", "documentation"],
  phase_comment_max_chars: 20,
  avoidability: { scale: ["not_applicable", "not_avoidable", "probably_avoidable"], required_unless_outcome: "satisfactory" },
  scribe_items: ["no_clinically_relevant_omission", "no_invented_content"],
};
const scribeAll = { "scribe:no_clinically_relevant_omission": "pass", "scribe:no_invented_content": "pass" };

describe("parseAuditForm, form version 2", () => {
  it("keeps only the phase comments that were written, trimmed and capped", () => {
    const r = parseAuditForm(data({ ...full, "phase:assessment": "  History was brief and the plan far too long to fit  ", "phase:decision": "   " }), form2);
    expect(r.ok && r.phaseComments).toEqual({ assessment: "History was brief an" });
  });
  it("sends no phase comments at all when none were written", () => {
    const r = parseAuditForm(data(full), form2);
    expect(r.ok && r.phaseComments).toBeUndefined();
  });
  it("accepts a rating from the form's own scale and refuses any other", () => {
    const ok = parseAuditForm(data({ ...full, avoidability: "probably_avoidable" }), form2);
    expect(ok.ok && ok.avoidability).toBe("probably_avoidable");
    expect(parseAuditForm(data({ ...full, avoidability: "maybe" }), form2)).toEqual({ ok: false, error: "bad_avoidability" });
  });
  it("ignores an avoidability field when the stored form has no such rating (version 1)", () => {
    const r = parseAuditForm(data({ ...full, avoidability: "probably_avoidable", "phase:assessment": "x" }), form);
    expect(r.ok && r.avoidability).toBeUndefined();
    expect(r.ok && r.phaseComments).toBeUndefined();
  });
  it("needs every scribe item answered for a scribe-drafted note, and ignores them otherwise", () => {
    expect(parseAuditForm(data(full), form2, true)).toEqual({ ok: false, error: "missing_scribe" });
    expect(parseAuditForm(data({ ...full, "scribe:no_invented_content": "pass" }), form2, true)).toEqual({ ok: false, error: "missing_scribe" });
    const ok = parseAuditForm(data({ ...full, ...scribeAll, "scribe:no_invented_content": "fail" }), form2, true);
    expect(ok.ok && ok.scribe).toEqual({ no_clinically_relevant_omission: true, no_invented_content: false });
    const plain = parseAuditForm(data({ ...full, ...scribeAll }), form2, false);
    expect(plain.ok && plain.scribe).toBeUndefined();
  });
});

describe("extraRpcArgs", () => {
  const base = { ok: true as const, safety: {}, quality: {}, rationale: "" };
  it("sends only what the form defined", () => {
    expect(extraRpcArgs(base, false)).toEqual({});
    expect(extraRpcArgs({ ...base, phaseComments: { assessment: "x" }, avoidability: "not_avoidable", scribe: { a: true } }, false)).toEqual({
      p_phase_comments: { assessment: "x" },
      p_avoidability: "not_avoidable",
      p_scribe: { a: true },
    });
  });
  it("a second review carries no avoidability rating (the database function has none)", () => {
    expect(extraRpcArgs({ ...base, avoidability: "not_avoidable" }, true)).toEqual({});
  });
});

describe("the queue", () => {
  it("a critical miss waiting for its second reader is not done", () => {
    expect(dueLabel({ state: "submitted", overdue: false, second_review_required: true, final: false })).toBe("second");
    expect(dueLabel({ state: "submitted", overdue: true, second_review_required: true, final: false })).toBe("overdue");
    expect(dueLabel({ state: "submitted", overdue: false, second_review_required: true, final: true })).toBe("done");
  });
  it("knows whose turn it is", () => {
    const me = "00000000-0000-4000-8000-000000000001";
    const other = "00000000-0000-4000-8000-000000000002";
    expect(awaitingMe({ state: "assigned", reviewer_id: me, second_reviewer_id: null, second_review_required: false, final: false }, me)).toBe(true);
    expect(awaitingMe({ state: "assigned", reviewer_id: other, second_reviewer_id: null, second_review_required: false, final: false }, me)).toBe(false);
    expect(awaitingMe({ state: "submitted", reviewer_id: other, second_reviewer_id: me, second_review_required: true, final: false }, me)).toBe(true);
    expect(awaitingMe({ state: "submitted", reviewer_id: me, second_reviewer_id: other, second_review_required: true, final: false }, me)).toBe(false);
    expect(awaitingMe({ state: "assigned", reviewer_id: me, second_reviewer_id: null, second_review_required: false, final: false }, null)).toBe(false);
  });
  it("offers only other chief medical officers as reviewers", () => {
    const s = (id: string, tier: string, profile: string | null): StaffOption => ({ id, profile_id: profile, full_name: id, doctor_tier: tier, credentialing_level: 2 });
    const staff = [s("a", "chief_medical_officer", "p1"), s("b", "chief_medical_officer", "p2"), s("c", "senior_medical_officer", "p3"), s("d", "chief_medical_officer", null)];
    expect(reviewerCandidates(staff, "p1").map((x) => x.id)).toEqual(["b"]);
  });
  it("classes failure notices", () => {
    expect(isFailureNotice("reassign_failed")).toBe(true);
    expect(isFailureNotice("audit_incomplete")).toBe(true);
    expect(isFailureNotice("tier1_extended")).toBe(false);
  });
});
