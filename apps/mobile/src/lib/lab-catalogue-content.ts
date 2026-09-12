/**
 * Patient-facing copy for the lab catalogue (`panel_bundles`) — mirrors
 * apps/web/src/lib/labs/test-code-labels.ts and
 * apps/web/src/lib/labs/lab-catalogue-categories.ts. Duplicated rather than
 * imported because apps/web isn't a package the mobile app can import from
 * (Next.js-only path aliases, same reasoning as lab-orders.ts's header
 * comment) — keep these two in sync by hand when either changes.
 */

/** Plain-language names for the test codes carried in `panel_bundles.test_codes`. */
const TEST_CODE_LABELS: Readonly<Record<string, string>> = {
  abdominal_ultrasound: "Abdominal ultrasound scan",
  blood_group: "Blood group and rhesus",
  breast_imaging: "Breast scan",
  cervical_smear: "Cervical smear",
  ecg_resting: "Heart tracing (12-lead ECG)",
  fbc: "Full blood count",
  fit: "Bowel screening test (FIT)",
  hba1c: "Average blood sugar (HbA1c)",
  hep_b: "Hepatitis B",
  hep_c: "Hepatitis C",
  hiv: "HIV test",
  kft: "Kidney function",
  lft: "Liver function",
  lipid_panel: "Cholesterol panel",
  ogtt_fpg: "Blood sugar tolerance test",
  prostate_ultrasound: "Prostate ultrasound scan",
  psa: "Prostate check (PSA)",
  sickle_cell_genotype: "Genotype (AA/AS/SS)",
  syphilis: "Syphilis test",
  tft: "Thyroid function",
  tsh: "TSH (thyroid stimulating hormone)",
  free_t4: "Free T4 (thyroid hormone)",
  urinalysis: "Urine test",
  urine_acr: "Urine protein check (ACR)",
};

/** A patient-readable name for one test code, de-snake-casing an unmapped code rather than printing it raw. */
export function testCodeLabel(code: string): string {
  const known = TEST_CODE_LABELS[code];
  if (known) return known;
  return code
    .split("_")
    .filter(Boolean)
    .map((word, i) =>
      i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word,
    )
    .join(" ");
}

/** Labels for a bundle's codes, de-duplicated, in the bundle's own order. */
export function testCodeLabels(codes: readonly string[]): string[] {
  return Array.from(new Set(codes.map(testCodeLabel)));
}

export interface LabCategory {
  key: string;
  label: string;
}

export const LAB_CATEGORY_ORDER: readonly LabCategory[] = [
  { key: "checkups", label: "Complete health checks" },
  { key: "diabetes", label: "Diabetes & blood sugar" },
  { key: "heart_kidney", label: "Heart, cholesterol & kidney" },
  { key: "liver_thyroid", label: "Liver & thyroid" },
  { key: "infections", label: "Infections (HIV & hepatitis)" },
  { key: "cancer", label: "Cancer screening" },
  { key: "basics", label: "Blood basics & other single tests" },
  { key: "other", label: "Other tests" },
];

const BUNDLE_CATEGORY: Readonly<Record<string, string>> = {
  "Core Screen": "checkups",
  "Essential Screen": "checkups",
  "Know Your Basics": "checkups",
  "Men's Health Check": "checkups",
  "Women's Health Check": "checkups",

  HbA1c: "diabetes",
  "Glucose Tolerance Test": "diabetes",
  "Diabetes Check": "diabetes",
  "Diabetes Panel": "diabetes",

  "Lipid Panel": "heart_kidney",
  "Heart Health Check": "heart_kidney",
  "Hypertension Panel": "heart_kidney",
  "Kidney Assessment": "heart_kidney",
  "Kidney Function Test": "heart_kidney",
  "Kidney Protein Check": "heart_kidney",

  "Liver Function Test": "liver_thyroid",
  "Thyroid Function (TSH, Free T4)": "liver_thyroid",

  "Blood-Borne Virus Screen": "infections",
  "HIV Screening": "infections",
  "Hepatitis B Surface Antigen": "infections",
  "Hepatitis C Screening": "infections",

  "Bowel Screening (FIT)": "cancer",
  "Cancer Screening (Men 45+)": "cancer",
  "Cancer Screening (Women 45+)": "cancer",
  "Cervical Cancer Screening (30 and over)": "cancer",
  "Cervical Cancer Screening (under 30)": "cancer",
  "Cervical Smear": "cancer",
  PSA: "cancer",

  "Blood Group & Genotype": "basics",
  "Full Blood Count": "basics",
  "Ferritin (iron stores)": "basics",
  "Vitamin B12": "basics",
  Urinalysis: "basics",
};

/** The category key for one bundle, falling back to "other" rather than guessing. */
function categoryForBundle(bundleName: string): string {
  return BUNDLE_CATEGORY[bundleName] ?? "other";
}

/** Groups bundles by category, in LAB_CATEGORY_ORDER, dropping empty categories. */
export function groupBundlesByCategory<T extends { name: string }>(
  bundles: readonly T[],
): Array<{ category: LabCategory; bundles: T[] }> {
  const byKey = new Map<string, T[]>();
  for (const bundle of bundles) {
    const key = categoryForBundle(bundle.name);
    const list = byKey.get(key) ?? [];
    list.push(bundle);
    byKey.set(key, list);
  }
  return LAB_CATEGORY_ORDER.filter((category) => byKey.has(category.key)).map(
    (category) => ({ category, bundles: byKey.get(category.key)! }),
  );
}
