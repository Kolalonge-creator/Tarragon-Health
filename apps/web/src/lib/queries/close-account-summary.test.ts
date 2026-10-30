import { CLOSE_ACCOUNT_KEPT, closeAccountSummaryLines, closeAccountSummarySchema } from "./close-account-summary";

describe("close account summary", () => {
  const reply = {
    closed: true,
    already_closed: false,
    removed: { patient_home_layout: 1, vitals_reminder_rules: 2, some_new_table: 3 },
    ended: { care_circle_members: 1, profile_access: 2 },
    contact_details_removed: true,
    left_alone_append_only: ["wellness_points_ledger"],
    kept_classes: ["audit", "clinical_record"],
  };

  it("reads the database reply", () => {
    expect(closeAccountSummarySchema.safeParse(reply).success).toBe(true);
  });

  it("rejects an empty or changed reply instead of showing it as 'nothing removed'", () => {
    expect(closeAccountSummarySchema.safeParse(null).success).toBe(false);
    expect(closeAccountSummarySchema.safeParse({ closed: true }).success).toBe(false);
  });

  it("lists what was removed and ended in plain words, with a fallback for a new table", () => {
    const lines = closeAccountSummaryLines(closeAccountSummarySchema.parse(reply));
    expect(lines).toContain("1 home screen layout removed");
    expect(lines).toContain("2 reading reminders removed");
    expect(lines).toContain("3 some new table removed");
    expect(lines).toContain("1 Care Circle members (access ended)");
    expect(lines.some((l) => l.startsWith("Contact details and sign-in removed"))).toBe(true);
  });

  it("always says that clinical records, the audit log and the ledger are kept", () => {
    const text = CLOSE_ACCOUNT_KEPT.join(" ").toLowerCase();
    expect(text).toContain("clinical records");
    expect(text).toContain("audit log");
    expect(text).toContain("ledger");
    expect(text).toContain("never deleted");
  });
});
