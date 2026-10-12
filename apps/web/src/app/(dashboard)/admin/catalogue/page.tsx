import { redirect } from "next/navigation";
import { z } from "zod";
import { formatNaira } from "@tarragon/commerce";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPatientDate } from "@/lib/format-date";
import { ActiveForm, BringForwardForm, PriceForm } from "./catalogue-forms";

export const metadata = { title: "Catalogue and prices" };
export const dynamic = "force-dynamic";

/** The clock, read outside the render so the page stays a pure function of the data it was given and this one reading. */
const clockMs = (): number => Date.now();

const priceRow = z.object({ amount_kobo: z.number().int(), valid_from: z.string(), valid_to: z.string().nullable(), reason: z.string().nullable() });
const itemRow = z.object({
  code: z.string(), kind: z.string(), active: z.boolean(), note: z.string().nullable(), paid_orders: z.number().int(),
  duration_days: z.number().int().nullable(), uses: z.number().int().nullable(), grants_lead: z.boolean(), prices: z.array(priceRow),
});
const view = z.object({ checkout_open: z.boolean(), items: z.array(itemRow) });

export default async function AdminCataloguePage() {
  const profile = await getCurrentProfile();
  // proxy.ts already keeps non-admins out of /admin; this is the page's own check.
  if (profile?.role !== "admin") redirect("/admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_catalogue");
  const parsed = view.safeParse(data);

  return (
    <div className="space-y-6">
      <PageHeader title="Catalogue and prices" backTo={{ href: "/admin", label: "Admin" }}
        description="What patients can buy, at what price. An item sells only when it is switched on and checkout is open. Prices are never edited: a new price starts on a date, and every order keeps the price it was made at." />
      {error || !parsed.success ? (
        <p role="alert">The catalogue could not be loaded. Please refresh.</p>
      ) : (
        <>
          <p role="status">
            Checkout is <strong>{parsed.data.checkout_open ? "open" : "closed"}</strong>. It is a platform module (<code>v5_checkout</code>) that only a superadmin switches on, once prices are confirmed and clinicians are ready.
          </p>
          {parsed.data.items.map((i) => {
            // The price in force today, not the open-ended row: a parked price (starts far in the future) is not the current one.
            const now = clockMs();
            const current = i.prices.find((p) => new Date(p.valid_from).getTime() <= now && (p.valid_to === null || new Date(p.valid_to).getTime() > now));
            const parked = i.prices.find((p) => new Date(p.valid_from).getTime() > now && p.valid_to === null);
            return (
              <Card key={i.code}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {i.code} <Badge>{i.kind}</Badge> <Badge>{i.active ? "on" : "off"}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {i.note ? <p>{i.note}</p> : null}
                  <p>
                    Current price: {current ? `₦${formatNaira(current.amount_kobo)}` : "none"}. Paid orders (real): {i.paid_orders}.
                    {i.duration_days ? ` Runs ${i.duration_days} days.` : ""}{i.uses ? ` ${i.uses} uses.` : ""}{i.grants_lead ? " Needs a lead clinician slot." : ""}
                  </p>
                  {parked ? (
                    <div className="space-y-2" role="group" aria-label={`Parked price for ${i.code}`}>
                      <p>
                        Parked price: <strong>{`₦${formatNaira(parked.amount_kobo)}`}</strong>, not yet in force. It is set to start on {formatPatientDate(parked.valid_from)} so nothing changes until the founder says go.
                        {parked.reason ? ` ${parked.reason}` : ""}
                      </p>
                      <BringForwardForm code={i.code} />
                    </div>
                  ) : null}
                  <details>
                    <summary className="min-h-11 cursor-pointer">Price history ({i.prices.length})</summary>
                    <ul className="mt-2 space-y-1">
                      {i.prices.map((p) => (
                        <li key={p.valid_from}>
                          {`₦${formatNaira(p.amount_kobo)}`} from {formatPatientDate(p.valid_from)}{p.valid_to ? ` to ${formatPatientDate(p.valid_to)}` : new Date(p.valid_from).getTime() > now ? " (parked, not in force)" : " (current)"}{p.reason ? `: ${p.reason}` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                  <ActiveForm code={i.code} active={i.active} />
                  <PriceForm code={i.code} />
                </CardContent>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
