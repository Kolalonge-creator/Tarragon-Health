export interface PanelTestGroup {
  heading: string;
  tests: readonly string[];
}

/**
 * The tests in the yearly blood panel (lab panel membership_annual, active version 4). Mirrors the analyte labels in
 * lab_panel_versions; a test in pricing-ladder.test.ts fails if a label drifts from the registry. anti-HBs is left out on purpose: a clinician
 * adds it for some people, a patient never chooses it. TSH is not on the panel (founder decision 2026-10-30): a doctor orders it only when a
 * patient needs it, on a request the patient takes to any lab or partner lab.
 *
 * This is the one list. The public pricing page and the homepage (through app/(marketing)/_content/pricing-ladder.ts) and the patient
 * Membership screen (patient/membership/yearly-panel-tests.tsx) all read it from here. Never copy it into a second place.
 */
export const YEARLY_PANEL_TESTS: readonly PanelTestGroup[] = [
  { heading: "Blood sugar", tests: ["Fasting glucose", "HbA1c"] },
  { heading: "Cholesterol and fats", tests: ["Total cholesterol", "LDL cholesterol", "HDL cholesterol", "Triglycerides"] },
  { heading: "Kidneys and salts", tests: ["Creatinine", "Potassium", "Sodium"] },
  { heading: "Liver", tests: ["ALT", "AST"] },
  { heading: "Blood count", tests: ["Haemoglobin", "White cell count", "Platelets"] },
  { heading: "Infection screening", tests: ["HIV screen", "Hepatitis B surface antigen", "Hepatitis C antibody"] },
];
