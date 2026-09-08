/**
 * Drift guard + pure-logic coverage for the mobile Healthy Ageing copy.
 *
 * apps/mobile/src/lib/healthy-ageing.ts is a hand-maintained copy of
 * apps/web/src/lib/healthy-ageing/types.ts's constants (same pattern as
 * bp-classification.test.ts's web/mobile lock-step guard) — a change on
 * either side without the other is a silent copy/label mismatch a patient
 * would see, not a compile error, so it needs its own test rather than
 * trusting review to catch it.
 */
import {
  AGEING_ASSESSMENT_DOMAINS as WEB_AGEING_ASSESSMENT_DOMAINS,
  DOMAIN_LABEL as WEB_DOMAIN_LABEL,
  FALLS_PATHWAY_STAGE_LABEL as WEB_FALLS_PATHWAY_STAGE_LABEL,
  FALLS_RISK_LEVEL_LABEL as WEB_FALLS_RISK_LEVEL_LABEL,
  HOME_CARE_STATUS_LABEL as WEB_HOME_CARE_STATUS_LABEL,
  OUTCOME_COPY as WEB_OUTCOME_COPY,
  POLYPHARMACY_THRESHOLD as WEB_POLYPHARMACY_THRESHOLD,
} from "../../../web/src/lib/healthy-ageing/types";
import {
  AGEING_ASSESSMENT_DOMAINS,
  DOMAIN_LABEL,
  FALLS_PATHWAY_STAGE_LABEL,
  FALLS_RISK_LEVEL_LABEL,
  HEALTHY_AGEING_AGE_THRESHOLD,
  HOME_CARE_STATUS_LABEL,
  OUTCOME_COPY,
  POLYPHARMACY_THRESHOLD,
  fallsRiskDisplay,
  isPolypharmacy,
  missingDomains,
  type AgeingAssessmentView,
} from "./healthy-ageing";

describe("lock-step with apps/web/src/lib/healthy-ageing/types.ts", () => {
  it("owns exactly the same 9 domains, in the same order", () => {
    expect(AGEING_ASSESSMENT_DOMAINS).toEqual(WEB_AGEING_ASSESSMENT_DOMAINS);
    expect(AGEING_ASSESSMENT_DOMAINS).toHaveLength(9);
  });

  it("shows the same domain labels", () => {
    expect(DOMAIN_LABEL).toEqual(WEB_DOMAIN_LABEL);
  });

  it("shows the same non-diagnostic outcome copy (spec §50.6)", () => {
    expect(OUTCOME_COPY).toEqual(WEB_OUTCOME_COPY);
  });

  it("shows the same falls-risk level and pathway-stage labels", () => {
    expect(FALLS_RISK_LEVEL_LABEL).toEqual(WEB_FALLS_RISK_LEVEL_LABEL);
    expect(FALLS_PATHWAY_STAGE_LABEL).toEqual(WEB_FALLS_PATHWAY_STAGE_LABEL);
  });

  it("shows the same home-care request status copy", () => {
    expect(HOME_CARE_STATUS_LABEL).toEqual(WEB_HOME_CARE_STATUS_LABEL);
  });

  it("uses the same polypharmacy threshold", () => {
    expect(POLYPHARMACY_THRESHOLD).toBe(WEB_POLYPHARMACY_THRESHOLD);
  });
});

describe("missingDomains", () => {
  function assessmentWith(domains: string[]): AgeingAssessmentView {
    return {
      id: "a1",
      status: "in_progress",
      startedAt: "2026-09-01T00:00:00Z",
      completedAt: null,
      nextReviewDueAt: null,
      loggedByProfileId: null,
      domainResults: domains.map((domain, i) => ({
        id: `r${i}`,
        domain: domain as AgeingAssessmentView["domainResults"][number]["domain"],
        outcome: "no_concern",
        notes: null,
        clinicianReviewedAt: null,
      })),
    };
  }

  it("treats no assessment at all as all 9 domains missing", () => {
    expect(missingDomains(null)).toEqual(AGEING_ASSESSMENT_DOMAINS);
  });

  it("excludes only the domains already answered", () => {
    const result = missingDomains(assessmentWith(["mobility", "falls"]));
    expect(result).not.toContain("mobility");
    expect(result).not.toContain("falls");
    expect(result).toHaveLength(7);
  });

  it("returns nothing once every domain has an answer", () => {
    expect(missingDomains(assessmentWith(AGEING_ASSESSMENT_DOMAINS))).toEqual([]);
  });
});

describe("isPolypharmacy", () => {
  it("is false below the threshold and true at/above it", () => {
    expect(isPolypharmacy(4)).toBe(false);
    expect(isPolypharmacy(5)).toBe(true);
    expect(isPolypharmacy(0)).toBe(false);
  });
});

describe("fallsRiskDisplay", () => {
  it("reads as 'Not checked' with no badge when there's no open pathway entry", () => {
    expect(fallsRiskDisplay(null)).toEqual({ value: "Not checked", badge: undefined });
  });

  it("reads as 'Awaiting review' (never a reassuring low) when risk_level is still null", () => {
    const display = fallsRiskDisplay({ riskLevel: null });
    expect(display.value).toBe("Awaiting review");
    expect(display.badge).toEqual({ text: "Awaiting review", tone: "neutral" });
  });

  it("maps each graded level to its label and the matching badge tone", () => {
    expect(fallsRiskDisplay({ riskLevel: "low" })).toEqual({ value: "Low", badge: { text: "Low", tone: "brand" } });
    expect(fallsRiskDisplay({ riskLevel: "moderate" })).toEqual({
      value: "Moderate",
      badge: { text: "Moderate", tone: "warn" },
    });
    expect(fallsRiskDisplay({ riskLevel: "high" })).toEqual({
      value: "High",
      badge: { text: "High", tone: "danger" },
    });
  });
});

describe("HEALTHY_AGEING_AGE_THRESHOLD", () => {
  it("matches the web page's own threshold (60)", () => {
    expect(HEALTHY_AGEING_AGE_THRESHOLD).toBe(60);
  });
});
