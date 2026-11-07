import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dormantAfterDays, isDormant, loadReviewItems, loadReviewStatus } from "@/lib/security/staff-access-review";
import { CompleteReviewForm, DecisionForm, StartReviewForm } from "./review-forms";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Staff access review" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
const day = (iso: string | null) => (iso ? DATE.format(new Date(iso)) : "Never");

/**
 * The quarterly staff access review (security audit 2026-11-05, Phase 3). Every staff account is listed with its role, tier,
 * last sign-in and two-step status; an admin decides keep, change or remove for each, then completes the review. A decision
 * changes no permission by itself: "remove" and "change" are carried out on the member's own page.
 */
export default async function StaffAccessReviewPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const supabase = await createClient();
  const status = await loadReviewStatus(supabase);
  const dormantDays = dormantAfterDays();

  if (!status.ok) {
    return <p className="text-sm text-red-700">{status.message}</p>;
  }
  const s = status.value;
  const items = s.open_review_id ? await loadReviewItems(supabase, s.open_review_id) : null;
  const undecided = items?.ok ? items.value.filter((i) => i.decision === null).length : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff access review"
        description={
          <>
            Every {s.interval_days} days, confirm that each staff account still needs the access it has. Recording a decision changes
            nothing by itself: to remove or change access, open the member&apos;s page from the list.
          </>
        }
      />

      <Card>
        <CardHeader><CardTitle>Status</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Last completed: {day(s.last_completed_at)}</p>
          <p>
            {s.overdue ? <strong className="text-red-700">A review is due now.</strong> : <>Next due: {day(s.next_due_at)}</>}
          </p>
          {!s.open_review_id && <StartReviewForm />}
        </CardContent>
      </Card>

      {s.open_review_id && (
        <Card>
          <CardHeader><CardTitle>Accounts in this review</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!items?.ok ? (
              <p className="text-sm text-red-700">{items?.message ?? "The accounts could not be loaded."}</p>
            ) : (
              <ul className="divide-y">
                {items.value.map((i) => (
                  <li key={i.id} className="space-y-2 py-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link href={`/admin/members/${i.profile_id}`} className="font-medium underline-offset-4 hover:underline">
                        {i.profiles?.full_name ?? "Unnamed account"}
                      </Link>
                      <span className="text-charcoal-ink/60">
                        {i.role_at_review}
                        {i.doctor_tier_at_review ? `, ${i.doctor_tier_at_review.replaceAll("_", " ")}` : ""}
                        {i.is_test ? ", test account" : ""}
                        {i.active_at_review ? "" : ", already inactive"}
                      </span>
                    </div>
                    <p className="text-charcoal-ink/70">
                      Last sign-in: {day(i.last_sign_in_at)}
                      {isDormant(i.last_sign_in_at, dormantDays) ? ` (no sign-in for ${dormantDays} days or more)` : ""}
                      {" · "}
                      Two-step sign-in: {i.mfa_enrolled ? "on" : "off"}
                    </p>
                    {i.decision && (
                      <p className="text-charcoal-ink/70">
                        Decided: {i.decision}
                        {i.decision_note ? `, ${i.decision_note}` : ""}
                      </p>
                    )}
                    <DecisionForm itemId={i.id} current={i.decision} />
                  </li>
                ))}
              </ul>
            )}
            <CompleteReviewForm reviewId={s.open_review_id} undecided={undecided} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
