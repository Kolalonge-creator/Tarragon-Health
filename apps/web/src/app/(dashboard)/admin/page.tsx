import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";

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
    />
  );
}
