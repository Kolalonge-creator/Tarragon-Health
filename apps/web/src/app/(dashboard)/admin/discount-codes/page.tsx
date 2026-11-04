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
  badge: z.literal("founding_member").nullable().default(null),
});
const overview = z.object({ codes: z.array(codeRow) });
const catalogue = z.object({ checkout_open: z.boolean(), items: z.array(z.object({ code: z.string(), audience: z.string().default("patient"), active: z.boolean() })) });
const cohorts = z.array(z.object({ id: z.string().uuid(), name: z.string(), sponsor: z.string(), status: z.string() }));

/** The clock, read once per request outside the JSX so the page is a pure function of its data and this one reading. */
const clockMs = (): number => Date.now();
/** A date in Lagos (UTC+1, no daylight saving) as YYYY-MM-DD. */
const lagosDay = (ms: number): string => new Date(ms + 60 * 60 * 1000).toISOString().slice(0, 10);

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
  const now = clockMs();
  const today = lagosDay(now);

  return (
    <div className="space-y-6">
      <PageHeader title="Membership discount codes" backTo={{ href: "/admin", label: "Admin" }}
        description="A percentage or a fixed amount off any catalogue item a patient buys at Membership checkout (the Membership, Membership Plus, and the items sold beside them). What a code gives is fixed when it is created; only its status can change. A code never takes the price below the third-party cost or the minimum payable." />
      <p>
        Codes for one-off laboratory, pharmacy, referral and doctor-time orders are a different thing and live on the <a href="/admin/promo-codes" className="underline">Promo codes</a> page.
      </p>
      <p>
        A code made from a real admin account works for real patients only, and one made from a test admin account works for test patients only and is not listed here. To rehearse a code with a test patient, create it while signed in as the test admin.
      </p>
      {!cat.success ? <p role="alert">The catalogue items could not be loaded, so a new code cannot be limited to items right now.</p> : null}
      {!coh.success ? <p role="alert">Sponsor cohorts could not be loaded, so a new code cannot be limited to a cohort right now.</p> : null}
      {cat.success ? (
        <p role="status">
          Catalogue checkout is <strong>{cat.data.checkout_open ? "open" : "closed"}</strong>. A code can be created while it is closed, but no real patient can use one until a superadmin opens checkout (Catalogue and prices page).
        </p>
      ) : null}
      <Card>
        <CardHeader><CardTitle>New code</CardTitle></CardHeader>
        <CardContent>
          <CreateDiscountCodeForm items={items} cohorts={openCohorts} today={today} />
        </CardContent>
      </Card>
      {error || !parsed.success ? (
        <p role="alert">The codes could not be loaded. Please refresh.</p>
      ) : parsed.data.codes.length === 0 ? (
        <p>No discount codes yet.</p>
      ) : (
        parsed.data.codes.map((c) => {
          // The pricing engine only honours a code between its first and last day; a paused code resumed after its last day is 'active' in the
          // database but can never be used, so the list says so rather than showing 'active'.
          const expired = new Date(c.valid_to).getTime() <= now;
          const notYet = new Date(c.valid_from).getTime() > now;
          const shown = c.status === "ended" ? "ended" : expired ? "expired" : c.status === "active" && notYet ? "starts later" : c.status;
          return (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="font-mono">{c.code}</span> <Badge>{shown}</Badge>
                {c.badge === "founding_member" ? <Badge variant="blue">Founding member badge</Badge> : null}
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
              {expired && c.status !== "ended" ? <p>Its last day has passed, so it cannot be used again. Create a new code to run it again.</p> : <DiscountCodeStatusForm id={c.id} status={c.status} />}
            </CardContent>
          </Card>
          );
        })
      )}
    </div>
  );
}
