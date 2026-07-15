const CARE_ITEMS = [
  {
    label: "Blood pressure",
    value: "128 / 82",
    helper: "Logged this morning",
  },
  {
    label: "Glucose",
    value: "6.1 mmol/L",
    helper: "Stable this week",
  },
  {
    label: "Medication",
    value: "2 due today",
    helper: "WhatsApp reminder sent",
  },
] as const;

const CARE_PATH = [
  "Reading logged",
  "Doctor review",
  "Follow-up note",
  "Family update",
] as const;

export function DashboardPreview() {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-[0.85fr_1.15fr]">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
          Dashboard preview
        </p>
        <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
          One calm view for the care between visits
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
          Tarragon brings readings, reminders, preventive checks, doctor review,
          and family updates into one shared record, so the next step is clear.
        </p>
      </div>

      <div className="rounded-3xl border border-charcoal-ink/10 bg-white p-4 shadow-xl shadow-charcoal-ink/10 sm:p-6">
        <div className="rounded-2xl bg-warm-ivory p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-charcoal-ink/70">ParentCare record</p>
              <h3 className="font-heading text-2xl font-semibold text-charcoal-ink">
                Mrs. Adebayo
              </h3>
              <p className="mt-1 text-sm text-charcoal-ink/70">
                Hypertension + preventive checks
              </p>
            </div>
            <span className="rounded-full bg-soft-sage px-3 py-1 text-xs font-medium text-deep-forest">
              Doctor reviewed
            </span>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {CARE_ITEMS.map((item) => (
              <div key={item.label} className="rounded-xl bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/70">
                  {item.label}
                </p>
                <p className="mt-2 font-heading text-xl font-semibold text-clinical-navy">
                  {item.value}
                </p>
                <p className="mt-1 text-xs text-charcoal-ink/70">{item.helper}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/70">
                  Preventive check
                </p>
                <p className="mt-1 font-heading text-lg font-semibold text-charcoal-ink">
                  Kidney function test due
                </p>
              </div>
              <span className="rounded-full bg-sprout-gold/15 px-3 py-1 text-xs font-medium text-charcoal-ink">
                Book & pay
              </span>
            </div>
            <p className="mt-2 text-sm text-charcoal-ink/65">
              Suggested because blood pressure monitoring and medication review share the
              same longitudinal record.
            </p>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            {CARE_PATH.map((step, index) => (
              <div key={step} className="rounded-xl border border-charcoal-ink/10 bg-white p-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-green text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <p className="mt-2 text-sm font-medium text-charcoal-ink">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
