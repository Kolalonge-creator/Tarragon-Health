import { describe, expect, it } from "@jest/globals";
import { TRIAGE_CATEGORIES, deriveUrgencyLevel } from "@tarragon/symptom-triage-engine";
import { getProposedConfig } from "@tarragon/shared";
import { headline, nextSteps } from "./next-steps";

const base = { urgencyLevel: null, forDependant: false, complaintKey: "headache", assessmentId: "a1" } as const;

describe("next steps", () => {
  it("an emergency offers emergency guidance and nothing else", () => {
    expect(nextSteps({ ...base, category: "emergency" }).map((s) => s.kind)).toEqual(["emergency_guidance"]);
  });
  it("never offers a booking or a summary for a child (consultations are adults only)", () => {
    for (const c of TRIAGE_CATEGORIES) {
      const kinds = nextSteps({ ...base, category: c, forDependant: true }).map((s) => s.kind);
      expect(kinds).not.toContain("book_consultation");
      expect(kinds).not.toContain("send_summary");
    }
  });
  it("offers booking with a summary for an adult with a recorded urgent or routine check", () => {
    for (const c of ["urgent", "routine"] as const) {
      const kinds = nextSteps({ ...base, category: c }).map((s) => s.kind);
      expect(kinds).toContain("book_consultation");
      expect(kinds).toContain("send_summary");
      expect(kinds).toContain("lab_or_home_test");
      expect(kinds).toContain("nearest_clinic");
    }
    expect(nextSteps({ ...base, category: "urgent", assessmentId: null }).map((s) => s.kind)).not.toContain("send_summary");
  });
  it("self-care links into the learning content and offers a pharmacist only when the signed map says so", () => {
    const s = nextSteps({ ...base, category: "self_management" });
    expect(s[0]).toEqual({ kind: "self_care_content", href: "/patient/learn?topic=headache" });
    expect(s.map((x) => x.kind)).not.toContain("pharmacist");
    expect(nextSteps({ ...base, category: "self_management", urgencyLevel: "see_pharmacist" }).map((x) => x.kind)).toContain("pharmacist");
  });
  it("every link stays inside the patient area", () => {
    for (const c of TRIAGE_CATEGORIES) for (const s of nextSteps({ ...base, category: c })) if (s.href) expect(s.href.startsWith("/patient/")).toBe(true);
  });
});

describe("the six-level wording is hidden while the urgency map is unsigned", () => {
  it("the shipped urgency map is an unsigned draft, so no level is derived for any result and the headline is the four-category result", () => {
    const map = getProposedConfig("symptom.urgency_map").value;
    for (const c of TRIAGE_CATEGORIES) {
      for (const review of [false, true]) {
        const level = deriveUrgencyLevel(c, review, map);
        expect(level).toBeNull();
        expect(headline(c, level)).toEqual({ kind: "category", category: c });
      }
    }
  });
  it("a level is shown only when one was derived", () => {
    expect(headline("urgent", "doctor_today")).toEqual({ kind: "level", level: "doctor_today" });
  });
});

describe("the shipped context, dependant and skin photo config", () => {
  it("every shipped context entry is an unsigned draft", async () => {
    const { contextTighteningConfigSchema } = await import("@tarragon/symptom-triage-engine");
    const parsed = contextTighteningConfigSchema.parse(getProposedConfig("symptom.context_tightening").value);
    expect(parsed.entries.length).toBeGreaterThan(0);
    for (const e of parsed.entries) {
      expect(e.status).toBe("draft");
      expect(e.clinical_sign_off).toBeNull();
    }
  });
});
