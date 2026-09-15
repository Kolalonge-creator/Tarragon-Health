"use client";

import { koboToNaira, type Enums } from "@tarragon/shared";
import {
  useSponsorCareReport,
  useMySponsorSharing,
  useSetSponsorSharing,
} from "@/lib/queries/sponsor-care-report";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPatientDate } from "@/lib/format-date";

function when(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return formatPatientDate(date, { day: "numeric", month: "long", year: "numeric" });
}

/**
 * What a sponsor sees about someone they are paying for.
 *
 * The order of this card is the argument it makes. Payment facts first, because
 * those are the sponsor's own transaction record and they are always available.
 * Activity second, and only where the patient chose to share it. Nothing
 * clinical, ever, at any level.
 *
 * When sharing is 'none' this says so plainly and says whose decision it was.
 * The failure to avoid is a sponsor concluding the platform is broken, or worse
 * that nothing is happening, when in fact someone exercised a choice that is
 * theirs to make.
 */
export function SponsorCareReport({
  beneficiaryId,
  beneficiaryName,
}: {
  beneficiaryId: string;
  beneficiaryName: string;
}) {
  const { data: report, isLoading, isError } = useSponsorCareReport(beneficiaryId);

  if (isLoading) {
    return <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>;
  }
  if (isError || !report) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        Could not load this report just now.
      </p>
    );
  }

  const totalPaid = report.vouchers.reduce((sum, voucher) => sum + (voucher.paid_kobo ?? 0), 0);
  const used = report.vouchers.filter((voucher) => voucher.redeemed_at).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What your money paid for</CardTitle>
        <CardDescription>
          {beneficiaryName}&apos;s care, as far as they have chosen to share it with you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-soft-sage/40 p-3">
            <p className="text-xs text-charcoal-ink/55 dark:text-night-ink/55">You have paid</p>
            <p className="text-lg font-semibold text-charcoal-ink dark:text-night-ink">
              ₦{koboToNaira(totalPaid).toLocaleString("en-NG")}
            </p>
          </div>
          <div className="rounded-lg bg-soft-sage/40 p-3">
            <p className="text-xs text-charcoal-ink/55 dark:text-night-ink/55">Used so far</p>
            <p className="text-lg font-semibold text-charcoal-ink dark:text-night-ink">
              {used} of {report.vouchers.length}
            </p>
          </div>
          {report.monitoring_active_until ? (
            <div className="rounded-lg bg-brand-green/10 p-3">
              <p className="text-xs text-charcoal-ink/55 dark:text-night-ink/55">Watched until</p>
              <p className="text-lg font-semibold text-deep-forest dark:text-brand-green-bright">
                {when(report.monitoring_active_until)}
              </p>
            </div>
          ) : null}
        </div>

        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {report.vouchers.map((voucher) => (
            <li key={voucher.voucher_number} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="text-sm text-charcoal-ink dark:text-night-ink">
                  {voucher.what ?? "Care voucher"}
                </p>
                <p className="text-xs text-charcoal-ink/55 dark:text-night-ink/55">
                  {voucher.redeemed_at
                    ? `Used on ${when(voucher.redeemed_at)}`
                    : voucher.activated_at
                      ? `Accepted on ${when(voucher.activated_at)}, not used yet`
                      : "Waiting for them to accept it"}
                </p>
              </div>
              <Badge variant={voucher.redeemed_at ? "green" : "grey"}>
                ₦{koboToNaira(voucher.paid_kobo).toLocaleString("en-NG")}
              </Badge>
            </li>
          ))}
        </ul>

        {report.sharing_level === "none" ? (
          <p className="rounded-lg bg-charcoal-ink/[0.04] p-3 text-xs leading-relaxed text-charcoal-ink/70 dark:bg-night-ink/10 dark:text-night-ink/70">
            {report.note}
          </p>
        ) : (
          <div className="space-y-2 rounded-lg bg-charcoal-ink/[0.04] p-3 dark:bg-night-ink/10">
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/55 dark:text-night-ink/55">
              How it is going, in the last 30 days
            </p>
            <ul className="space-y-1 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
              <li>
                {report.readings_logged
                  ? `${report.readings_logged} reading${report.readings_logged === 1 ? "" : "s"} logged.`
                  : "No readings logged yet this month."}
              </li>
              {report.last_clinical_review ? (
                <li>A doctor reviewed their readings on {when(report.last_clinical_review)}.</li>
              ) : null}
              {report.next_check_due ? (
                <li>Their next check is due {when(report.next_check_due)}.</li>
              ) : null}
            </ul>
            <p className="text-xs leading-relaxed text-charcoal-ink/55 dark:text-night-ink/55">
              {report.note}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const LEVEL_COPY: Record<
  Enums<"sponsor_sharing_level">,
  { title: string; body: string }
> = {
  none: {
    title: "Only that they paid",
    body: "They can see what they bought and whether you have used it. Nothing about how you are doing.",
  },
  activity: {
    title: "That, plus how it is going",
    body: "They also see how many readings you logged, that a doctor reviewed them, and when your next check is due. Never your actual numbers, results or diagnoses.",
  },
  full: {
    title: "That, plus your progress report",
    body: "Everything above, plus the quarterly progress report you can already download yourself.",
  },
};

/**
 * The patient's side of the same boundary.
 *
 * Deliberately framed as a decision the patient is making about a person, not a
 * privacy setting buried in a list. Default is 'none' and that is stated, so
 * nobody has to discover what is being shared after the fact.
 */
export function SponsorSharingControl({ organisationId }: { organisationId: string }) {
  const { data: preferences, isLoading } = useMySponsorSharing();
  const setSharing = useSetSponsorSharing();

  if (isLoading) return null;
  if (!preferences || preferences.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What the people paying for your care can see</CardTitle>
        <CardDescription>
          Someone paying for your care can always see what they bought and whether you used it.
          Anything beyond that is your decision, and you can change it whenever you like.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {preferences.map((preference) => {
          const sponsor = Array.isArray(preference.sponsor)
            ? preference.sponsor[0]
            : preference.sponsor;
          return (
            <div key={preference.id} className="space-y-2">
              <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                {sponsor?.full_name ?? "Someone supporting you"}
              </p>
              <div className="space-y-2">
                {(["none", "activity", "full"] as const).map((level) => (
                  <label
                    key={level}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                      preference.level === level
                        ? "border-brand-green bg-brand-green/[0.06]"
                        : "border-charcoal-ink/10 dark:border-night-ink/15"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`sharing-${preference.id}`}
                      className="mt-1"
                      checked={preference.level === level}
                      onChange={() =>
                        setSharing.mutate({
                          organisationId,
                          sponsorId: preference.sponsor_id,
                          level,
                        })
                      }
                    />
                    <span>
                      <span className="block text-sm text-charcoal-ink dark:text-night-ink">
                        {LEVEL_COPY[level].title}
                      </span>
                      <span className="block text-xs leading-relaxed text-charcoal-ink/60 dark:text-night-ink/60">
                        {LEVEL_COPY[level].body}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
