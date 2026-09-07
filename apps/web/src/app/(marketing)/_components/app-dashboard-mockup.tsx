import { PhoneMockup } from "./phone-mockup";

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
    <PhoneMockup
      className={className}
      src="/marketing/photos/app-patient-overview.png"
      alt="The TarragonHealth patient app's Overview screen, showing a blood pressure reading, quick actions, and what's coming up next."
      width={1206}
      height={2270}
      showNotch
    />
  );
}
