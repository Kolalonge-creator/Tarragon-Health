import { describe, expect, it } from "@jest/globals";
import {
  compareSafeguardingConcerns,
  safeguardingCategoryVariant,
  type RankableConcern,
} from "./safeguarding-rank";
import {
  compareLifestyleFlags,
  lifestyleSeverityLabel,
  lifestyleSeverityVariant,
  type RankableFlag,
} from "./lifestyle-flag-rank";
import { compareResultRows, isHighSeverityResult } from "./results-inbox-rank";

describe("compareSafeguardingConcerns", () => {
  const concern = (o: Partial<RankableConcern>): RankableConcern => ({
    status: "open",
    concern_category: "other",
    created_at: "2026-09-01T00:00:00.000Z",
    ...o,
  });

  it("puts an open immediate-safety-risk above a closed case raised more recently", () => {
    const closedToday = concern({ status: "closed", created_at: "2026-09-05T09:00:00.000Z" });
    const openRiskYesterday = concern({
      concern_category: "immediate_safety_risk",
      created_at: "2026-09-04T09:00:00.000Z",
    });
    expect([closedToday, openRiskYesterday].sort(compareSafeguardingConcerns)).toEqual([
      openRiskYesterday,
      closedToday,
    ]);
  });

  it("ranks immediate safety risk above child safety above needs-triage", () => {
    const rows = [
      concern({ concern_category: "other" }),
      concern({ concern_category: "child_safety" }),
      concern({ concern_category: "immediate_safety_risk" }),
    ];
    expect(rows.sort(compareSafeguardingConcerns).map((c) => c.concern_category)).toEqual([
      "immediate_safety_risk",
      "child_safety",
      "other",
    ]);
  });

  it("shows the oldest open concern of equal severity first", () => {
    const older = concern({ created_at: "2026-08-01T00:00:00.000Z" });
    const newer = concern({ created_at: "2026-09-01T00:00:00.000Z" });
    expect([newer, older].sort(compareSafeguardingConcerns)).toEqual([older, newer]);
  });
});

describe("safeguardingCategoryVariant", () => {
  it("does not badge every category red", () => {
    expect(safeguardingCategoryVariant("immediate_safety_risk", "open")).toBe("red");
    expect(safeguardingCategoryVariant("neglect", "open")).toBe("amber");
    expect(safeguardingCategoryVariant("immediate_safety_risk", "closed")).toBe("grey");
  });
});

describe("compareLifestyleFlags", () => {
  const flag = (o: Partial<RankableFlag>): RankableFlag => ({
    severity: "amber",
    escalationLevel: 1,
    openedAt: "2026-09-01T00:00:00.000Z",
    ...o,
  });

  it("puts today's emergency above last week's amber", () => {
    const lastWeekAmber = flag({ openedAt: "2026-08-29T00:00:00.000Z" });
    const todayEmergency = flag({ severity: "emergency", openedAt: "2026-09-05T08:00:00.000Z" });
    expect([lastWeekAmber, todayEmergency].sort(compareLifestyleFlags)).toEqual([
      todayEmergency,
      lastWeekAmber,
    ]);
  });

  it("breaks a severity tie on escalation level, then age", () => {
    const lowLevel = flag({ severity: "red", escalationLevel: 1 });
    const highLevel = flag({ severity: "red", escalationLevel: 3 });
    expect([lowLevel, highLevel].sort(compareLifestyleFlags)).toEqual([highLevel, lowLevel]);
  });
});

describe("lifestyle severity presentation", () => {
  it("labels emergency distinctly even though it shares the red chip", () => {
    expect(lifestyleSeverityVariant("emergency")).toBe("red");
    expect(lifestyleSeverityVariant("red")).toBe("red");
    expect(lifestyleSeverityLabel("emergency")).toBe("Emergency");
    expect(lifestyleSeverityLabel("red")).toBe("Red flag");
  });
});

describe("compareResultRows", () => {
  it("puts an emergency result above a routine one uploaded earlier", () => {
    const oldRoutine = {
      created_at: "2026-09-01T00:00:00.000Z",
      clinician_alert: { level: "routine" as const },
    };
    const newEmergency = {
      created_at: "2026-09-05T08:00:00.000Z",
      clinician_alert: { level: "emergency" as const },
    };
    expect([oldRoutine, newEmergency].sort(compareResultRows)).toEqual([newEmergency, oldRoutine]);
  });

  it("sorts an unclassified document behind every classified one rather than guessing routine", () => {
    const unclassified = { created_at: "2026-08-01T00:00:00.000Z", clinician_alert: null };
    const routine = {
      created_at: "2026-09-05T00:00:00.000Z",
      clinician_alert: { level: "routine" as const },
    };
    expect([unclassified, routine].sort(compareResultRows)).toEqual([routine, unclassified]);
  });

  it("keeps oldest-first within one severity", () => {
    const older = {
      created_at: "2026-09-01T00:00:00.000Z",
      clinician_alert: { level: "clinician_review" as const },
    };
    const newer = {
      created_at: "2026-09-04T00:00:00.000Z",
      clinician_alert: { level: "clinician_review" as const },
    };
    expect([newer, older].sort(compareResultRows)).toEqual([older, newer]);
  });

  it("treats emergency/specialist/urgent as needing attention ahead of the routine backlog", () => {
    expect(isHighSeverityResult({ created_at: "", clinician_alert: { level: "emergency" } })).toBe(true);
    expect(
      isHighSeverityResult({ created_at: "", clinician_alert: { level: "urgent_escalation" } })
    ).toBe(true);
    expect(
      isHighSeverityResult({ created_at: "", clinician_alert: { level: "clinician_review" } })
    ).toBe(false);
    expect(isHighSeverityResult({ created_at: "", clinician_alert: null })).toBe(false);
  });
});
