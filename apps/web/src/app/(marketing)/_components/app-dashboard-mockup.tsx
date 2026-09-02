import Image from "next/image";

/**
 * App-promo visual for the "get the app" section: a real screenshot of the
 * patient Overview screen (captured from the iOS Simulator against a live
 * QA account), composited inside a plain CSS phone bezel — not a hand-drawn
 * mockup. Real product screens read as more credible here than an
 * illustrative facsimile, the same reasoning the brand guide already applies
 * to the homepage hero (real photography, never a generic mockup).
 */
export function AppDashboardMockup({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="relative mx-auto w-[280px] rounded-[36px] bg-clinical-navy p-3.5 shadow-2xl shadow-charcoal-ink/25">
        <div
          className="absolute left-1/2 top-3.5 z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-clinical-navy"
          aria-hidden
        />
        <div className="aspect-[1206/2270] w-full overflow-hidden rounded-[24px] bg-warm-ivory">
          <Image
            src="/marketing/photos/app-patient-overview.png"
            alt="The TarragonHealth patient app's Overview screen, showing a blood pressure reading, quick actions, and what's coming up next."
            width={1206}
            height={2270}
            className="h-full w-full object-cover object-top"
            sizes="280px"
          />
        </div>
      </div>
    </div>
  );
}
