import { redirect } from "next/navigation";
import { z } from "zod";
import { formatNaira } from "@tarragon/commerce";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPatientDate } from "@/lib/format-date";
import { CreateDiscountCodeForm, DiscountCodeStatusForm } from "./discount-code-forms";

export const metadata = { title: "Membership discount codes" };
export const dynamic = "force-dynamic";

const codeRow = z.object({
  id: z.string().uuid(), code: z.string(), kind: z.enum(["percent", "fixed"]), percent: z.number().int().nullable(), fixed_kobo: z.number().int().nullable(),
  status: z.enum(["active", "paused", "ended"]), valid_from: z.string(), valid_to: z.string(), max_total_uses: z.number().int(), max_uses_per_person: z.number().int(),
  item_codes: z.array(z.string()), cohort_id: z.string().uuid().nullable(), used: z.number().int(),
});
const overview = z.object({ codes: z.array(codeRow) });
const catalogue = z.object({ checkout_open: z.boolean(), items: z.array(z.object({ code: z.string(), audience: z.string().default("patient"), active: z.boolean() })) });
const cohorts = z.array(z.object({ id: z.string().uuid(), name: z.string(), sponsor: z.string(), status: z.string() }));

/** Today in Lagos (UTC+1, no daylight saving), read once outside the render. */
const lagosToday = (): string => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);

export default async function AdminDiscountCodesPage() {
  const profile = await getCurrentProfile();
  // proxy.ts already keeps non-admins out of /admin; this is the page's own check.
  if (profile?.role !== "admin") redirect("/admin");
  const supabase = await createClient();
  const [{ data, error }, { data: catData }, { data: cohortData }] = await Promise.all([
    supabase.rpc("admin_pricing_overview"),
    supabase.rpc("admin_catalogue"),
    supabase.rpc("admin_list_sponsor_cohorts"),
  ]);
  const parsed = overview.safeParse(data);
  const cat = catalogue.safeParse(catData);
  const items = cat.success ? cat.data.items.filter((i) => i.audience === "patient") : [];
  const coh = cohorts.safeParse(cohortData);
  const openCohorts = coh.success ? coh.data.filter((c) => c.status === "active") : [];
  const cohortName = new Map((coh.success ? coh.data : []).map((c) => [c.id, c.name]));

  return (
    <div className="space-y-6">
      <PageHeader title="Membership discount codes" backTo={{ href: "/admin", label: "Admin" }}
        description="A percentage or a fixed amount off any catalogue item a patient buys at Membership checkout (the Membership, Membership Plus, and the items sold beside them). What a code gives is fixed when it is created; only its status can change. A code never takes the price below the third-party cost or the minimum payable." />
      <p>
        Codes for one-off laboratory, pharmacy, referral and doctor-time orders are a different thing and live on the <a href="/admin/promo-codes" className="underline">Promo codes</a> page.
      </p>
      {cat.success ? (
        <p role="status">
          Catalogue checkout is <strong>{cat.data.checkout_open ? "open" : "closed"}</strong>. A code can be created while it is closed, but no real patient can use one until a superadmin opens checkout (Catalogue and prices page).
        </p>
      ) : null}
      <Card>
        <CardHeader><CardTitle>New code</CardTitle></CardHeader>
        <CardContent>
          <CreateDiscountCodeForm items={items} cohorts={openCohorts} today={lagosToday()} />
        </CardContent>
      </Card>
      {error || !parsed.success ? (
        <p role="alert">The codes could not be loaded. Please refresh.</p>
      ) : parsed.data.codes.length === 0 ? (
        <p>No discount codes yet.</p>
      ) : (
        parsed.data.codes.map((c) => (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="font-mono">{c.code}</span> <Badge>{c.status}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p>
                {c.kind === "percent" ? `${c.percent ?? 0}% off` : `₦${formatNaira(c.fixed_kobo ?? 0)} off`}. Used {c.used} of {c.max_total_uses}, up to {c.max_uses_per_person} per person.
                {" "}Runs {formatPatientDate(c.valid_from)} to {formatPatientDate(c.valid_to)}.
              </p>
              <p>
                {c.item_codes.length === 0 ? "Any item." : `Only: ${c.item_codes.join(", ")}.`}
                {c.cohort_id ? ` Only cohort ${cohortName.get(c.cohort_id) ?? c.cohort_id}.` : ""}
              </p>
              <DiscountCodeStatusForm id={c.id} status={c.status} />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
