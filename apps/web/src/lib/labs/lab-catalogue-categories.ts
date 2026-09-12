/**
 * Groups the patient lab catalogue (`panel_bundles`) into categories a
 * patient can scan, rather than one long alphabetical list. `panel_bundles`
 * has no category column (see test-code-labels.ts for why this kind of
 * patient-facing structure lives in code, not per-tenant data), so this is a
 * static map keyed by bundle name, same placement/reasoning as that file.
 *
 * A bundle whose name isn't in BUNDLE_CATEGORY still renders — under
 * "Other tests" — rather than being silently dropped from the list. Keep
 * this in sync when a bundle is renamed or a new one is added; an unmapped
 * bundle is a visible signal to fix, never a hidden one.
 */
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

  "HbA1c": "diabetes",
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
  "PSA": "cancer",

  "Blood Group & Genotype": "basics",
  "Full Blood Count": "basics",
  "Ferritin (iron stores)": "basics",
  "Vitamin B12": "basics",
  "Urinalysis": "basics",
};

/** The category key for one bundle, falling back to "other" rather than guessing. */
export function categoryForBundle(bundleName: string): string {
  return BUNDLE_CATEGORY[bundleName] ?? "other";
}

/** Groups bundles by category, in LAB_CATEGORY_ORDER, dropping empty categories. */
export function groupBundlesByCategory<T extends { name: string }>(
  bundles: readonly T[]
): Array<{ category: LabCategory; bundles: T[] }> {
  const byKey = new Map<string, T[]>();
  for (const bundle of bundles) {
    const key = categoryForBundle(bundle.name);
    const list = byKey.get(key) ?? [];
    list.push(bundle);
    byKey.set(key, list);
  }
  return LAB_CATEGORY_ORDER.filter((category) => byKey.has(category.key)).map((category) => ({
    category,
    bundles: byKey.get(category.key)!,
  }));
}
