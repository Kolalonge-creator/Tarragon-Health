import { cn } from "@/lib/utils";

/**
 * Every category/item here is grounded directly in the live screen_types
 * and panel_bundles catalogue (checked 2026-08-19), not invented for this
 * page — including each `frequency` string, which is screen_types.
 * frequency_months read literally (null means a one-off or condition-
 * triggered test, never a guessed cadence). Deliberately excluded, per
 * founder review of a competitor's biomarker list: hs-CRP, Homocysteine,
 * Uric Acid (the "inflammation" panel), ApoB, a general hormone panel
 * (Testosterone/Prolactin/FSH/LH/Oestradiol/SHBG/FAI), Vitamin D, and
 * Fasting Insulin (not readily available at Nigerian labs, so HOMA-IR has
 * no real input to compute from here either). Echocardiogram is left off
 * too: it exists as a screen_type row but isn't in any bundle's test_codes
 * yet, so it isn't something we can honestly say is "included" anywhere.
 *
 * "Vitamin B12" (not "Active B12"): dohealth's exact test name was
 * Active B12 (holotranscobalamin), but the platform's analyte catalogue
 * (apps/web/src/lib/lab-reports/analyte-catalogue.ts) and its reference-
 * range interpretation layer (reference-ranges.ts) only have a real,
 * sourced entry for Total B12 ("vitamin_b12") — Active B12 would need new
 * clinical infrastructure (a new analyte code + its own pmol/L reference
 * band) for a test that, like Fasting Insulin, likely isn't readily
 * available at Nigerian labs either. Using "vitamin_b12" means this test
 * is grounded end-to-end today: scheduled (screening-recommendations.ts
 * reads screen_types generically), extracted (real aliases already
 * resolve "B12"/"Cobalamin" report lines), and interpreted (a real,
 * sourced reference band already exists) — not just listed on a page.
 */
type Tier = "Core" | "Advanced" | "Comprehensive";

interface MeasureItem {
  name: string;
  explanation: string;
  frequency: string;
  tier: Tier;
}

interface MeasureCategory {
  title: string;
  description: string;
  items: MeasureItem[];
}

const TIER_STYLES: Record<Tier, string> = {
  Core: "bg-soft-sage text-deep-forest",
  Advanced: "bg-brand-green/15 text-deep-forest",
  Comprehensive: "bg-clinical-navy/10 text-clinical-navy",
};

const WHAT_WE_MEASURE: MeasureCategory[] = [
  {
    title: "Heart Health",
    description:
      "The numbers behind heart-attack and stroke risk, plus a direct look at your heart's electrical rhythm. Blood pressure is measured and recorded at every visit, on every tier.",
    items: [
      {
        name: "Lipid Panel: Total, LDL & HDL Cholesterol, Triglycerides",
        explanation: "The cholesterol numbers behind heart-attack and stroke risk.",
        frequency: "Every year",
        tier: "Core",
      },
      {
        name: "Resting 12-Lead ECG",
        explanation: "A direct read of your heart's electrical rhythm, catching irregularities before they cause symptoms.",
        frequency: "Every year",
        tier: "Advanced",
      },
    ],
  },
  {
    title: "Blood Sugar",
    description:
      "Your three-month average, plus a same-day check when it's actually needed: the earliest reliable warning signs for diabetes, years before symptoms.",
    items: [
      {
        name: "HbA1c",
        explanation: "Your three-month blood sugar average, the earliest reliable warning sign for diabetes.",
        frequency: "Every year",
        tier: "Core",
      },
      {
        name: "Fasting Plasma Glucose / OGTT",
        explanation: "A same-day glucose check, run to confirm what a borderline HbA1c is telling us.",
        frequency: "Only if your HbA1c comes back borderline",
        tier: "Advanced",
      },
    ],
  },
  {
    title: "Blood Cell Health",
    description:
      "A full count of your red cells, white cells, and platelets, plus the two markers most often behind anaemia: anaemia, infection, and clotting problems all show up here first.",
    items: [
      {
        name: "Full Blood Count: Haemoglobin, Haematocrit, RBC & WBC Count, Platelets, MCV, MCH, MCHC",
        explanation: "Anaemia, infection, and clotting problems all show up here first.",
        frequency: "Every year",
        tier: "Core",
      },
      {
        name: "Ferritin",
        explanation: "Your iron stores, the first thing checked when anaemia is suspected.",
        frequency: "Every year",
        tier: "Comprehensive",
      },
      {
        name: "Vitamin B12",
        explanation: "Deficiency causes a distinct kind of anaemia and nerve problems, common with plant-based diets and some medicines.",
        frequency: "Every year",
        tier: "Comprehensive",
      },
    ],
  },
  {
    title: "Kidney Health",
    description: "How well your kidneys are filtering, long before you'd ever feel it slipping.",
    items: [
      {
        name: "Kidney Function: Urea, Electrolytes, Creatinine, eGFR",
        explanation: "How well your kidneys are filtering your blood.",
        frequency: "Every year",
        tier: "Core",
      },
      {
        name: "Urinalysis",
        explanation: "A quick check of your urine for early signs of kidney or urinary problems.",
        frequency: "Every year",
        tier: "Core",
      },
      {
        name: "Urine Albumin:Creatinine Ratio",
        explanation: "Catches kidney damage years before it would show up on a standard kidney function test.",
        frequency: "Every year",
        tier: "Advanced",
      },
    ],
  },
  {
    title: "Liver Health",
    description: "How your liver is coping, long before any symptom would tell you.",
    items: [
      {
        name: "Liver Function Test: ALT, AST, ALP, Bilirubin, Albumin",
        explanation: "How your liver is coping, checked long before any symptom would tell you.",
        frequency: "Every year",
        tier: "Core",
      },
    ],
  },
  {
    title: "Thyroid Health",
    description: "The gland that quietly sets your metabolism, energy, and mood.",
    items: [
      {
        name: "Thyroid Function: TSH, Free T4",
        explanation: "The gland that quietly sets your metabolism, energy, and mood.",
        frequency: "Every year",
        tier: "Core",
      },
    ],
  },
  {
    title: "Cancer Screening",
    description:
      "Matched to your age and sex, not one-size-fits-all, and not everything here is yearly. Each one runs on its own proper calendar, not a generic annual clock.",
    items: [
      {
        name: "Cervical Smear (women 25–64)",
        explanation: "Catches changes in the cervix years before they could become cancer.",
        frequency: "Every 3 years",
        tier: "Advanced",
      },
      {
        name: "Prostate-Specific Antigen: PSA (men 45+)",
        explanation: "A blood marker your doctor discusses with you rather than orders blindly.",
        frequency: "Every 2 years",
        tier: "Advanced",
      },
      {
        name: "Faecal Immunochemical Test: FIT, colorectal (45–74)",
        explanation: "A simple stool test that catches early signs of colorectal cancer.",
        frequency: "Every 2 years",
        tier: "Advanced",
      },
      {
        name: "Breast Imaging: ultrasound under 40, mammography 40+",
        explanation: "Catching breast cancer at the stage it's most treatable.",
        frequency: "Every 2 years",
        tier: "Comprehensive",
      },
      {
        name: "Prostate Ultrasound (men 50+)",
        explanation: "A closer look when PSA or symptoms suggest it's needed.",
        frequency: "Every 2 years",
        tier: "Comprehensive",
      },
    ],
  },
  {
    title: "Infectious Disease Screening",
    description:
      "The WHO-priority checks for Nigeria, run confidentially alongside everything else in the same visit.",
    items: [
      {
        name: "HIV Screening",
        explanation: "Confidential, and one of the most consequential tests you can have done regularly.",
        frequency: "Every year",
        tier: "Core",
      },
      {
        name: "Hepatitis B Surface Antigen",
        explanation: "Checks whether you're currently infected with Hepatitis B.",
        frequency: "Once",
        tier: "Core",
      },
      {
        name: "Hepatitis C Test",
        explanation: "Checks whether you're currently infected with Hepatitis C.",
        frequency: "Once",
        tier: "Core",
      },
      {
        name: "Syphilis: VDRL with TPHA confirmation",
        explanation: "A two-step confirmatory test for a treatable infection that causes serious harm if missed.",
        frequency: "Every year",
        tier: "Comprehensive",
      },
    ],
  },
  {
    title: "Know Your Basics",
    description:
      "Facts about your own blood most Nigerians are never told plainly: useful for emergencies, marriage counselling, and pregnancy planning.",
    items: [
      {
        name: "Blood Group & Rhesus Factor",
        explanation: "Something every Nigerian should know and rarely gets told plainly, vital in an emergency.",
        frequency: "Once, for life",
        tier: "Core",
      },
      {
        name: "Sickle Cell Genotype (AA/AS/SS)",
        explanation: "Essential knowledge before marriage or planning a pregnancy.",
        frequency: "Once, for life",
        tier: "Core",
      },
    ],
  },
];

export function WhatWeMeasure() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap justify-center gap-3 text-xs font-medium">
        {(["Core", "Advanced", "Comprehensive"] as Tier[]).map((tier) => (
          <span key={tier} className={cn("rounded-full px-3 py-1", TIER_STYLES[tier])}>
            {tier} Screen
          </span>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {WHAT_WE_MEASURE.map((category) => (
          <details
            key={category.title}
            className="group rounded-xl border border-charcoal-ink/10 bg-white p-5"
          >
            <summary className="cursor-pointer list-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2">
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className="font-heading text-lg font-semibold text-charcoal-ink">
                    {category.title}
                  </span>
                  <span className="mt-1 block text-sm leading-relaxed text-charcoal-ink/65">
                    {category.description}
                  </span>
                </span>
                <span
                  className="mt-0.5 shrink-0 text-xl font-semibold text-brand-green transition-transform group-open:rotate-45"
                  aria-hidden
                >
                  +
                </span>
              </span>
            </summary>
            <ul className="mt-4 space-y-4 border-t border-charcoal-ink/10 pt-4">
              {category.items.map((item) => (
                <li key={item.name}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm font-medium text-charcoal-ink">{item.name}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
                        TIER_STYLES[item.tier]
                      )}
                    >
                      {item.tier}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-charcoal-ink/65">
                    {item.explanation}
                  </p>
                  <p className="mt-1 text-xs font-medium uppercase tracking-wide text-charcoal-ink/45">
                    {item.frequency}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}
