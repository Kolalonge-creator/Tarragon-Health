import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BOOKING_STATE_LABEL,
  createEventSchema,
  ecgInterpretSchema,
  employerVisitRequestSchema,
  measurementsFormSchema,
  myPocResultsSchema,
  parseBpReading,
  seatsLabel,
  testingDayErrorText,
  urinalysisItemsFromForm,
  URINALYSIS_FIELDS,
  validateEcgFile,
} from "./model";

const MIGRATIONS = join(process.cwd(), "..", "..", "supabase", "migrations");
function migration(suffix: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`migration ending ${suffix} not found`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

describe("the strip scale mirrors the database seed", () => {
  it("poc_urinalysis v1 in the migration has exactly the fields and options the entry screen offers", () => {
    const sql = migration("_testing_days_employer_visits_point_of_care.sql");
    const match = /'poc_urinalysis', 1, true, \$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("urinalysis seed not found");
    const seed = JSON.parse(match[1]) as { code: string; kind: string; allowed?: string[] }[];
    expect(seed.map((a) => a.code)).toEqual(URINALYSIS_FIELDS.map((f) => f.code));
    for (const f of URINALYSIS_FIELDS) {
      const s = seed.find((a) => a.code === f.code)!;
      expect(s.kind).toBe(f.kind);
      if (f.kind === "ordinal") expect([...(s.allowed ?? [])]).toEqual([...f.options]);
    }
  });

  it("offers nothing for vitamin D, ferritin or PSA", () => {
    const text = JSON.stringify(URINALYSIS_FIELDS).toLowerCase();
    for (const banned of ["vitamin", "ferritin", "psa"]) expect(text).not.toContain(banned);
  });
});

describe("urinalysisItemsFromForm", () => {
  const form = (entries: Record<string, string>) => ({ get: (k: string) => entries[k] ?? null });
  it("sends values only, skips blanks, and never sends a flag", () => {
    const items = urinalysisItemsFromForm(form({ u_glucose: "2+", u_protein: "", u_ph: "6.5", u_nitrite: "negative", u_flag: "normal" }));
    expect(items).toEqual([
      { analyte_code: "glucose", value_text: "2+" },
      { analyte_code: "ph", value_numeric: 6.5 },
      { analyte_code: "nitrite", value_text: "negative" },
    ]);
    expect(JSON.stringify(items)).not.toContain("flag");
  });
  it("drops a numeric field that is not a number", () => {
    expect(urinalysisItemsFromForm(form({ u_ph: "abc" }))).toEqual([]);
  });
});

describe("parseBpReading", () => {
  it("reads 120/80", () => expect(parseBpReading("120/80")).toEqual({ systolic: 120, diastolic: 80 }));
  it("allows spaces around the slash", () => expect(parseBpReading(" 135 / 85 ")).toEqual({ systolic: 135, diastolic: 85 }));
  it("blank is not a reading", () => expect(parseBpReading("")).toBeNull());
  it.each(["12080", "80/120", "301/20", "abc", "120/"])("rejects %s", (v) => expect(parseBpReading(v)).toBe("invalid"));
});

describe("forms", () => {
  it("measurements accept blanks and reject out-of-range numbers", () => {
    const base = { bookingId: "11111111-1111-4111-8111-111111111111" };
    expect(measurementsFormSchema.safeParse({ ...base, heightCm: "", weightKg: "70" }).success).toBe(true);
    expect(measurementsFormSchema.safeParse({ ...base, spo2Pct: "140" }).success).toBe(false);
    expect(measurementsFormSchema.safeParse({ ...base, glucoseMmolL: "0.1" }).success).toBe(false);
  });
  it("an ECG interpretation needs words and a class", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(ecgInterpretSchema.safeParse({ recordingId: id, interpretationClass: "normal", interpretation: "  " }).success).toBe(false);
    expect(ecgInterpretSchema.safeParse({ recordingId: id, interpretationClass: "machine_says_ok", interpretation: "fine" }).success).toBe(false);
    expect(ecgInterpretSchema.safeParse({ recordingId: id, interpretationClass: "normal", interpretation: "Normal sinus rhythm." }).success).toBe(true);
  });
  it("a testing event needs a date, a venue, a city and a sensible capacity", () => {
    const ok = { kind: "public_day", eventDate: "2026-11-07", venueName: "Yaba Hall", address: "1 Yaba Rd", city: "Lagos", capacity: "30" };
    expect(createEventSchema.safeParse(ok).success).toBe(true);
    expect(createEventSchema.safeParse({ ...ok, capacity: "0" }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...ok, capacity: "9999" }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...ok, eventDate: "07/11/2026" }).success).toBe(false);
  });
  it("an employer visit request needs a headcount", () => {
    const ok = { eventDate: "2026-11-07", address: "5 Industrial Rd", city: "Lagos", headcount: "25" };
    expect(employerVisitRequestSchema.safeParse(ok).success).toBe(true);
    expect(employerVisitRequestSchema.safeParse({ ...ok, headcount: "" }).success).toBe(false);
  });
});

describe("ECG files", () => {
  it("accepts a PDF, PNG, JPG or XML trace under 20 MB", () => {
    for (const type of ["application/pdf", "image/png", "image/jpeg", "application/xml"]) expect(validateEcgFile({ type, size: 1000 })).toBeNull();
  });
  it("refuses an executable, an empty file and an oversized one", () => {
    expect(validateEcgFile({ type: "application/x-msdownload", size: 10 })).not.toBeNull();
    expect(validateEcgFile({ type: "application/pdf", size: 0 })).not.toBeNull();
    expect(validateEcgFile({ type: "application/pdf", size: 21 * 1024 * 1024 })).not.toBeNull();
  });
});

describe("plain words", () => {
  it("turns a database code into a sentence and never passes an unknown message through", () => {
    expect(testingDayErrorText("membership_required")).toBe("Testing days are part of Membership.");
    expect(testingDayErrorText('duplicate key value violates unique constraint "x"')).toBe("Something went wrong. Please try again.");
    expect(testingDayErrorText(null)).toBe("Something went wrong. Please try again.");
  });
  it("labels seats", () => {
    expect(seatsLabel({ seats_left: 1, full: false })).toBe("1 place left");
    expect(seatsLabel({ seats_left: 12, full: false })).toBe("12 places left");
    expect(seatsLabel({ seats_left: 0, full: true })).toMatch(/waiting list/);
  });
  it("no booking label or error names a test, a result or a condition", () => {
    const text = [...Object.values(BOOKING_STATE_LABEL), testingDayErrorText("membership_required"), testingDayErrorText("new_day_full_keep_current")].join(" ");
    expect(text).not.toMatch(/hiv|hepatitis|blood|ecg|urine|glucose|result|positive|diabet/i);
  });
});

describe("what a patient is given back", () => {
  it("has no field for the machine's own ECG statement", () => {
    const parsed = myPocResultsSchema.parse({
      results: [],
      ecgs: [{ id: "11111111-1111-4111-8111-111111111111", interpreted_at: null, interpretation_class: "normal", interpretation: "ok", machine_statement: "Sinus rhythm" }],
    });
    expect(JSON.stringify(parsed)).not.toContain("machine_statement");
  });
});
