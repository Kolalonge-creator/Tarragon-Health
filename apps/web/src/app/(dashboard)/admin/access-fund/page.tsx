import { redirect } from "next/navigation";
import { en, t, type MessageKey } from "@tarragon/i18n";
import { formatNaira } from "@tarragon/commerce";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { formatPatientDate } from "@/lib/format-date";
import { ApproveGrantForm, CancelGrantForm, ConfirmDonationForm, ExpiryButton } from "./forms";

export const metadata = { title: "Community Access Fund" };
export const dynamic = "force-dynamic";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const naira = (kobo: unknown) => `₦${formatNaira(typeof kobo === "number" ? kobo : 0)}`;

interface Overview {
  open: boolean;
  criteria: string[];
  real: { received_kobo: number; committed_kobo: number };
  test: { received_kobo: number; committed_kobo: number };
  pledges: { id: string; reference: string; amount_kobo: number; restricted_item_code: string | null; state: string; pledge_expires_at: string; is_test: boolean }[];
  grants: { id: string; patient_id: string; item_code: string; ceiling_kobo: number; status: string; criterion: string; expires_at: string; used_kobo: number | null; is_test: boolean }[];
}

/**
 * Operations screen for the Community Access Fund (S72, 19.11). Admin only. A gift is a restricted gift confirmed here when the bank transfer arrives; a grant
 * is approved against one of the published reasons with a reason written down. Nobody on this page sees or sets a balance that a person could spend (INV-09).
 */
export default async function AdminAccessFundPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_access_fund_overview");
  const ov = !error && data && typeof data === "object" ? (data as unknown as Overview) : null;
  const { data: cat } = await supabase.rpc("catalogue");
  const items = (Array.isArray(cat) ? cat : []).flatMap((r: unknown) => {
    const x = r as { code?: unknown; name_key?: unknown };
    return typeof x.code === "string" ? [{ code: x.code, name: typeof x.name_key === "string" && Object.hasOwn(en, x.name_key) ? t(x.name_key as MessageKey, "en") : x.code }] : [];
  });
  const labels: Record<string, string> = {};
  for (const c of ov?.criteria ?? []) { const k = `fund.criteria.${c}`; labels[c] = Object.hasOwn(en, k) ? t(k as MessageKey, "en") : c; }

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold">{t("fund.title", "en")}</h1>
      {!ov ? <p role="status">The fund overview could not be loaded.</p> : (
        <>
          <p role="status" className={MUTED}>{ov.open ? "The fund is open." : "The fund is closed: its go-live guard is off, so only test people can use it."}</p>
          <Card>
            <CardHeader><CardTitle>What the fund holds</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              <p>Real: {naira(ov.real.received_kobo)} received, {naira(ov.real.committed_kobo)} held for grants.</p>
              <p className={MUTED}>Test: {naira(ov.test.received_kobo)} received, {naira(ov.test.committed_kobo)} held for grants. Test and real are never mixed.</p>
              <p className={MUTED}>These figures are for staff. They are not a balance that anyone can spend.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Pledges waiting for a bank transfer</CardTitle></CardHeader>
            <CardContent>
              {ov.pledges.length === 0 ? <p className={MUTED}>None.</p> : (
                <ul className="divide-y">
                  {ov.pledges.map((p) => (
                    <li key={p.id} className="space-y-2 py-3">
                      <p className="font-medium">{p.reference}: {naira(p.amount_kobo)}{p.restricted_item_code ? ` for ${p.restricted_item_code}` : ""}{p.is_test ? " (test)" : ""}</p>
                      <p className={`text-sm ${MUTED}`}>{p.state === "lapsed" ? "Lapsed, but a late transfer can still be confirmed." : `Waits until ${formatPatientDate(p.pledge_expires_at)}.`}</p>
                      <ConfirmDonationForm id={p.id} reference={p.reference} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Approve a grant</CardTitle></CardHeader>
            <CardContent><ApproveGrantForm criteria={ov.criteria} items={items} labels={labels} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Grants</CardTitle></CardHeader>
            <CardContent>
              {ov.grants.length === 0 ? <p className={MUTED}>None yet.</p> : (
                <ul className="divide-y">
                  {ov.grants.map((g) => (
                    <li key={g.id} className="space-y-2 py-3">
                      <p className="font-medium">{g.item_code}: up to {naira(g.ceiling_kobo)}, {g.status}{g.is_test ? " (test)" : ""}</p>
                      <p className={`text-sm ${MUTED}`}>Reason: {labels[g.criterion] ?? g.criterion}. Ends {formatPatientDate(g.expires_at)}.{g.used_kobo !== null ? ` Used ${naira(g.used_kobo)}.` : ""}</p>
                      {g.status === "approved" ? <CancelGrantForm id={g.id} /> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <ExpiryButton />
        </>
      )}
    </div>
  );
}
