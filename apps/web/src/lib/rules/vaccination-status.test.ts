import { describe, expect, it } from "@jest/globals";
import {
  computeVaccinationStatuses,
  type VaccinationCatalogRow,
  type VaccinationRecordRow,
} from "./vaccination-status";

const today = new Date("2026-07-06T00:00:00.000Z");

const TETANUS: VaccinationCatalogRow = {
  id: "tetanus-id",
  code: "tetanus_td_booster",
  name: "Tetanus/Td Booster",
  recommended_age: { interval_years: 10 },
};

const HEP_B: VaccinationCatalogRow = {
  id: "hepb-id",
  code: "hepatitis_b",
  name: "Hepatitis B",
  recommended_age: { dose_schedule_months: [0, 1, 6] },
};

const YELLOW_FEVER: VaccinationCatalogRow = {
  id: "yf-id",
  code: "yellow_fever",
  name: "Yellow Fever",
  recommended_age: { doses: 1 },
};

const HPV: VaccinationCatalogRow = {
  id: "hpv-id",
  code: "hpv",
  name: "HPV",
  recommended_age: { max_catch_up_age: 26 },
};

const SHINGLES: VaccinationCatalogRow = {
  id: "shingles-id",
  code: "shingles",
  name: "Shingles",
  recommended_age: { min_age: 50 },
};

function record(catalogId: string, doseNumber: number, dateAdministered: string): VaccinationRecordRow {
  return { vaccination_catalog_id: catalogId, dose_number: doseNumber, date_administered: dateAdministered };
}

describe("computeVaccinationStatuses", () => {
  it("marks a recurring vaccine due when never given", () => {
    const [result] = computeVaccinationStatuses([TETANUS], [], { ageYears: 40 }, today);
    expect(result.status).toBe("due");
    expect(result.nextDueDate).toBe("2026-07-06");
  });

  it("marks a recurring vaccine up to date within the interval", () => {
    const records = [record("tetanus-id", 1, "2020-01-06")];
    const [result] = computeVaccinationStatuses([TETANUS], records, { ageYears: 40 }, today);
    expect(result.status).toBe("up_to_date");
    expect(result.nextDueDate).toBe("2030-01-06");
  });

  it("marks a recurring vaccine overdue once the interval has passed", () => {
    const records = [record("tetanus-id", 1, "2010-01-06")];
    const [result] = computeVaccinationStatuses([TETANUS], records, { ageYears: 40 }, today);
    expect(result.status).toBe("overdue");
    expect(result.nextDueDate).toBe("2020-01-06");
  });

  it("starts a dose series due today when no doses are recorded", () => {
    const [result] = computeVaccinationStatuses([HEP_B], [], { ageYears: 30 }, today);
    expect(result.status).toBe("due");
    expect(result.dosesGiven).toBe(0);
  });

  it("computes the next dose in a series from the first dose date", () => {
    const records = [record("hepb-id", 1, "2026-06-06")];
    const [result] = computeVaccinationStatuses([HEP_B], records, { ageYears: 30 }, today);
    // dose 2 due 1 month after the first dose
    expect(result.status).toBe("due");
    expect(result.nextDueDate).toBe("2026-07-06");
  });

  it("marks a completed dose series up to date with no further due date", () => {
    const records = [
      record("hepb-id", 1, "2020-01-01"),
      record("hepb-id", 2, "2020-02-01"),
      record("hepb-id", 3, "2020-07-01"),
    ];
    const [result] = computeVaccinationStatuses([HEP_B], records, { ageYears: 30 }, today);
    expect(result.status).toBe("up_to_date");
    expect(result.nextDueDate).toBeNull();
  });

  it("treats a fixed-dose-count vaccine as due with no age gate", () => {
    const [result] = computeVaccinationStatuses([YELLOW_FEVER], [], { ageYears: null }, today);
    expect(result.status).toBe("due");
  });

  it("treats a fixed-dose-count vaccine as up to date once given", () => {
    const records = [record("yf-id", 1, "2019-01-01")];
    const [result] = computeVaccinationStatuses([YELLOW_FEVER], records, { ageYears: 40 }, today);
    expect(result.status).toBe("up_to_date");
  });

  it("marks a catch-up vaccine due while within the eligible age window", () => {
    const [result] = computeVaccinationStatuses([HPV], [], { ageYears: 22 }, today);
    expect(result.status).toBe("due");
  });

  it("marks a catch-up vaccine not applicable once past the eligible age window", () => {
    const [result] = computeVaccinationStatuses([HPV], [], { ageYears: 30 }, today);
    expect(result.status).toBe("not_applicable");
  });

  it("marks a catch-up vaccine not yet due when age is unknown", () => {
    const [result] = computeVaccinationStatuses([HPV], [], { ageYears: null }, today);
    expect(result.status).toBe("not_yet_due");
  });

  it("marks a minimum-age vaccine not yet due below the threshold", () => {
    const [result] = computeVaccinationStatuses([SHINGLES], [], { ageYears: 45 }, today);
    expect(result.status).toBe("not_yet_due");
  });

  it("marks a minimum-age vaccine due once the threshold is reached", () => {
    const [result] = computeVaccinationStatuses([SHINGLES], [], { ageYears: 52 }, today);
    expect(result.status).toBe("due");
  });

  it("clamps month arithmetic instead of rolling into the next month", () => {
    const janThirtyFirst: VaccinationCatalogRow = {
      id: "x",
      code: "x",
      name: "X",
      recommended_age: { dose_schedule_months: [0, 1] },
    };
    const records = [record("x", 1, "2026-01-31")];
    const [result] = computeVaccinationStatuses(
      [janThirtyFirst],
      records,
      { ageYears: 30 },
      new Date("2026-02-01T00:00:00.000Z")
    );
    // Feb has 28 days in 2026 — must clamp to 2026-02-28, not roll to 2026-03-03
    expect(result.nextDueDate).toBe("2026-02-28");
  });
});

// ---------------------------------------------------------------------------
// NPHCDA childhood schedule — the DOB-anchored age_schedule_weeks shape
// (child immunization card, 2026-07-23).
// ---------------------------------------------------------------------------

const PENTA: VaccinationCatalogRow = {
  id: "penta-id",
  code: "child_penta",
  name: "Pentavalent",
  recommended_age: { age_schedule_weeks: [6, 10, 14], max_age_years: 5 },
};

const BCG: VaccinationCatalogRow = {
  id: "bcg-id",
  code: "child_bcg",
  name: "BCG",
  recommended_age: { age_schedule_weeks: [0], max_age_years: 5 },
};

const HPV_GIRLS: VaccinationCatalogRow = {
  id: "hpvg-id",
  code: "child_hpv_girls",
  name: "HPV (girls 9-14)",
  recommended_age: { age_schedule_weeks: [469], max_age_years: 14, sex: "female" },
};

describe("computeVaccinationStatuses — age_schedule_weeks (NPHCDA child schedule)", () => {
  it("marks BCG due on the day of birth", () => {
    const [r] = computeVaccinationStatuses([BCG], [], {
      ageYears: 0,
      dateOfBirth: "2026-07-06",
    }, today);
    expect(r.status).toBe("due");
    expect(r.nextDueDate).toBe("2026-07-06");
  });

  it("computes penta dose 1 as overdue for an 8-week-old, anchored to DOB + 6 weeks", () => {
    const dob = "2026-05-11"; // 8 weeks before 2026-07-06
    const [r] = computeVaccinationStatuses([PENTA], [], { ageYears: 0, dateOfBirth: dob }, today);
    expect(r.status).toBe("overdue");
    expect(r.nextDueDate).toBe("2026-06-22"); // dob + 42 days
  });

  it("advances to the next dose from the DOB anchor, not the last-dose date", () => {
    const dob = "2026-03-01";
    const records: VaccinationRecordRow[] = [
      { vaccination_catalog_id: "penta-id", dose_number: 1, date_administered: "2026-04-15" },
    ];
    const [r] = computeVaccinationStatuses([PENTA], records, { ageYears: 0, dateOfBirth: dob }, today);
    expect(r.dosesGiven).toBe(1);
    expect(r.nextDueDate).toBe("2026-05-10"); // dob + 10 weeks, regardless of dose-1 date
  });

  it("shows not_yet_due with the future date for a dose that hasn't come up", () => {
    const dob = "2026-07-01"; // 5 days old — penta starts at 6 weeks
    const [r] = computeVaccinationStatuses([PENTA], [], { ageYears: 0, dateOfBirth: dob }, today);
    expect(r.status).toBe("not_yet_due");
    expect(r.nextDueDate).toBe("2026-08-12");
  });

  it("is up_to_date once every scheduled dose is recorded", () => {
    const records: VaccinationRecordRow[] = [1, 2, 3].map((n) => ({
      vaccination_catalog_id: "penta-id",
      dose_number: n,
      date_administered: `2026-0${n}-01`,
    }));
    const [r] = computeVaccinationStatuses([PENTA], records, {
      ageYears: 1,
      dateOfBirth: "2025-07-06",
    }, today);
    expect(r.status).toBe("up_to_date");
  });

  it("never puts childhood vaccines on an adult's card (max_age_years window)", () => {
    const [r] = computeVaccinationStatuses([PENTA], [], {
      ageYears: 41,
      dateOfBirth: "1985-01-01",
    }, today);
    expect(r.status).toBe("not_applicable");
  });

  it("excludes sex-restricted vaccines only on a confirmed mismatch", () => {
    const boy = computeVaccinationStatuses([HPV_GIRLS], [], {
      ageYears: 10,
      dateOfBirth: "2016-07-06",
      sex: "male",
    }, today)[0];
    expect(boy.status).toBe("not_applicable");

    const unknown = computeVaccinationStatuses([HPV_GIRLS], [], {
      ageYears: 10,
      dateOfBirth: "2016-07-06",
      sex: null,
    }, today)[0];
    expect(unknown.status).not.toBe("not_applicable");
  });

  it("degrades to not_yet_due when DOB is unknown instead of guessing", () => {
    const [r] = computeVaccinationStatuses([PENTA], [], { ageYears: 0 }, today);
    expect(r.status).toBe("not_yet_due");
  });
});
