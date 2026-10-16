import { describe, expect, it } from "@jest/globals";
import {
  closePilotSchema,
  confirmPaymentSchema,
  createPilotSchema,
  nairaFromKobo,
  parsePilotReport,
  pilotErrorText,
  pilotReportToCsv,
} from "./model";

const ID = "6f1d6c1e-4f5e-4a52-9d57-2a3c1d3b8f10";

const shown = {
  pilot: { id: ID, state: "active", starts_on: "2026-11-02", ends_on: "2026-12-02", terms_version: "terms-v1", total_kobo: 120000000, seat_price_kobo: 10000000 },
  seats: { purchased: 12, claimed: 12, active: 11, unclaimed: 0, claims_without_seat: 2 },
  usage: { suppressed: false, members_with_consultation: 5, consultations_completed: 10, members_with_check_in: null },
  min_cell: 5,
  rounded_to: 5,
  usage_through: "2026-11-08",
  generated_at: "2026-11-10T09:00:00Z",
};

describe("pilot report parsing (I9: a closed shape)", () => {
  it("accepts the report the database returns", () => {
    expect(parsePilotReport(shown)).not.toBeNull();
  });

  it("drops any key the shape does not name, so a per-person field can never pass through", () => {
    const parsed = parsePilotReport({ ...shown, members: [{ name: "Ada Obi", phone: "+2348000000000" }], seats: { ...shown.seats, patient_id: ID } });
    expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed)).not.toContain("Ada Obi");
    expect(JSON.stringify(parsed)).not.toContain("+2348000000000");
    expect(JSON.stringify(parsed)).not.toContain("patient_id");
  });

  it("rejects negative or fractional counts and a malformed payload", () => {
    expect(parsePilotReport({ ...shown, seats: { ...shown.seats, claimed: -1 } })).toBeNull();
    expect(parsePilotReport({ ...shown, seats: { ...shown.seats, claimed: 1.5 } })).toBeNull();
    expect(parsePilotReport(null)).toBeNull();
    expect(parsePilotReport("nope")).toBeNull();
  });

  it("accepts the suppressed usage block with no figures", () => {
    const parsed = parsePilotReport({ ...shown, usage: { suppressed: true, reason: "too_few_members" } });
    expect(parsed?.usage.suppressed).toBe(true);
  });
});

describe("CSV export is the same aggregate and nothing more", () => {
  it("has only label, value and note columns and withholds a suppressed figure", () => {
    const parsed = parsePilotReport(shown);
    if (!parsed) throw new Error("fixture must parse");
    const csv = pilotReportToCsv(parsed);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Measure,Value,Note");
    expect(csv).toContain("Members who logged a check-in,withheld,");
    expect(csv).toContain("Members who had a consultation,5,");
    expect(csv).not.toContain(ID);
    for (const line of lines.slice(1)) expect(line.split(",").length).toBeGreaterThanOrEqual(3);
  });

  it("writes every usage line as withheld when usage is suppressed", () => {
    const parsed = parsePilotReport({ ...shown, usage: { suppressed: true, reason: "too_few_members" } });
    if (!parsed) throw new Error("fixture must parse");
    const csv = pilotReportToCsv(parsed);
    expect(csv).toContain("Members who had a consultation,withheld,");
    expect(csv).toContain("Consultations completed,withheld,");
    expect(csv).toContain("Members who logged a check-in,withheld,");
  });

  it("neutralises spreadsheet formulas in any text cell", () => {
    const parsed = parsePilotReport({ ...shown, pilot: { ...shown.pilot, terms_version: "=HYPERLINK(\"http://x\")" } });
    if (!parsed) throw new Error("fixture must parse");
    expect(pilotReportToCsv(parsed)).toContain("'=HYPERLINK");
  });
});

describe("money and form helpers", () => {
  it("shows integer kobo as whole naira", () => {
    expect(nairaFromKobo(120000000)).toBe("NGN 1,200,000");
    expect(nairaFromKobo(10000000)).toBe("NGN 100,000");
    expect(nairaFromKobo(4999950)).toBe("NGN 49,999.50");
    expect(nairaFromKobo(4999905)).toBe("NGN 49,999.05");
  });

  it("validates the create form", () => {
    const ok = createPilotSchema.safeParse({ organisationId: ID, benefitPackageId: ID, seats: "12", startsOn: "2026-11-02", endsOn: "2026-12-02", termsVersion: "terms-v1" });
    expect(ok.success).toBe(true);
    expect(createPilotSchema.safeParse({ organisationId: ID, benefitPackageId: ID, seats: "0", startsOn: "2026-11-02", endsOn: "2026-12-02", termsVersion: "t" }).success).toBe(false);
    expect(createPilotSchema.safeParse({ organisationId: ID, benefitPackageId: ID, seats: "2.5", startsOn: "2026-11-02", endsOn: "2026-12-02", termsVersion: "t" }).success).toBe(false);
    expect(createPilotSchema.safeParse({ organisationId: ID, benefitPackageId: ID, seats: "5", startsOn: "2026-12-02", endsOn: "2026-11-02", termsVersion: "t" }).success).toBe(false);
    expect(createPilotSchema.safeParse({ organisationId: ID, benefitPackageId: ID, seats: "5", startsOn: "2026-11-02", endsOn: "2026-12-02", termsVersion: " " }).success).toBe(false);
  });

  it("validates payment confirmation and closing", () => {
    expect(confirmPaymentSchema.safeParse({ pilotId: ID, method: "paystack_link", reference: "PSK-1001" }).success).toBe(true);
    expect(confirmPaymentSchema.safeParse({ pilotId: ID, method: "cash", reference: "PSK-1001" }).success).toBe(false);
    expect(confirmPaymentSchema.safeParse({ pilotId: ID, method: "bank_transfer", reference: "ab" }).success).toBe(false);
    expect(closePilotSchema.safeParse({ pilotId: ID, reason: "too short" }).success).toBe(false);
    expect(closePilotSchema.safeParse({ pilotId: ID, reason: "Employer withdrew before paying" }).success).toBe(true);
  });

  it("turns database errors into plain words and never echoes raw SQL text", () => {
    expect(pilotErrorText("pilot_not_authorised")).toBe("Only finance can do this.");
    expect(pilotErrorText('duplicate key value violates unique constraint "employer_seat_pilots_payment_reference_key"')).toMatch(/already been used/);
    expect(pilotErrorText('relation "x" does not exist')).toBe("Something went wrong. Please try again.");
    expect(pilotErrorText(undefined)).toBe("Something went wrong. Please try again.");
  });
});
