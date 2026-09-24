import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { anyQueryFailed } from "@/lib/queries/server-query-state";
import { PatientsDirectory, type PatientPurchase, type PatientRow } from "./patients-directory";

export const metadata = { title: "Patients" };

const PAID_STATUSES = new Set(["active", "completed", "expired"]);

/**
 * Super-admin patient roster: contact details, join date, and purchase
 * history across every patient on the platform. Deliberately does NOT
 * follow the /admin/** pattern of also admitting a delegated permission key
 * (see e.g. the duplicates page's `patients.duplicates.review`) — bulk
 * name+email+DOB+purchase-history for every patient is the single most
 * sensitive read this console offers, and per the platform's shipped I9
 * decision (institutions get aggregate-only patient access, ever; only the
 * super admin may drill into an individual patient) this stays admin-role
 * only, full stop.
 */
export default async function AdminPatientsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/admin");

  const svc = createServiceRoleClient();

  const [profilesRes, servicePurchasesRes, programmePurchasesRes, platformCreditRes] = await Promise.all([
    svc
      .from("profiles")
      .select(
        "id, full_name, date_of_birth, sex, phone, city, state, patient_number, organisation_id, created_at, app_last_active_at, is_active, organisations(name)"
      )
      .eq("role", "patient")
      .order("created_at", { ascending: false })
      .limit(5000),
    svc
      .from("service_purchases")
      .select("patient_id, amount_kobo, status, purchased_at, created_at, service_products(name)")
      .order("purchased_at", { ascending: false })
      .limit(20000),
    svc
      .from("programme_purchases")
      .select(
        "patient_id, price_kobo, status, purchased_at, created_at, chronic_condition_programmes(name)"
      )
      .order("purchased_at", { ascending: false })
      .limit(20000),
    svc
      .from("platform_credit_balances")
      .select("patient_id, balance_kobo, promo_balance_kobo")
      .limit(20000),
  ]);

  const { data: profiles } = profilesRes;
  const { data: servicePurchases } = servicePurchasesRes;
  const { data: programmePurchases } = programmePurchasesRes;
  const { data: platformCreditBalances } = platformCreditRes;
  const readFailed = anyQueryFailed([profilesRes, servicePurchasesRes, programmePurchasesRes, platformCreditRes]);

  // auth.users isn't reachable via PostgREST — pull emails via the admin API
  // and map onto profiles by id, same pattern as /admin/settings/members.
  // last_sign_in_at comes along for free from the same call — it's the
  // actual login event ("last visited the platform"), distinct from
  // app_last_active_at below (a heartbeat pinged every few minutes while a
  // dashboard tab stays open/visible, i.e. "last activity").
  const emailById = new Map<string, string | null>();
  const lastSignInById = new Map<string, string | null>();
  let page = 1;
  for (;;) {
    const { data: usersPage } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    const list = usersPage?.users ?? [];
    list.forEach((u) => {
      emailById.set(u.id, u.email ?? null);
      lastSignInById.set(u.id, u.last_sign_in_at ?? null);
    });
    if (list.length < 200) break;
    page += 1;
    if (page > 25) break; // defensive cap, mirrors the members page
  }

  const purchasesByPatient = new Map<string, PatientPurchase[]>();
  function pushPurchase(patientId: string, purchase: PatientPurchase) {
    const arr = purchasesByPatient.get(patientId) ?? [];
    arr.push(purchase);
    purchasesByPatient.set(patientId, arr);
  }
  (servicePurchases ?? []).forEach((p) => {
    const product = p.service_products as { name: string } | null;
    pushPurchase(p.patient_id, {
      label: product?.name ?? "Service purchase",
      amountKobo: p.amount_kobo ?? 0,
      status: p.status,
      purchasedAt: p.purchased_at ?? p.created_at,
    });
  });
  (programmePurchases ?? []).forEach((p) => {
    const programme = p.chronic_condition_programmes as { name: string } | null;
    pushPurchase(p.patient_id, {
      label: programme?.name ? `${programme.name} programme` : "Chronic-care programme",
      amountKobo: p.price_kobo ?? 0,
      status: p.status,
      purchasedAt: p.purchased_at ?? p.created_at,
    });
  });

  const platformCreditByPatient = new Map(
    (platformCreditBalances ?? []).map((b) => [
      b.patient_id,
      { balanceKobo: b.balance_kobo, promoBalanceKobo: b.promo_balance_kobo },
    ])
  );

  const rows: PatientRow[] = (profiles ?? []).map((p) => {
    const org = p.organisations as { name: string } | null;
    const purchases = (purchasesByPatient.get(p.id) ?? []).sort(
      (a, b) => new Date(b.purchasedAt ?? 0).getTime() - new Date(a.purchasedAt ?? 0).getTime()
    );
    // "Bought" means money actually changed hands — pending/cancelled/refunded
    // purchases still show in the itemised history below, they just don't
    // count toward the spend total or the headline purchase count.
    const paidPurchases = purchases.filter((pu) => PAID_STATUSES.has(pu.status));
    return {
      id: p.id,
      fullName: p.full_name,
      email: emailById.get(p.id) ?? null,
      dateOfBirth: p.date_of_birth,
      sex: p.sex,
      phone: p.phone,
      city: p.city,
      state: p.state,
      patientNumber: p.patient_number,
      organisationName: org?.name ?? null,
      isActive: p.is_active,
      createdAt: p.created_at,
      lastVisitAt: lastSignInById.get(p.id) ?? null,
      lastActiveAt: p.app_last_active_at,
      purchaseCount: paidPurchases.length,
      totalSpentKobo: paidPurchases.reduce((sum, pu) => sum + pu.amountKobo, 0),
      lastPurchaseAt: paidPurchases[0]?.purchasedAt ?? null,
      purchases,
      platformCreditBalanceKobo: platformCreditByPatient.get(p.id)?.balanceKobo ?? 0,
      platformCreditPromoBalanceKobo: platformCreditByPatient.get(p.id)?.promoBalanceKobo ?? 0,
    };
  });

  // Audit trail for who pulled the full patient roster and when. No other
  // admin surface exposes bulk PII at this scale, so "who looked at this"
  // matters here even though the read itself succeeded — mirrors the
  // audit_log write in admin/settings/members/actions.ts.
  if (!readFailed) {
    await svc.from("audit_log").insert({
      actor_id: profile.id,
      organisation_id: profile.organisation_id,
      action: "admin.patient_directory_viewed",
      entity_type: "patient_directory",
      entity_id: null,
      event: { patient_count: rows.length },
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Patients"
        description="Every registered patient across the platform — contact details, join date, and what they've purchased. Super admin only."
      />
      {readFailed ? (
        <LoadFailure>
          The patient directory could not be fully loaded. Counts and purchase history here may be
          incomplete — reload before exporting or relying on this list.
        </LoadFailure>
      ) : (
        <PatientsDirectory rows={rows} />
      )}
    </div>
  );
}
