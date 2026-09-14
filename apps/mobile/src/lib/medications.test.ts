/**
 * Coverage for the medicine cabinet's read/write helpers
 * (medicine-cabinet-screen.tsx's data layer). The Supabase-calling functions
 * are exercised indirectly by schema/RLS review (query shapes, enum values,
 * and FK names checked against the live `koiplnmbgnqnbywhpjlf` project) since
 * they need a real session to run; this file locks down the pure logic that
 * decides what the patient actually sees, mirroring the
 * bp-classification.test.ts pattern of importing the apps/web copy directly
 * so a divergence fails a test rather than waiting to be noticed by eye.
 */
import {
  checkPackAgainstPrescription as webCheckPackAgainstPrescription,
  drugNamesMatch as webDrugNamesMatch,
  parseStrength as webParseStrength,
  strengthsMatch as webStrengthsMatch,
} from "../../../web/src/lib/medications/pack-check";
import { buildTodaysDoseChecklist as webBuildTodaysDoseChecklist } from "../../../web/src/lib/medication-schedule/checklist";
import {
  buildTodaysDoseChecklist,
  checkinQuestion,
  checkPackAgainstPrescription,
  drugNamesMatch,
  parseStrength,
  strengthsMatch,
  type DoseChecklistItem,
} from "./medications";

describe("parseStrength (lock-step with apps/web's pack-check.ts)", () => {
  it.each([
    "5mg",
    "500 mg",
    "5mg/5ml",
    "1 g",
    "1,000mg",
    "50mcg",
    "50µg",
    "50ug",
    "10ml",
    "1000 IU",
    "2.5%",
    "not a strength",
    "",
    null,
    undefined,
  ])("matches the web copy for %p", (input) => {
    expect(parseStrength(input)).toEqual(webParseStrength(input));
  });
});

describe("strengthsMatch (lock-step with apps/web)", () => {
  it.each([
    ["5mg", "5mg"],
    ["5mg", "0.005g"],
    ["1g", "1000mg"],
    ["50mcg", "0.05mg"],
    ["5mg", "10mg"],
    ["5mg", "5ml"],
    ["5mg", null],
  ])("matches the web copy for %p vs %p", (a, b) => {
    expect(strengthsMatch(parseStrength(a), parseStrength(b))).toBe(
      webStrengthsMatch(webParseStrength(a), webParseStrength(b))
    );
  });
});

describe("drugNamesMatch (lock-step with apps/web)", () => {
  it.each([
    ["Amlodipine 5mg Tablets", "Amlodipine"],
    ["AMLODIPINE", "amlodipine"],
    ["Metformin SR 500mg", "Metformin"],
    ["Panadol", "Paracetamol"],
    ["Lisinopril", "Amlodipine"],
    ["", "Amlodipine"],
  ])("matches the web copy for %p vs %p", (pack, prescribed) => {
    expect(drugNamesMatch(pack, prescribed)).toBe(webDrugNamesMatch(pack, prescribed));
  });
});

describe("checkPackAgainstPrescription", () => {
  const prescribed = [
    { drugName: "Amlodipine", dose: "5mg" },
    { drugName: "Metformin", dose: "500mg" },
    { drugName: "Atorvastatin", dose: null },
  ];

  it("matches_prescription when name and strength both line up", () => {
    const result = checkPackAgainstPrescription({ drugName: "Amlodipine Tablets", strength: "5mg" }, prescribed);
    expect(result.verdict).toBe("matches_prescription");
    expect(result.matchedDrugName).toBe("Amlodipine");
  });

  it("strength_differs when the pack strength does not match the prescribed one", () => {
    const result = checkPackAgainstPrescription({ drugName: "Amlodipine", strength: "10mg" }, prescribed);
    expect(result.verdict).toBe("strength_differs");
  });

  it("strength_unknown when the prescribed record has no dose to compare", () => {
    const result = checkPackAgainstPrescription({ drugName: "Atorvastatin", strength: "20mg" }, prescribed);
    expect(result.verdict).toBe("strength_unknown");
  });

  it("not_on_your_list when nothing on the cabinet matches the pack", () => {
    const result = checkPackAgainstPrescription({ drugName: "Ibuprofen", strength: "400mg" }, prescribed);
    expect(result.verdict).toBe("not_on_your_list");
    expect(result.matchedDrugName).toBeNull();
  });

  it("stays lock-step with the web copy's verdict for the same inputs", () => {
    for (const packName of ["Amlodipine", "Metformin SR", "Atorvastatin", "Ibuprofen"]) {
      for (const strength of ["5mg", "10mg", "500mg", null]) {
        const mine = checkPackAgainstPrescription({ drugName: packName, strength }, prescribed);
        const theirs = webCheckPackAgainstPrescription(
          { drugName: packName, strength },
          prescribed.map((m, i) => ({ id: String(i), drugName: m.drugName, dose: m.dose }))
        );
        expect(mine.verdict).toBe(theirs.verdict);
        expect(mine.matchedDrugName).toBe(theirs.matchedDrugName);
      }
    }
  });
});

// apps/web's checkinQuestion (lib/queries/adherence-checkins.ts) has the
// identical switch, but that module also imports the Supabase browser
// client at module scope, which mobile's jest config has no alias for — so
// this asserts against the mirrored copy's own literal output rather than
// importing it (see buildTodaysDoseChecklist/pack-check above for the
// functions that ARE safely cross-importable).
describe("checkinQuestion", () => {
  it.each([
    ["started", "Amlodipine", "Have you started taking Amlodipine?"],
    ["side_effects", "Metformin", "Any side effects from Metformin?"],
    ["missed_doses", "Atorvastatin", "How many doses of Atorvastatin have you missed recently?"],
    [
      "lab_review",
      "Warfarin",
      "It's time for a follow-up review of Warfarin. Anything you'd like your care team to know?",
    ],
    ["something_unrecognised", "Amlodipine", "A quick check-in about Amlodipine."],
    ["started", null, "Have you started taking your medication?"],
  ])("renders the expected question for %p / %p", (type, drug, expected) => {
    expect(checkinQuestion(type, drug)).toBe(expected);
  });
});

describe("buildTodaysDoseChecklist", () => {
  const medications = [
    { id: "med-1", drug_name: "Amlodipine", schedule_times: ["08:00", "20:00"] },
    { id: "med-2", drug_name: "Metformin", schedule_times: ["13:00"] },
  ];

  it("defaults every slot with no matching log to pending", () => {
    const items = buildTodaysDoseChecklist(medications, []);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.status === "pending")).toBe(true);
  });

  it("carries over the logged status for a matching slot", () => {
    const items = buildTodaysDoseChecklist(medications, [
      { medication_id: "med-1", scheduled_time: "08:00", status: "taken" },
    ]);
    expect(items.find((i) => i.medicationId === "med-1" && i.time === "08:00")?.status).toBe("taken");
    expect(items.find((i) => i.medicationId === "med-1" && i.time === "20:00")?.status).toBe("pending");
  });

  it("sorts by time across medications", () => {
    const items = buildTodaysDoseChecklist(medications, []);
    expect(items.map((i) => i.time)).toEqual(["08:00", "13:00", "20:00"]);
  });

  it("stays lock-step with the web copy's ordering and status resolution", () => {
    const logs = [{ medication_id: "med-2", scheduled_time: "13:00", status: "missed" as const }];
    const mine: DoseChecklistItem[] = buildTodaysDoseChecklist(medications, logs);
    const theirs = webBuildTodaysDoseChecklist(medications, logs);
    expect(mine).toEqual(theirs);
  });
});
