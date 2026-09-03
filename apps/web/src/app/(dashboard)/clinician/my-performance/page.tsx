import { MyPerformanceView } from "./my-performance-view";

/**
 * Care Team / Provider Workspace §5.21 — a clinician's own performance,
 * separate from analytics/doctors (the de-identified, is_analyst()-gated,
 * cross-org console version). All data comes from my_provider_performance
 * (20260827203759), called client-side by MyPerformanceView — no server
 * fetch needed here.
 */
export default function ClinicianMyPerformancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">My performance</h1>
        <p className="text-sm text-charcoal-ink/60">
          Your own clinical activity, never compared against colleagues, and never a substitute
          for clinical judgement.
        </p>
      </div>
      <MyPerformanceView />
    </div>
  );
}
