import {
  INCIDENT_CATEGORY_LABEL,
  INCIDENT_CATEGORY_ORDER,
  INCIDENT_SEVERITY_LABEL,
  INCIDENT_SEVERITY_ORDER,
  INCIDENT_SEVERITY_VARIANT,
  INCIDENT_STATUS_LABEL,
  UNRESOLVED_INCIDENT_STATUSES,
  isSeriousIncident,
  isTerminal,
  isUnresolved,
  nextStatusesFor,
  sortIncidents,
  validateIncidentClosure,
  type IncidentSeverity,
  type IncidentStatus,
} from "./incident-governance";
import { safetyConcerns, type SafetyMetrics } from "./safety-metrics";

/**
 * These assert the rules this module MIRRORS from
 * 20260826225518_clinical_incident_near_miss_log.sql. The database is the
 * enforcement boundary; the point of testing the mirror is that a drift shows
 * up here rather than as a raw Postgres error in front of a doctor closing a
 * report.
 */

const ALL_SEVERITIES: IncidentSeverity[] = ["near_miss", "low", "medium", "high", "critical"];
const ALL_STATUSES: IncidentStatus[] = ["open", "under_review", "action_planned", "closed"];

describe("incident taxonomy", () => {
  it("labels every category the CHECK constraint allows, and orders all of them", () => {
    const labelled = Object.keys(INCIDENT_CATEGORY_LABEL).sort();
    expect([...INCIDENT_CATEGORY_ORDER].sort()).toEqual(labelled);
  });

  it("labels and colours every severity, and orders them most serious first", () => {
    for (const severity of ALL_SEVERITIES) {
      expect(INCIDENT_SEVERITY_LABEL[severity]).toBeTruthy();
      expect(INCIDENT_SEVERITY_VARIANT[severity]).toBeTruthy();
    }
    expect(INCIDENT_SEVERITY_ORDER).toEqual(["critical", "high", "medium", "low", "near_miss"]);
  });

  it("labels every status", () => {
    for (const status of ALL_STATUSES) {
      expect(INCIDENT_STATUS_LABEL[status]).toBeTruthy();
    }
  });

  it("keeps near_miss out of the alarm colours — reporting one is not a failure", () => {
    expect(INCIDENT_SEVERITY_VARIANT.near_miss).toBe("grey");
  });
});

describe("serious incidents (§31.9)", () => {
  it("counts high and critical only", () => {
    expect(isSeriousIncident("critical")).toBe(true);
    expect(isSeriousIncident("high")).toBe(true);
    expect(isSeriousIncident("medium")).toBe(false);
    expect(isSeriousIncident("low")).toBe(false);
  });

  it("never treats a near miss as a serious incident", () => {
    expect(isSeriousIncident("near_miss")).toBe(false);
  });
});

describe("lifecycle (§31.8)", () => {
  it("treats every non-closed status as unresolved", () => {
    expect(UNRESOLVED_INCIDENT_STATUSES).toEqual(["open", "under_review", "action_planned"]);
    for (const status of UNRESOLVED_INCIDENT_STATUSES) {
      expect(isUnresolved(status)).toBe(true);
    }
    expect(isUnresolved("closed")).toBe(false);
  });

  it("makes closed terminal — the trigger raises 42501 on any edit to a closed report", () => {
    expect(nextStatusesFor("closed")).toEqual([]);
    expect(isTerminal("closed")).toBe(true);
  });

  it("never offers a route back to open from any state", () => {
    // The trigger stamps reviewed_by_staff/reviewed_at on every status
    // change, and clinical_incident_reports_open_is_clean requires both null
    // when status is 'open' — so returning to open is a constraint violation,
    // not a valid transition.
    for (const status of ALL_STATUSES) {
      expect(nextStatusesFor(status)).not.toContain("open");
    }
  });

  it("only moves a report forward through the ladder", () => {
    expect(nextStatusesFor("open")).toEqual(["under_review", "action_planned", "closed"]);
    expect(nextStatusesFor("under_review")).toEqual(["action_planned", "closed"]);
    expect(nextStatusesFor("action_planned")).toEqual(["closed"]);
  });

  it("lets every unresolved state reach closed directly", () => {
    for (const status of UNRESOLVED_INCIDENT_STATUSES) {
      expect(nextStatusesFor(status)).toContain("closed");
    }
  });
});

describe("closing a report (clinical_incident_reports_closed_requires_outcome)", () => {
  it("requires a stated finding", () => {
    expect(
      validateIncidentClosure({ reviewOutcome: "   ", correctiveAction: "Handover form updated" }),
    ).toMatch(/what the review found/i);
  });

  it("requires a stated corrective action", () => {
    expect(
      validateIncidentClosure({ reviewOutcome: "Alert fired out of hours", correctiveAction: "" }),
    ).toMatch(/corrective action/i);
  });

  it("accepts an explicit no-action-needed decision — the constraint wants a decision, not a change", () => {
    expect(
      validateIncidentClosure({
        reviewOutcome: "Reviewed; the alert behaved correctly.",
        correctiveAction: "No action needed.",
      }),
    ).toBeNull();
  });
});

describe("incident ordering", () => {
  const at = (iso: string) => new Date(iso).toISOString();

  it("puts unresolved reports above closed ones, however serious the closed one was", () => {
    const sorted = sortIncidents([
      { status: "closed", severity: "critical", reported_at: at("2026-08-20T09:00:00Z") },
      { status: "open", severity: "low", reported_at: at("2026-08-01T09:00:00Z") },
    ]);
    expect(sorted[0].status).toBe("open");
  });

  it("ranks the more serious of two open reports first", () => {
    const sorted = sortIncidents([
      { status: "open", severity: "low", reported_at: at("2026-08-20T09:00:00Z") },
      { status: "open", severity: "critical", reported_at: at("2026-08-01T09:00:00Z") },
    ]);
    expect(sorted[0].severity).toBe("critical");
  });

  it("breaks a tie on recency, most recent first", () => {
    const sorted = sortIncidents([
      { status: "open", severity: "high", reported_at: at("2026-08-01T09:00:00Z") },
      { status: "open", severity: "high", reported_at: at("2026-08-20T09:00:00Z") },
    ]);
    expect(sorted[0].reported_at).toBe(at("2026-08-20T09:00:00Z"));
  });
});

describe("safety dashboard concerns (§31.12/§31.17)", () => {
  const base: SafetyMetrics = {
    openIncidents: 0,
    seriousIncidents: 0,
    nearMisses90d: 0,
    overdueClinicalReviews: 0,
    unacknowledgedCritical: 0,
    referralFailures: 0,
    abnormalResultsUnreviewed: 0,
    referralsWithoutFollowUp: 0,
    medicationsOverdueMonitoring: 0,
  };

  it("raises nothing when nothing is unattended", () => {
    expect(safetyConcerns(base)).toEqual([]);
  });

  it("never raises an alarm about near misses being reported", () => {
    expect(safetyConcerns({ ...base, nearMisses90d: 27 })).toEqual([]);
  });

  it("leads with unacknowledged critical alerts", () => {
    const concerns = safetyConcerns({
      ...base,
      unacknowledgedCritical: 2,
      seriousIncidents: 1,
      overdueClinicalReviews: 18,
    });
    expect(concerns[0]).toMatch(/2 critical alerts nobody has picked up/);
    expect(concerns).toHaveLength(3);
  });

  it("reads naturally for a single item", () => {
    expect(safetyConcerns({ ...base, unacknowledgedCritical: 1 })[0]).toMatch(
      /1 critical alert nobody/,
    );
    expect(safetyConcerns({ ...base, seriousIncidents: 1 })[0]).toMatch(/1 serious incident still/);
  });

  it("does not treat open incidents or declined referrals as unattended on their own", () => {
    expect(safetyConcerns({ ...base, openIncidents: 12, referralFailures: 34 })).toEqual([]);
  });

  it("raises an alarm for unreviewed abnormal results", () => {
    expect(safetyConcerns({ ...base, abnormalResultsUnreviewed: 3 })[0]).toMatch(
      /3 abnormal results still unreviewed/,
    );
  });

  it("raises an alarm for referrals with a past appointment and no follow-up", () => {
    expect(safetyConcerns({ ...base, referralsWithoutFollowUp: 1 })[0]).toMatch(
      /1 referral with a past appointment/,
    );
  });

  it("raises an alarm for medications overdue for required monitoring", () => {
    expect(safetyConcerns({ ...base, medicationsOverdueMonitoring: 2 })[0]).toMatch(
      /2 medications overdue for required monitoring/,
    );
  });
});
