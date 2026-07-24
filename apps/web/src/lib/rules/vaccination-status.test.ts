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

  describe("a min_age-gated dose series (e.g. shingles/Shingrix, a real 2-dose vaccine from age 50)", () => {
    const SHINGLES_RZV: VaccinationCatalogRow = {
      id: "shingles-id",
      code: "shingles",
      name: "Shingles",
      recommended_age: { min_age: 50, dose_schedule_months: [0, 2] },
    };

    it("is not yet due below the minimum age, even with zero doses logged", () => {
      const [result] = computeVaccinationStatuses([SHINGLES_RZV], [], { ageYears: 45 }, today);
      expect(result.status).toBe("not_yet_due");
    });

    it("is not yet due when age is unknown", () => {
      const [result] = computeVaccinationStatuses([SHINGLES_RZV], [], { ageYears: null }, today);
      expect(result.status).toBe("not_yet_due");
    });

    it("becomes due for dose 1 once the minimum age is reached", () => {
      const [result] = computeVaccinationStatuses([SHINGLES_RZV], [], { ageYears: 52 }, today);
      expect(result.status).toBe("due");
      expect(result.dosesGiven).toBe(0);
    });

    it("schedules dose 2 from dose 1's date, not the minimum age gate, once started", () => {
      const records = [record("shingles-id", 1, "2026-05-06")];
      const [result] = computeVaccinationStatuses([SHINGLES_RZV], records, { ageYears: 52 }, today);
      // dose 2 due 2 months after dose 1 = 2026-07-06, which is today
      expect(result.status).toBe("due");
      expect(result.nextDueDate).toBe("2026-07-06");
    });

    it("marks the full 2-dose series complete with no further due date", () => {
      const records = [
        record("shingles-id", 1, "2024-01-01"),
        record("shingles-id", 2, "2024-03-01"),
      ];
      const [result] = computeVaccinationStatuses([SHINGLES_RZV], records, { ageYears: 52 }, today);
      expect(result.status).toBe("up_to_date");
      expect(result.nextDueDate).toBeNull();
    });
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

  it("computes an exact due date for a DOB-anchored infant dose from date of birth", () => {
    const PENTA: VaccinationCatalogRow = {
      id: "penta-id",
      code: "child_penta",
      name: "Pentavalent (DTP-HepB-Hib)",
      recommended_age: { age_schedule_weeks: [6, 10, 14], max_age_years: 5 },
    };
    const [result] = computeVaccinationStatuses(
      [PENTA],
      [],
      { ageYears: 0, dateOfBirth: "2026-05-25" },
      today
    );
    // Dose 1 due at 6 weeks (42 days) from 2026-05-25 = 2026-07-06 (today)
    expect(result.status).toBe("due");
    expect(result.nextDueDate).toBe("2026-07-06");
  });

  it("rolls to the next dose in a DOB-anchored series once a dose is logged", () => {
    const PENTA: VaccinationCatalogRow = {
      id: "penta-id",
      code: "child_penta",
      name: "Pentavalent (DTP-HepB-Hib)",
      recommended_age: { age_schedule_weeks: [6, 10, 14], max_age_years: 5 },
    };
    const records = [record("penta-id", 1, "2026-06-06")];
    const [result] = computeVaccinationStatuses(
      [PENTA],
      records,
      { ageYears: 0, dateOfBirth: "2026-06-01" },
      today
    );
    // Dose 2 due at 10 weeks (70 days) from birth = 2026-08-10 — in the
    // future relative to `today` (2026-07-06), so not yet reached; still
    // reported via dueOrOverdue with the real date populated, same
    // convention as every other schedule shape.
    expect(result.status).toBe("up_to_date");
    expect(result.nextDueDate).toBe("2026-08-10");
  });

  it("marks a DOB-anchored series complete once every dose is logged", () => {
    const PENTA: VaccinationCatalogRow = {
      id: "penta-id",
      code: "child_penta",
      name: "Pentavalent (DTP-HepB-Hib)",
      recommended_age: { age_schedule_weeks: [6, 10, 14], max_age_years: 5 },
    };
    const records = [
      record("penta-id", 1, "2026-01-13"),
      record("penta-id", 2, "2026-02-10"),
      record("penta-id", 3, "2026-03-10"),
    ];
    const [result] = computeVaccinationStatuses([PENTA], records, { ageYears: 1 }, today);
    expect(result.status).toBe("up_to_date");
  });

  it("marks a childhood-only dose not applicable once past its catch-up age ceiling", () => {
    const BCG: VaccinationCatalogRow = {
      id: "bcg-id",
      code: "child_bcg",
      name: "BCG",
      recommended_age: { age_schedule_weeks: [0], max_age_years: 5 },
    };
    const [result] = computeVaccinationStatuses([BCG], [], { ageYears: 30 }, today);
    expect(result.status).toBe("not_applicable");
  });

  it("marks a sex-restricted childhood vaccine not applicable for the other sex", () => {
    const HPV_GIRLS: VaccinationCatalogRow = {
      id: "hpvg-id",
      code: "child_hpv_girls",
      name: "HPV (girls 9-14)",
      recommended_age: { age_schedule_weeks: [469], max_age_years: 14, sex: "female" },
    };
    const [result] = computeVaccinationStatuses(
      [HPV_GIRLS],
      [],
      { ageYears: 10, sex: "male" },
      today
    );
    expect(result.status).toBe("not_applicable");
  });

  it("gates a DOB-anchored dose coarsely off ageYears when date of birth is unknown", () => {
    const PENTA: VaccinationCatalogRow = {
      id: "penta-id",
      code: "child_penta",
      name: "Pentavalent (DTP-HepB-Hib)",
      recommended_age: { age_schedule_weeks: [6, 10, 14], max_age_years: 5 },
    };
    const [tooYoung] = computeVaccinationStatuses([PENTA], [], { ageYears: 0 }, today);
    expect(tooYoung.status).toBe("not_yet_due");

    const [oldEnough] = computeVaccinationStatuses([PENTA], [], { ageYears: 1 }, today);
    expect(oldEnough.status).toBe("due");
  });

  it("anchors a booster's first due date off a fallback vaccine's last dose when it has none of its own", () => {
    const TETANUS_WITH_FALLBACK: VaccinationCatalogRow = {
      id: "tetanus-id",
      code: "tetanus_td_booster",
      name: "Tetanus/Td Booster",
      recommended_age: { interval_years: 10, anchor_fallback_code: "child_penta" },
    };
    const PENTA: VaccinationCatalogRow = {
      id: "penta-id",
      code: "child_penta",
      name: "Pentavalent (DTP-HepB-Hib)",
      recommended_age: { age_schedule_weeks: [6, 10, 14], max_age_years: 5 },
    };
    const records = [
      record("penta-id", 1, "2016-01-13"),
      record("penta-id", 2, "2016-02-10"),
      record("penta-id", 3, "2016-03-10"), // the child's last routine tetanus-containing dose
    ];
    const [result] = computeVaccinationStatuses(
      [TETANUS_WITH_FALLBACK, PENTA],
      records,
      { ageYears: 10 },
      today
    );
    expect(result.status).toBe("overdue");
    expect(result.nextDueDate).toBe("2026-03-10"); // 10 years after the last Penta dose
    expect(result.lastDoseDate).toBe("2016-03-10");
    expect(result.dosesGiven).toBe(0); // no dose logged under tetanus_td_booster's own code
  });

  it("prefers a booster's own logged dose over the fallback once one exists", () => {
    const TETANUS_WITH_FALLBACK: VaccinationCatalogRow = {
      id: "tetanus-id",
      code: "tetanus_td_booster",
      name: "Tetanus/Td Booster",
      recommended_age: { interval_years: 10, anchor_fallback_code: "child_penta" },
    };
    const PENTA: VaccinationCatalogRow = {
      id: "penta-id",
      code: "child_penta",
      name: "Pentavalent (DTP-HepB-Hib)",
      recommended_age: { age_schedule_weeks: [6, 10, 14], max_age_years: 5 },
    };
    const records = [
      record("penta-id", 3, "2016-03-10"),
      record("tetanus-id", 1, "2026-01-06"), // a real adult booster, logged more recently
    ];
    const [result] = computeVaccinationStatuses(
      [TETANUS_WITH_FALLBACK, PENTA],
      records,
      { ageYears: 10 },
      today
    );
    expect(result.status).toBe("up_to_date");
    expect(result.nextDueDate).toBe("2036-01-06");
    expect(result.lastDoseDate).toBe("2026-01-06");
  });

  it("falls back to plain never-had-a-dose handling when the fallback code has no doses either", () => {
    const TETANUS_WITH_FALLBACK: VaccinationCatalogRow = {
      id: "tetanus-id",
      code: "tetanus_td_booster",
      name: "Tetanus/Td Booster",
      recommended_age: { interval_years: 10, anchor_fallback_code: "child_penta" },
    };
    const PENTA: VaccinationCatalogRow = {
      id: "penta-id",
      code: "child_penta",
      name: "Pentavalent (DTP-HepB-Hib)",
      recommended_age: { age_schedule_weeks: [6, 10, 14], max_age_years: 5 },
    };
    const [result] = computeVaccinationStatuses([TETANUS_WITH_FALLBACK, PENTA], [], { ageYears: 40 }, today);
    expect(result.status).toBe("due");
    expect(result.nextDueDate).toBe("2026-07-06");
    expect(result.lastDoseDate).toBeNull();
  });

  describe("the full WHO tetanus (TTCV) series wired into production data", () => {
    // Mirrors the real vaccination_catalog rows (migration
    // 20260724024110_who_tetanus_childhood_booster_series): infant Penta
    // (6/10/14wk) -> booster 1 (18mo/78wk) -> booster 2 (4yr/208wk) ->
    // booster 3 (9yr/469wk) -> adult tetanus_td_booster, anchored off
    // booster 3 specifically, not an earlier stage.
    const PENTA: VaccinationCatalogRow = {
      id: "penta-id",
      code: "child_penta",
      name: "Pentavalent (DTP-HepB-Hib)",
      recommended_age: { age_schedule_weeks: [6, 10, 14], max_age_years: 5 },
    };
    const BOOSTER_1: VaccinationCatalogRow = {
      id: "booster1-id",
      code: "child_tetanus_booster_1",
      name: "Tetanus Booster — 18 Months",
      recommended_age: { age_schedule_weeks: [78], max_age_years: 3 },
    };
    const BOOSTER_2: VaccinationCatalogRow = {
      id: "booster2-id",
      code: "child_tetanus_booster_2",
      name: "Tetanus Booster — 4 to 7 Years",
      recommended_age: { age_schedule_weeks: [208], max_age_years: 8 },
    };
    const BOOSTER_3: VaccinationCatalogRow = {
      id: "booster3-id",
      code: "child_tetanus_booster_3",
      name: "Tetanus Booster — 9 to 15 Years",
      recommended_age: { age_schedule_weeks: [469], max_age_years: 16 },
    };
    const ADULT_BOOSTER: VaccinationCatalogRow = {
      id: "tetanus-id",
      code: "tetanus_td_booster",
      name: "Tetanus/Td Booster",
      recommended_age: { interval_years: 10, anchor_fallback_code: "child_tetanus_booster_3" },
    };
    const CATALOG = [PENTA, BOOSTER_1, BOOSTER_2, BOOSTER_3, ADULT_BOOSTER];

    it("does NOT anchor the adult booster off an earlier partial stage while a later childhood booster is still outstanding", () => {
      // A 5-year-old who's had Penta + the 18-month booster, but isn't old
      // enough yet for booster 2 (due at 4yr) or booster 3 (due at 9yr) —
      // wait, 5yr IS past booster 2's 4yr due age, so booster 2 should show
      // due/overdue on its own row; the point under test is that the ADULT
      // booster must NOT compute a next-due-date off booster 1's 18-month
      // dose (which would wrongly suggest no tetanus shot is needed until
      // age ~11.5, silently deprioritising the still-outstanding booster 2).
      const records = [
        record("penta-id", 1, "2021-01-13"),
        record("penta-id", 2, "2021-02-10"),
        record("penta-id", 3, "2021-03-10"),
        record("booster1-id", 1, "2022-08-01"),
      ];
      const results = computeVaccinationStatuses(CATALOG, records, { ageYears: 5, dateOfBirth: "2021-01-01" }, today);
      const byCode = Object.fromEntries(results.map((r) => [r.code, r]));

      // Booster 2 correctly shows as due on its own row — the childhood
      // series is not silently skipped.
      expect(["due", "overdue"]).toContain(byCode.child_tetanus_booster_2.status);
      // The adult booster has no dose of its own AND its fallback
      // (booster 3) has none either — it falls through to the plain
      // "due today" default, never to booster 1's 2022-08-01 + 10 years.
      expect(byCode.tetanus_td_booster.status).toBe("due");
      expect(byCode.tetanus_td_booster.nextDueDate).toBe("2026-07-06");
      expect(byCode.tetanus_td_booster.lastDoseDate).toBeNull();
    });

    it("anchors the adult booster's 10-year clock off booster 3 once the full childhood series is complete", () => {
      const records = [
        record("penta-id", 1, "2011-01-13"),
        record("penta-id", 2, "2011-02-10"),
        record("penta-id", 3, "2011-03-10"),
        record("booster1-id", 1, "2012-08-01"),
        record("booster2-id", 1, "2015-01-15"),
        record("booster3-id", 1, "2020-06-15"), // the real last childhood dose
      ];
      const results = computeVaccinationStatuses(CATALOG, records, { ageYears: 15, dateOfBirth: "2011-01-01" }, today);
      const byCode = Object.fromEntries(results.map((r) => [r.code, r]));

      expect(byCode.tetanus_td_booster.lastDoseDate).toBe("2020-06-15");
      expect(byCode.tetanus_td_booster.nextDueDate).toBe("2030-06-15");
      expect(byCode.tetanus_td_booster.status).toBe("up_to_date");
    });
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
