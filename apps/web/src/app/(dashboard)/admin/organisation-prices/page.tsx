import { redirect } from "next/navigation";
import { z } from "zod";
import { formatNaira } from "@tarragon/commerce";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPatientDate } from "@/lib/format-date";
import { ClearPriceForm, SetPriceForm } from "./price-forms";
import { organisationPriceLimits } from "./limits";

export const metadata = { title: "Organisation prices" };
export const dynamic = "force-dynamic";

const view = z.object({
  limits: z.object({ min_kobo: z.number().int(), max_kobo: z.number().int() }),
  module_open: z.boolean(),
  default: z.object({ amount_kobo: z.number().int(), valid_from: z.string() }).nullable(),
  organisations: z.array(z.object({
    id: z.string(), name: z.string(), type: z.string(), amount_kobo: z.number().int().nullable(), source: z.enum(["default", "override"]), active_seats: z.number().int(),
  })),
  history: z.array(z.object({
    employer_organisation_id: z.string().nullable(), employer_name: z.string().nullable(), amount_kobo: z.number().int(),
    valid_from: z.string(), valid_to: z.string().nullable(), reason: z.string(),
  })),
});

export default async function AdminOrganisationPricesPage() {
  const profile = await getCurrentProfile();
  // proxy.ts already keeps non-admins out of /admin; this is the page's own check.
  if (profile?.role !== "admin") redirect("/admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_organisation_prices");
  const parsed = view.safeParse(data);
  const limits = organisationPriceLimits();

  return (
    <div className="space-y-6">
      <PageHeader title="Organisation prices" backTo={{ href: "/admin", label: "Admin" }}
        description="What an organisation pays for each employee it covers with Membership. One flat default applies to every organisation; you can set a different price for one organisation. Prices are never edited: a new price starts on a date, and every seat keeps the price it was made at." />
      {error || !parsed.success ? (
        <p role="alert">The organisation prices could not be loaded. Please refresh.</p>
      ) : (
        <>
          <p role="status">
            Organisation-paid Membership is <strong>{parsed.data.module_open ? "open" : "closed"}</strong>. It is a platform module (<code>organisation_membership</code>) that only a superadmin switches on.
            A price must be between ₦{formatNaira(limits.minKobo)} and ₦{formatNaira(limits.maxKobo)}.
          </p>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Default price <Badge>every organisation without its own</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p>
                Current default: {parsed.data.default ? `₦${formatNaira(parsed.data.default.amount_kobo)} per member per year, since ${formatPatientDate(parsed.data.default.valid_from)}` : "none"}.
              </p>
              <SetPriceForm organisationId={null} idPrefix="default" />
            </CardContent>
          </Card>
          <h2 className="text-lg font-semibold">Organisations</h2>
          {parsed.data.organisations.length === 0 ? <p>No employer or HMO organisations yet.</p> : null}
          {parsed.data.organisations.map((o) => (
            <Card key={o.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {o.name} <Badge>{o.type}</Badge> <Badge>{o.source === "override" ? "own price" : "default price"}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p>
                  Pays {o.amount_kobo ? `₦${formatNaira(o.amount_kobo)}` : "no price set"} per member per year. Active seats: {o.active_seats}.
                </p>
                <details>
                  <summary className="min-h-11 cursor-pointer">Set a price for {o.name}</summary>
                  <div className="mt-2"><SetPriceForm organisationId={o.id} idPrefix={`org-${o.id}`} /></div>
                </details>
                {o.source === "override" ? (
                  <details>
                    <summary className="min-h-11 cursor-pointer">Put {o.name} back on the default</summary>
                    <div className="mt-2"><ClearPriceForm organisationId={o.id} idPrefix={`org-${o.id}`} /></div>
                  </details>
                ) : null}
              </CardContent>
            </Card>
          ))}
          <details>
            <summary className="min-h-11 cursor-pointer">Price history ({parsed.data.history.length})</summary>
            <ul className="mt-2 space-y-1">
              {parsed.data.history.map((p, idx) => (
                <li key={`${p.employer_organisation_id ?? "default"}-${p.valid_from}-${idx}`}>
                  {p.employer_name ?? "Default"}: ₦{formatNaira(p.amount_kobo)} from {formatPatientDate(p.valid_from)}
                  {p.valid_to ? ` to ${formatPatientDate(p.valid_to)}` : " (current)"}: {p.reason}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
