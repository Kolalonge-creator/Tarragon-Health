import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { CareProgrammeCatalogue, type CareProgrammeCatalogueItem } from "./care-programme-catalogue";

/**
 * The episodic-fee purchase surface: a flat, one-time fee for a bounded
 * window of chronic-disease care (e.g. the 12-Week Hypertension Programme),
 * replacing the retired subscription model. Every UpgradePrompt across the
 * app now links here instead of /patient/subscription.
 */
export default async function CareProgrammesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: programmes }, { data: purchases }] = await Promise.all([
    supabase
      .from("chronic_condition_programmes")
      .select("id, name, short_description, purchase_summary, price_kobo, default_duration_weeks")
      .eq("is_active", true)
      .order("launch_priority", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("programme_purchases")
      .select("programme_id, status, ends_at")
      .eq("patient_id", user.id)
      .in("status", ["pending_payment", "active"]),
  ]);

  const items: CareProgrammeCatalogueItem[] = (programmes ?? []).map((programme) => {
    const active = (purchases ?? []).find(
      (p) => p.programme_id === programme.id && p.status === "active",
    );
    const pending = (purchases ?? []).some(
      (p) => p.programme_id === programme.id && p.status === "pending_payment",
    );
    return {
      ...programme,
      activePurchase: active ? { ends_at: active.ends_at! } : null,
      pendingPurchase: pending,
    };
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <PageHeader
        title="Care Programmes"
        icon={NAV_ICON.review}
        backTo={{ href: "/patient", label: "Dashboard" }}
        description="A flat, one-time fee for a bounded window of doctor-led care for a specific condition — no subscription, no recurring charge."
      />
      <CareProgrammeCatalogue programmes={items} />
    </div>
  );
}
