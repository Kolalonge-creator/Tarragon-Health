import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EXPORT_LABELS, SECURITY_RULE_LABELS, loadSecurityOverview } from "@/lib/security/security-overview";

export const metadata = { title: "Security" };
export const dynamic = "force-dynamic";

const WHEN = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });

function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-charcoal-ink/60">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {note && <p className="text-xs text-charcoal-ink/60">{note}</p>}
    </div>
  );
}

/**
 * Internal security dashboard (security audit 2026-11-05, Phase 3). Every number comes from something the platform records;
 * nothing is estimated. Admin only, here and in the database function behind it.
 */
export default async function SecurityPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const loaded = await loadSecurityOverview(await createClient());
  if (!loaded.ok) return <p className="text-sm text-red-700">{loaded.message}</p>;
  const o = loaded.value;
  const review = o.staff_access_review;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Security</h1>
        <p className="text-sm text-charcoal-ink/60">
          Built only from what the platform records. Updated {WHEN.format(new Date(o.generated_at))}.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Open security alerts</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {o.open_security_alerts.length === 0 ? (
            <p className="text-charcoal-ink/60">None open.</p>
          ) : (
            <ul className="space-y-2">
              {o.open_security_alerts.map((a, i) => (
                <li key={`${a.rule}-${i}`}>
                  <strong>{SECURITY_RULE_LABELS[a.rule] ?? a.rule}</strong> ({a.severity}), since {WHEN.format(new Date(a.first_seen_at))}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2"><Link className="underline underline-offset-4" href="/admin/ops/wall">Operations wall</Link> has every alert and who was told.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Sign-ins</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <Stat label="Failed, last 24 hours" value={o.failed_sign_ins.last_24h} />
          <Stat label="Failed, last 7 days" value={o.failed_sign_ins.last_7d} note={`${o.failed_sign_ins.accounts_7d} different accounts`} />
          <Stat label="Successful, last 7 days" value={o.sign_ins_7d} />
          <p className="text-xs text-charcoal-ink/60 sm:col-span-4">
            Failed sign-ins are counted from the web sign-in page. The phone app and the staff console are not counted yet.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Staff accounts</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <Stat label="Active" value={o.staff.active} note={`${o.staff.total} in all`} />
          <Stat label="Two-step sign-in on" value={`${o.staff.mfa_enrolled} of ${o.staff.active}`} />
          <Stat label={`No sign-in for ${o.staff.dormant_after_days} days`} value={o.staff.dormant} />
          <div className="rounded-md border p-3 text-sm">
            <p className="text-xs text-charcoal-ink/60">Staff access review</p>
            <p className={review.overdue ? "font-semibold text-red-700" : "font-semibold"}>
              {review.overdue ? "Due now" : `Next due ${DAY.format(new Date(review.next_due_at))}`}
            </p>
            <Link className="text-xs underline underline-offset-4" href="/admin/staff-access-review">
              {review.open_review_id ? "Continue the review" : "Open the review"}
            </Link>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Privileged changes, last 30 days</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {o.privileged_changes_30d.length === 0 ? (
            <p className="text-charcoal-ink/60">None.</p>
          ) : (
            <ul className="space-y-1">
              {o.privileged_changes_30d.map((c, i) => (
                <li key={`${c.at}-${i}`}>{WHEN.format(new Date(c.at))}: {c.change}, by {c.by}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Patient data exports, last 30 days</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {o.exports_30d.length === 0 ? (
            <p className="text-charcoal-ink/60">None.</p>
          ) : (
            <ul className="space-y-1">
              {o.exports_30d.map((e, i) => (
                <li key={`${e.at}-${i}`}>{WHEN.format(new Date(e.at))}: {EXPORT_LABELS[e.export] ?? e.export}, by {e.by}</li>
              ))}
            </ul>
          )}
          <p className="mt-2"><Link className="underline underline-offset-4" href="/admin/access-review">Record access review</Link> shows who opened which patient record.</p>
        </CardContent>
      </Card>
    </div>
  );
}
