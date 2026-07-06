import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AdminPage() {
  const profile = await getCurrentProfile();

  return (
    <DashboardPlaceholder
      greeting={`Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      roleLabel="Admin"
      comingUp={[
        "Users, orgs, system health (API latency, WhatsApp delivery, ML status)",
        "Finance: MRR/ARR/churn/commission/receivables",
        "ML model versioning + batch re-scoring trigger",
        "Audit trail + NDPR export/erasure tools",
      ]}
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <Link href="/admin/settings/vitals-reminders" className="hover:underline">
              Vitals reminder cadence
            </Link>
          </CardTitle>
          <CardDescription>
            Set how often patients are nudged to log vitals — globally, per condition, or
            per patient.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/admin/settings/vitals-reminders"
            className="text-sm font-medium text-brand-green hover:underline"
          >
            Manage reminder settings →
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Link href="/admin/settings/medication-refills" className="hover:underline">
              Medication refill reminders
            </Link>
          </CardTitle>
          <CardDescription>
            Set how many days before a refill date patients get reminded — globally or per
            patient.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/admin/settings/medication-refills"
            className="text-sm font-medium text-brand-green hover:underline"
          >
            Manage refill settings →
          </Link>
        </CardContent>
      </Card>
    </DashboardPlaceholder>
  );
}
