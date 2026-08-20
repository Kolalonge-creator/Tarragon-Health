import { cn } from "@/lib/utils";

/**
 * Ongoing chronic-condition monitoring, as distinct from the one-off
 * Annual Health Check (see what-we-measure.tsx). Every cadence here is
 * read from real, live schema — never invented — checked 2026-08-19:
 *   - vitals_reminder_rules / rules-manager.tsx: 3-day BP/glucose logging
 *     default (admin-editable)
 *   - medication_review_cadences: hypertension=6mo, diabetes=3mo
 *   - drug_monitoring_rules: per-drug-class lab checks, real rows
 *   - diabetes_complication_checks / diabetic_foot_assessments: structural
 *     due-date trackers for foot/retinal/renal screening
 *   - condition_protocols.monitoring/investigations: WHO-based reference
 *     text for cadences that don't (yet) have their own due-date tracker
 *     row — kidney/lipid annual recheck for hypertension, and the diabetic
 *     HbA1c 3-then-6-month cadence specifically (foot/eye/kidney DO have
 *     trackers; HbA1c itself doesn't yet)
 *
 * `tracked: "reminder"` = a live, automated due-date/reminder mechanism
 * exists in the schema today. `tracked: "protocol"` = a real cadence from
 * Tarragon's WHO-based protocol that your care team follows, but the app
 * doesn't yet send its own separate reminder for it — don't blur this
 * distinction, it's the difference between "the app nudges you" and "ask
 * your doctor when this was last checked."
 *
 * Diabetic HbA1c (every 3-then-6 months, once on a diabetes care plan) is
 * a different cadence from the general-population HbA1c in the Annual
 * Health Check (every 12 months, screen_types.frequency_months) — say so
 * explicitly rather than let the two "HbA1c" mentions across the site
 * read as contradictory.
 */
type Tracked = "reminder" | "protocol";

interface MonitoringItem {
  name: string;
  explanation: string;
  cadence: string;
  tracked: Tracked;
}

interface MonitoringCategory {
  title: string;
  description: string;
  items: MonitoringItem[];
}

const TRACKED_LABEL: Record<Tracked, string> = {
  reminder: "Reminded automatically",
  protocol: "Followed by your care team",
};

const TRACKED_STYLES: Record<Tracked, string> = {
  reminder: "bg-brand-green/15 text-deep-forest",
  protocol: "bg-charcoal-ink/8 text-charcoal-ink/70",
};

export const HYPERTENSION_MONITORING: MonitoringCategory[] = [
  {
    title: "Blood Pressure Monitoring",
    description: "The reading itself, tracked often enough to actually see a trend.",
    items: [
      {
        name: "Home blood pressure readings",
        explanation: "Logged via app or web; you're reminded if none comes in.",
        cadence: "Every 3 days by default (your care team can adjust this)",
        tracked: "reminder",
      },
      {
        name: "Structured 7-day check (HBPM)",
        explanation:
          "Two readings each morning and evening for a week, the most reliable way to confirm what's really going on.",
        cadence: "When your diagnosis or control needs confirming",
        tracked: "protocol",
      },
    ],
  },
  {
    title: "Doctor Review",
    description: "How often your care team actually looks at how you're doing.",
    items: [
      {
        name: "Medication review",
        explanation: "Your care team checks how your treatment is working and adjusts if needed.",
        cadence: "Every 6 months once you're at target; every 2–4 weeks until you get there",
        tracked: "reminder",
      },
    ],
  },
  {
    title: "Kidney & Metabolic Bloods",
    description: "The wider picture beyond the reading itself.",
    items: [
      {
        name: "Kidney function & electrolytes",
        explanation:
          "Checks how your kidneys and salt balance are coping. Also automatically re-checked whenever certain blood-pressure medicines are started or changed, see below.",
        cadence: "Annually",
        tracked: "protocol",
      },
      {
        name: "Lipid panel",
        explanation: "Cholesterol numbers, part of your overall cardiovascular risk picture.",
        cadence: "Annually",
        tracked: "protocol",
      },
      {
        name: "HbA1c",
        explanation: "A blood sugar check, since high blood pressure and diabetes often travel together.",
        cadence: "Annually",
        tracked: "protocol",
      },
    ],
  },
  {
    title: "If You're Prescribed These, We Track Them Automatically",
    description: "Certain blood-pressure medicines carry their own lab checks, scheduled the moment they're prescribed.",
    items: [
      {
        name: "ACE inhibitors (e.g. ramipril, lisinopril)",
        explanation: "Kidney function and potassium, checked shortly after you start.",
        cadence: "About 2 weeks after starting",
        tracked: "reminder",
      },
      {
        name: "ARBs (e.g. losartan, telmisartan)",
        explanation: "Kidney function and potassium.",
        cadence: "Before starting, 1–2 weeks after, then every 12 months",
        tracked: "reminder",
      },
      {
        name: "Thiazide diuretics",
        explanation: "Electrolytes, kidney function, and glucose.",
        cadence: "Before starting, about 4 weeks after, then every 12 months",
        tracked: "reminder",
      },
      {
        name: "Potassium-sparing diuretics (e.g. spironolactone)",
        explanation: "Potassium and kidney function, watched closely at first.",
        cadence: "Before starting, 1–2 weeks after, then every 6 months",
        tracked: "reminder",
      },
      {
        name: "Statins, if prescribed alongside",
        explanation: "Checks how well your cholesterol is responding to treatment.",
        cadence: "3 months after starting",
        tracked: "reminder",
      },
    ],
  },
];

export const DIABETES_MONITORING: MonitoringCategory[] = [
  {
    title: "Blood Sugar Monitoring",
    description: "The day-to-day number, and the number that shows the trend.",
    items: [
      {
        name: "Glucose self-logging",
        explanation:
          "Logged via app or web, so you and your care team see the pattern, not just one number.",
        cadence: "Every 3 days by default; flagged if none in 7 days",
        tracked: "reminder",
      },
      {
        name: "HbA1c",
        explanation:
          "Your three-month blood sugar average, the main marker your care team uses to judge control. Different from the once-a-year HbA1c in the general Annual Health Check: once you're on a diabetes care plan, it's checked more often.",
        cadence: "Every 3 months until stable, then every 6 months",
        tracked: "protocol",
      },
    ],
  },
  {
    title: "Doctor Review",
    description: "How often your care team actually looks at how you're doing.",
    items: [
      {
        name: "Medication review",
        explanation: "Your care team checks how your treatment is working and adjusts if needed.",
        cadence: "Every 3 months",
        tracked: "reminder",
      },
    ],
  },
  {
    title: "Complication Screening",
    description: "Catching the complications diabetes causes quietly, before you'd feel them.",
    items: [
      {
        name: "Foot assessment",
        explanation: "Checks circulation and nerve sensation in your feet.",
        cadence: "Annually if your risk is low or increased; sooner if it's high",
        tracked: "reminder",
      },
      {
        name: "Retinal (eye) screening",
        explanation: "A dilated eye exam that catches diabetes-related changes in the retina early.",
        cadence: "At diagnosis, then at least annually",
        tracked: "reminder",
      },
      {
        name: "Kidney screening (eGFR + urine ACR)",
        explanation:
          "Catches kidney damage from diabetes long before you'd feel anything; a concerning result triggers immediate review.",
        cadence: "At diagnosis, then at least annually",
        tracked: "reminder",
      },
    ],
  },
  {
    title: "If You're Prescribed These, We Track Them Automatically",
    description: "Certain diabetes medicines carry their own lab checks, scheduled the moment they're prescribed.",
    items: [
      {
        name: "Metformin → kidney function",
        explanation: "Kidney function, checked periodically for as long as you're on it.",
        cadence: "Every 12 months",
        tracked: "reminder",
      },
      {
        name: "Metformin → Vitamin B12",
        explanation: "Long-term metformin use can lower your B12 levels.",
        cadence: "Every 24 months",
        tracked: "reminder",
      },
      {
        name: "Statins, if prescribed",
        explanation: "Checks how well your cholesterol is responding to treatment.",
        cadence: "3 months after starting",
        tracked: "reminder",
      },
    ],
  },
];

export function ConditionMonitoringGrid({ categories }: { categories: MonitoringCategory[] }) {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="grid gap-4 sm:grid-cols-2">
        {categories.map((category) => (
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
                  <span className="text-sm font-medium text-charcoal-ink">{item.name}</span>
                  <p className="mt-1 text-sm leading-relaxed text-charcoal-ink/65">
                    {item.explanation}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/45">
                      {item.cadence}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-medium",
                        TRACKED_STYLES[item.tracked]
                      )}
                    >
                      {TRACKED_LABEL[item.tracked]}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
      <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-charcoal-ink/60">
        <strong className="text-charcoal-ink/75">Reminded automatically</strong> means the app itself
        schedules and nudges you. <strong className="text-charcoal-ink/75">Followed by your care team</strong>{" "}
        means it&apos;s a real part of your protocol that your doctor tracks, even where the app doesn&apos;t yet
        send its own separate reminder.
      </p>
    </div>
  );
}
