import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { AnalyticsManager } from "./analytics-manager";

export default async function HealthEducationAnalyticsPage() {
  const profile = await getCurrentProfile();

  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/settings/health-education"
          className="mb-1 inline-block text-xs font-medium text-charcoal-ink/60 hover:text-brand-green"
        >
          ← Health education library
        </Link>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Health education analytics
        </h1>
        <p className="text-charcoal-ink/60">
          Content viewed, completion, quiz performance, and patient feedback per catalogue item
          (docs Module 20 §20.18).
        </p>
      </div>
      <AnalyticsManager />
    </div>
  );
}
