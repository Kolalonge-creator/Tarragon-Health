import { describe, expect, it } from "@jest/globals";
import { attentionWindows, buildAttention, buildKpis, countBy, daysUntil, filterDirectory, lagosToday } from "./attention";
import { maskNationalId, type DirectoryRow } from "./directory";

const TODAY = "2026-11-07";

function row(over: Partial<DirectoryRow> = {}): DirectoryRow {
  return {
    profile_id: "00000000-0000-4000-8000-000000000001",
    full_name: "Ada Obi",
    staff_number: "TH-001",
    role: "analyst",
    account_active: true,
    is_test: false,
    is_clinician: false,
    doctor_tier: null,
    clinician_status: null,
    clinician_employment_type: null,
    licence_expires_at: null,
    verification_satisfied: null,
    cleared_to_practise: null,
    indemnity_required: null,
    indemnity_expires_at: null,
    indemnity_exempt: false,
    has_employment_record: true,
    job_title: "Analyst",
    department_id: null,
    department_name: "Operations",
    line_manager_id: "00000000-0000-4000-8000-0000000000ff",
    line_manager_name: "Boss",
    engagement: "employed",
    work_pattern: "full_time",
    employment_status: "active",
    start_date: "2026-01-01",
    contract_end_date: null,
    contracted_hours_per_week: 40,
    work_location: "Lagos",
    has_emergency_contact: true,
    ...over,
  };
}

const kinds = (rows: DirectoryRow[]) => buildAttention(rows, TODAY).map((a) => a.kind);

describe("dates", () => {
  it("counts whole Lagos days, negative when past", () => {
    expect(daysUntil("2026-11-10", TODAY)).toBe(3);
    expect(daysUntil("2026-11-01", TODAY)).toBe(-6);
    // 23:30 UTC on the 7th is already the 8th in Lagos (UTC+1).
    expect(daysUntil("2026-11-07T23:30:00Z", TODAY)).toBe(1);
  });
  it("gives today's Lagos date", () => {
    expect(lagosToday(new Date("2026-11-07T23:30:00Z"))).toBe("2026-11-08");
  });
});

describe("buildAttention", () => {
  it("raises nothing for a complete, current record", () => {
    expect(kinds([row()])).toEqual([]);
  });

  it("flags a leaver who can still sign in, and nothing else about them", () => {
    expect(kinds([row({ employment_status: "left", contract_end_date: "2026-01-01", has_emergency_contact: false })])).toEqual([
      "left_but_account_active",
    ]);
    expect(kinds([row({ employment_status: "left", account_active: false })])).toEqual([]);
  });

  it("flags a missing employment record only for an active account", () => {
    const missing = { has_employment_record: false, employment_status: null, line_manager_id: null } as const;
    expect(kinds([row(missing)])).toEqual(["employment_record_missing"]);
    expect(kinds([row({ ...missing, account_active: false })])).toEqual([]);
  });

  it("warns 60 days before a contract ends and escalates once it has passed", () => {
    expect(kinds([row({ contract_end_date: "2026-12-20" })])).toEqual(["contract_ending"]);
    expect(kinds([row({ contract_end_date: "2027-03-01" })])).toEqual([]);
    expect(kinds([row({ contract_end_date: "2026-11-01" })])).toEqual(["contract_end_passed"]);
  });

  it("never treats an unverified clinician as compliant, using credentialing's own verdict", () => {
    const clin = row({ is_clinician: true, role: "clinician", clinician_status: "active", doctor_tier: "senior_medical_officer", verification_satisfied: false, cleared_to_practise: false, indemnity_required: false });
    expect(kinds([clin])).toEqual(["credential_unverified"]);
    expect(kinds([{ ...clin, verification_satisfied: true, cleared_to_practise: true }])).toEqual([]);
  });

  it("does not call a grandfathered, verified doctor unverified (live case 2026-11-07)", () => {
    // credential_verified_at was empty for these doctors; credentialing still counts them as verified and cleared.
    expect(kinds([row({ is_clinician: true, clinician_status: "active", verification_satisfied: true, cleared_to_practise: true, indemnity_required: false })])).toEqual([]);
  });

  it("raises 'not cleared' only when no more specific credential item explains it", () => {
    const clin = row({ is_clinician: true, clinician_status: "active", verification_satisfied: true, cleared_to_practise: false, indemnity_required: false });
    expect(kinds([clin])).toEqual(["not_cleared_for_clinical_work"]);
    expect(kinds([{ ...clin, licence_expires_at: "2026-10-01T00:00:00Z" }])).toEqual(["licence_expired"]);
    expect(kinds([{ ...clin, clinician_status: "suspended" }])).toEqual([]);
  });

  it("follows the licence expiry dates on clinical_staff", () => {
    const clin = row({ is_clinician: true, clinician_status: "active", verification_satisfied: true, cleared_to_practise: true, indemnity_required: false });
    expect(kinds([{ ...clin, licence_expires_at: "2026-10-01T00:00:00Z" }])).toEqual(["licence_expired"]);
    expect(kinds([{ ...clin, licence_expires_at: "2027-01-15T00:00:00Z" }])).toEqual(["licence_expiring"]);
    expect(kinds([{ ...clin, licence_expires_at: "2027-06-01T00:00:00Z" }])).toEqual([]);
  });

  it("tracks indemnity only where credentialing says it is required, and never for an exemption", () => {
    const clin = row({ is_clinician: true, clinician_status: "active", verification_satisfied: true, cleared_to_practise: true });
    expect(kinds([{ ...clin, indemnity_required: true }])).toEqual(["indemnity_not_recorded"]);
    expect(kinds([{ ...clin, indemnity_required: true, indemnity_expires_at: "2026-12-01T00:00:00Z" }])).toEqual(["indemnity_expiring"]);
    expect(kinds([{ ...clin, indemnity_required: false }])).toEqual([]);
    expect(kinds([{ ...clin, indemnity_required: true, indemnity_exempt: true }])).toEqual([]);
  });

  it("reads its warning windows from the registry", () => {
    expect(attentionWindows()).toEqual({ licence_warn_days: 90, indemnity_warn_days: 60, contract_warn_days: 60 });
    expect(buildAttention([row({ contract_end_date: "2026-11-20" })], TODAY, { licence_warn_days: 90, indemnity_warn_days: 60, contract_warn_days: 7 })).toEqual([]);
  });

  it("does not flag the person at the top for having no manager, but flags someone with neither", () => {
    const top = row({ profile_id: "00000000-0000-4000-8000-0000000000ff", line_manager_id: null });
    const report = row();
    const loner = row({ profile_id: "00000000-0000-4000-8000-000000000003", line_manager_id: null });
    expect(kinds([top, report])).toEqual([]);
    expect(kinds([top, report, loner])).toEqual(["no_line_manager"]);
  });

  it("orders high before medium before low, then by due date", () => {
    const items = buildAttention(
      [
        row({ profile_id: "00000000-0000-4000-8000-00000000000a", has_emergency_contact: false }),
        row({ profile_id: "00000000-0000-4000-8000-00000000000b", contract_end_date: "2026-12-20" }),
        row({ profile_id: "00000000-0000-4000-8000-00000000000c", contract_end_date: "2026-11-01" }),
      ],
      TODAY
    );
    expect(items.map((i) => i.priority)).toEqual(["high", "medium", "low"]);
  });
});

describe("buildKpis", () => {
  it("counts working staff only, and people with a credential issue once each", () => {
    const rows = [
      row(),
      row({ profile_id: "00000000-0000-4000-8000-000000000002", is_clinician: true, clinician_status: "active", verification_satisfied: false, cleared_to_practise: false, indemnity_required: true }),
      row({ profile_id: "00000000-0000-4000-8000-000000000003", employment_status: "onboarding" }),
      row({ profile_id: "00000000-0000-4000-8000-000000000004", employment_status: "left", account_active: false }),
      row({ profile_id: "00000000-0000-4000-8000-000000000005", employment_status: "suspended" }),
    ];
    const k = buildKpis(rows, buildAttention(rows, TODAY));
    expect(k).toEqual({ activeStaff: 2, activeClinical: 1, activeNonClinical: 1, onboarding: 1, credentialsNeedingAttention: 1 });
  });
});

describe("countBy and filterDirectory", () => {
  it("counts missing values as not recorded", () => {
    expect(countBy([row(), row({ department_name: null })], (r) => r.department_name)).toEqual([
      { label: "Not recorded", count: 1 },
      { label: "Operations", count: 1 },
    ]);
  });
  it("hides test accounts by default and filters by search, status and clinical", () => {
    const rows = [row(), row({ profile_id: "00000000-0000-4000-8000-000000000002", is_test: true }), row({ profile_id: "00000000-0000-4000-8000-000000000003", full_name: "Bola", is_clinician: true, has_employment_record: false, employment_status: null })];
    expect(filterDirectory(rows, {})).toHaveLength(2);
    expect(filterDirectory(rows, { includeTest: true })).toHaveLength(3);
    expect(filterDirectory(rows, { q: "bola" }).map((r) => r.full_name)).toEqual(["Bola"]);
    expect(filterDirectory(rows, { status: "no_record" }).map((r) => r.full_name)).toEqual(["Bola"]);
    expect(filterDirectory(rows, { clinical: "non_clinical" }).map((r) => r.full_name)).toEqual(["Ada Obi"]);
  });
});

describe("maskNationalId", () => {
  it("shows only the last four digits", () => {
    expect(maskNationalId("12345678901")).toBe("•••••••8901");
    expect(maskNationalId(null)).toBe("Not recorded");
  });
});
