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
