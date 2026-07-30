/** App-promo visual: a static mockup of the patient dashboard, for the "get the app" section. Pure CSS, no client JS. */

const TREND_BARS = [40, 55, 45, 60, 50, 70, 58];
const NAV_LABELS = ["Home", "Vitals", "Care", "You"];

export function AppDashboardMockup({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="relative mx-auto w-[260px] rounded-[36px] bg-clinical-navy p-3.5 shadow-2xl shadow-charcoal-ink/25">
        <div
          className="absolute left-1/2 top-3.5 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-clinical-navy"
          aria-hidden
        />
        <div className="flex min-h-[400px] flex-col overflow-hidden rounded-[24px] bg-warm-ivory">
          <div className="flex items-center justify-between bg-white px-4 pb-3 pt-5">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-charcoal-ink/50">
                Good morning
              </p>
              <p className="font-heading text-sm font-semibold text-charcoal-ink">Amaka</p>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-green text-xs font-bold text-white">
              A
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-2.5 p-3">
            <div className="rounded-2xl bg-white p-3.5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-charcoal-ink">Blood pressure</p>
                <span className="rounded-full bg-brand-green/10 px-2 py-0.5 text-[10px] font-semibold text-brand-green">
                  In range
                </span>
              </div>
              <p className="mt-1 font-heading text-2xl font-bold text-charcoal-ink">
                118<span className="text-base font-medium text-charcoal-ink/50">/76</span>
              </p>
              <div className="mt-2 flex h-8 items-end gap-1" aria-hidden>
                {TREND_BARS.map((h, i) => (
                  <span
                    key={i}
                    className="flex-1 rounded-sm bg-brand-green/25"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-2xl bg-white p-3.5 shadow-sm">
              <p className="text-xs font-semibold text-charcoal-ink">Next up</p>
              <div className="mt-2 flex items-center gap-2.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-sprout-gold" aria-hidden />
                <p className="text-xs leading-snug text-charcoal-ink/70">
                  HbA1c screening due in 12 days
                </p>
              </div>
              <div className="mt-2 flex items-center gap-2.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-brand-green" aria-hidden />
                <p className="text-xs leading-snug text-charcoal-ink/70">Metformin, taken today</p>
              </div>
            </div>

            <div className="rounded-2xl bg-brand-green px-3.5 py-3 text-center text-xs font-semibold text-white">
              Log today&apos;s reading
            </div>
          </div>

          <div
            className="flex items-center justify-around border-t border-charcoal-ink/5 bg-white py-2.5"
            aria-hidden
          >
            {NAV_LABELS.map((label) => (
              <span key={label} className="text-[9px] font-medium text-charcoal-ink/40">
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
