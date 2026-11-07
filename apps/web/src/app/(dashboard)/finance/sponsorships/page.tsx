import { Suspense } from "react";
import { SponsorshipsWorkspace } from "../_components/revenue-workspaces";

export const metadata = { title: "Family sponsorships" };

export default function FinanceSponsorshipsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink dark:text-night-ink">Family sponsorships</h1>
        <p className="max-w-3xl text-charcoal-ink/60 dark:text-night-ink/60">Payments made by one person for another person&apos;s care, including relatives abroad. The sponsor and the member are always kept apart.</p>
      </div>
      <Suspense fallback={null}>
      <SponsorshipsWorkspace />
      </Suspense>
    </div>
  );
}
