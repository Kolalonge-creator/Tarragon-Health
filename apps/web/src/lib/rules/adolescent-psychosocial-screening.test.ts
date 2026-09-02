import { scoreAdolescentPsychosocialScreen, type AdolescentPsychosocialAnswers } from "./adolescent-psychosocial-screening";

const BASE: AdolescentPsychosocialAnswers = {
  homeFeelsSafe: "yes",
  homeHurtOrThreatened: "no",
  educationNote: "",
  daysActivePerWeek: 3,
  sleepHoursPerNight: 8,
  substanceUseLastMonth: "no",
  sexualHealthSupportRequested: "no",
  selfHarmThoughts: "no",
  unsafeElsewhere: "no",
  immediateDanger: "no",
  notes: "",
};

describe("scoreAdolescentPsychosocialScreen", () => {
  it("raises no flags for a reassuring check-in", () => {
    const result = scoreAdolescentPsychosocialScreen(BASE);
    expect(result.selfHarmFlagged).toBe(false);
    expect(result.immediateDangerFlagged).toBe(false);
    expect(result.abuseNeglectExploitationFlagged).toBe(false);
    expect(result.substanceUseConcernFlagged).toBe(false);
    expect(result.sexualHealthFollowUpRequested).toBe(false);
  });

  it("flags self-harm only from the suicide/depression domain", () => {
    const result = scoreAdolescentPsychosocialScreen({ ...BASE, selfHarmThoughts: "yes" });
    expect(result.selfHarmFlagged).toBe(true);
    expect(result.immediateDangerFlagged).toBe(false);
    expect(result.abuseNeglectExploitationFlagged).toBe(false);
  });

  it("flags immediate danger independently of self-harm", () => {
    const result = scoreAdolescentPsychosocialScreen({ ...BASE, immediateDanger: "yes" });
    expect(result.immediateDangerFlagged).toBe(true);
    expect(result.selfHarmFlagged).toBe(false);
  });

  it("flags a possible safeguarding concern from any of the three Home/Safety signals", () => {
    expect(
      scoreAdolescentPsychosocialScreen({ ...BASE, homeFeelsSafe: "no" }).abuseNeglectExploitationFlagged
    ).toBe(true);
    expect(
      scoreAdolescentPsychosocialScreen({ ...BASE, homeHurtOrThreatened: "yes" })
        .abuseNeglectExploitationFlagged
    ).toBe(true);
    expect(
      scoreAdolescentPsychosocialScreen({ ...BASE, unsafeElsewhere: "yes" }).abuseNeglectExploitationFlagged
    ).toBe(true);
  });

  it("flags substance use and sexual-health follow-up independently", () => {
    const result = scoreAdolescentPsychosocialScreen({
      ...BASE,
      substanceUseLastMonth: "yes",
      sexualHealthSupportRequested: "yes",
    });
    expect(result.substanceUseConcernFlagged).toBe(true);
    expect(result.sexualHealthFollowUpRequested).toBe(true);
    expect(result.selfHarmFlagged).toBe(false);
    expect(result.abuseNeglectExploitationFlagged).toBe(false);
  });

  it("carries every domain into domainResponses for the clinician record", () => {
    const result = scoreAdolescentPsychosocialScreen({ ...BASE, educationNote: "Struggling with maths" });
    expect(result.domainResponses).toMatchObject({
      home: { feels_safe: "yes", hurt_or_threatened: "no" },
      education: { note: "Struggling with maths" },
      eating_activity: { days_active_per_week: 3, sleep_hours_per_night: 8 },
      drugs_alcohol: { used_last_month: "no" },
      sexuality: { support_requested: "no" },
      suicide_depression: { self_harm_thoughts: "no" },
      safety: { unsafe_elsewhere: "no", immediate_danger: "no" },
    });
  });
});
