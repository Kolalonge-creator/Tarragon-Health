/**
 * Calm, clear statement that TarragonHealth does not handle emergencies. Placed
 * on the homepage and every programme page so it's seen, not buried. Deliberately
 * not fear-based (docs/BRAND_GUIDE.md voice); it states the boundary and points
 * to the right next step. Uses the clinical-status red family (a separate system
 * from brand colour) at a low intensity so it reads as important, not alarming.
 */
export function EmergencyNotice({ className }: { className?: string }) {
  return (
    <div
      role="note"
      className={`mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50/70 px-6 py-5 text-center ${className ?? ""}`}
    >
      <p className="font-heading text-base font-semibold text-red-800">
        In an emergency, go to your nearest hospital
      </p>
      <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/75">
        TarragonHealth is for ongoing and preventive care; it does not provide emergency
        treatment. If you or someone you care for has severe symptoms such as chest pain, trouble
        breathing, or signs of a stroke, go to the nearest hospital or call your local emergency
        number right away.
      </p>
    </div>
  );
}
