"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useCareReceipt, type CareReceipt, type ReceiptEvent } from "@/lib/queries/care-graph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Proof that the care happened.
 *
 * The thing a person 5,000km away is actually buying is not a dashboard. A
 * dashboard is something you have to remember to go and check, and it leaves
 * the work of being reassured with the person who is already worried. A receipt
 * is finished, dated, addressed to you, and says what happened.
 *
 * Design rules this screen holds to, all of them load-bearing rather than
 * decorative:
 *
 *   The narrative is the product. Days, in order, in words, not a chart. "Blood
 *   pressure recorded Tuesday. Reviewed by Dr Okonkwo Wednesday." A chart makes
 *   a reader do the interpreting; a receipt has already done it.
 *
 *   Attribution is real or absent. A doctor's name appears only where
 *   patient_timeline recorded an acting clinician. There is no "your care team"
 *   filler standing in for a name that was never captured — the null-gated
 *   ReviewedByDoctor rule in CLINICAL_TRUST_MODEL_SPEC §2, applied here.
 *
 *   Empty is a real state and gets a real answer. A month where nothing
 *   happened must SAY nothing happened. The single fastest way to destroy the
 *   trust this feature exists to build is to dress up a quiet month as activity.
 *
 *   The disclosure tier is the database's decision, never this component's.
 *   care_receipt derives it from the patient's live consent; everything here
 *   only renders what it was handed.
 */

function naira(kobo: number): string {
  return `₦${Math.round(kobo / 100).toLocaleString("en-NG")}`;
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function firstName(full: string): string {
  const trimmed = full.trim();
  const space = trimmed.indexOf(" ");
  return space > 0 ? trimmed.slice(0, space) : trimmed;
}

const CATEGORY_TONE: Record<string, "green" | "amber" | "grey"> = {
  review: "green",
  medication: "grey",
  tests: "grey",
  referral: "amber",
  hospital: "amber",
  contact: "grey",
};

/** One line of the story: what happened, when, and who did it. */
function EventLine({ event }: { event: ReceiptEvent }) {
  return (
    <li className="flex flex-col gap-1 border-l-2 border-brand-green/30 py-3 pl-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-charcoal-ink">{event.what}</span>
        <span className="text-sm text-charcoal-ink/60">{dayLabel(event.occurredAt)}</span>
      </div>
      {/* Only ever populated on a consented receipt — the activity tier is
          handed null here by the database, not filtered out by this component. */}
      {event.detail && <p className="text-sm text-charcoal-ink/70">{event.detail}</p>}
      {event.reviewedBy && (
        <p className="text-sm text-brand-green">
          Reviewed by {event.reviewedBy}
          {event.reviewedByCredential ? ` · ${event.reviewedByCredential}` : ""}
        </p>
      )}
      {/* self-start, or the badge stretches the full width of the flex column
          and reads as a progress bar rather than a label. */}
      <span className="self-start">
        <Badge variant={CATEGORY_TONE[event.category] ?? "grey"}>{event.category}</Badge>
      </span>
    </li>
  );
}

function Headline({ receipt }: { receipt: CareReceipt }) {
  const name = firstName(receipt.beneficiaryName);
  const s = receipt.summary;

  const stats: { value: number; label: string }[] = [
    { value: s.readingsRecorded, label: s.readingsRecorded === 1 ? "reading taken" : "readings taken" },
    { value: s.doctorReviews, label: s.doctorReviews === 1 ? "doctor review" : "doctor reviews" },
    { value: s.testsCompleted, label: s.testsCompleted === 1 ? "test done" : "tests done" },
    {
      value: s.medicationEvents,
      label: s.medicationEvents === 1 ? "medication update" : "medication updates",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-xl border border-brand-green/20 bg-brand-green/[0.04] p-4"
        >
          <p className="font-heading text-2xl font-semibold text-charcoal-ink">{stat.value}</p>
          <p className="text-xs text-charcoal-ink/60">
            {stat.label}
            {receipt.isSelf ? "" : ` for ${name}`}
          </p>
        </div>
      ))}
    </div>
  );
}

export function CareReceiptView({ beneficiaryId }: { beneficiaryId: string }) {
  // Whole calendar months, because that is the rhythm a sponsor pays on and the
  // rhythm they think in ("what did last month buy?").
  const [monthsBack, setMonthsBack] = useState(0);

  const { from, to } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 1);
    return { from: start.toISOString(), to: end.toISOString() };
  }, [monthsBack]);

  const { data: receipt, isLoading, isError, error } = useCareReceipt(beneficiaryId, from, to);

  if (isLoading) {
    return <p className="text-sm text-charcoal-ink/60">Putting the receipt together…</p>;
  }

  if (isError || !receipt) {
    const message =
      error instanceof Error && error.message.includes("do not have access")
        ? "You do not have access to this person's care. If they have removed you, they will have been told; ask them directly rather than us."
        : "We could not build this receipt. Please try again.";
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-red-600">{message}</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link href="/patient/supporting">Back to people you support</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const name = firstName(receipt.beneficiaryName);
  const monthLabel = new Date(receipt.periodFrom).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
  const nothingHappened = receipt.events.length === 0 && receipt.summary.readingsRecorded === 0;
  // The same receipt is read by a supporter and by the patient themselves, and
  // "Test recorded 1 reading" is a jarring thing to be told about your own
  // month. One subject, chosen once, used everywhere below.
  const subject = receipt.isSelf ? "You" : name;
  const possessive = receipt.isSelf ? "your" : `${name}'s`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setMonthsBack(monthsBack + 1)}
        >
          Earlier month
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={monthsBack === 0}
          onClick={() => setMonthsBack(Math.max(0, monthsBack - 1))}
        >
          Later month
        </Button>
        <span className="text-sm font-medium text-charcoal-ink">{monthLabel}</span>
        {/* window.print() rather than a generated PDF: a sponsor forwarding this
            to a sibling or keeping it for their records needs a file, and the
            browser already makes a good one. A server-rendered PDF would be a
            second copy of the disclosure logic to keep in step with the first. */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto print:hidden"
          onClick={() => window.print()}
        >
          Save or print
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {receipt.isSelf
              ? `Your care in ${monthLabel}`
              : `${receipt.beneficiaryName}'s care in ${monthLabel}`}
          </CardTitle>
          <CardDescription>
            {receipt.isSelf
              ? "What your care actually involved this month, and who did it."
              : `What your money paid for, and what ${name} actually received. Every line is taken from ${name}'s own record, not from anything we have written for you.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Headline receipt={receipt} />

          {nothingHappened ? (
            // A quiet month is told as a quiet month. Dressing this up is the
            // fastest possible way to lose the trust the receipt exists to earn.
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
              <p className="font-medium text-charcoal-ink">
                {receipt.isSelf
                  ? "Nothing was recorded this month."
                  : `Nothing was recorded for ${name} this month.`}
              </p>
              <p className="mt-1 text-sm text-charcoal-ink/70">
                No readings, no reviews, no medication or test activity.{" "}
                {receipt.isSelf
                  ? "That may simply mean a settled month. If it does not feel like one, your care team is a message away."
                  : `That may simply mean a settled month, or it may mean ${name} has not been logging anything. If you are not sure which, the best thing is to ask ${name} directly.`}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
                What happened
              </h2>
              {receipt.summary.readingsRecorded > 0 && (
                <p className="text-sm text-charcoal-ink/70">
                  {subject} recorded {receipt.summary.readingsRecorded}{" "}
                  {receipt.summary.readingsRecorded === 1 ? "reading" : "readings"} on{" "}
                  {receipt.readingDays.length}{" "}
                  {receipt.readingDays.length === 1 ? "day" : "different days"} this month
                  {receipt.readingDays.length > 0
                    ? `, most recently on ${shortDate(receipt.readingDays[0].day)}`
                    : ""}
                  .{" "}
                  {receipt.tier === "activity"
                    ? "The numbers themselves stay between them and their care team."
                    : ""}
                </p>
              )}
              {receipt.events.length > 0 ? (
                <ul className="space-y-1">
                  {receipt.events.map((event, index) => (
                    <EventLine key={`${event.occurredAt}-${index}`} event={event} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-charcoal-ink/60">
                  Readings were logged, but there were no appointments, tests or medication changes
                  this month.
                </p>
              )}
            </div>
          )}

          {receipt.careStatus && (
            <div className="rounded-xl border border-charcoal-ink/10 p-4">
              {/* Open cases are a live figure, not a figure for the month being
                  read. Saying so matters when someone is paging back through
                  earlier months and would otherwise read this as history. */}
              <h2 className="font-heading text-base font-semibold text-charcoal-ink">
                Is anyone looking at this? (right now, not just this month)
              </h2>
              <p className="mt-1 text-sm text-charcoal-ink/70">
                {receipt.careStatus.openCases === 0
                  ? "Nothing is currently waiting on a doctor."
                  : `${receipt.careStatus.openCases} ${
                      receipt.careStatus.openCases === 1 ? "thing is" : "things are"
                    } with a doctor now${
                      receipt.careStatus.nextReviewDue
                        ? `, due to be looked at by ${shortDate(receipt.careStatus.nextReviewDue)}`
                        : ""
                    }.`}
                {receipt.careStatus.lastReviewedAt
                  ? ` A doctor last reviewed ${possessive} care on ${shortDate(receipt.careStatus.lastReviewedAt)}.`
                  : ""}
              </p>
            </div>
          )}

          {receipt.money.vouchersBought > 0 && (
            <div className="space-y-2">
              <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
                {receipt.isSelf ? "Care bought for you" : "What you paid"}
              </h2>
              <p className="text-sm text-charcoal-ink/70">
                {naira(receipt.money.fundedKobo)} across {receipt.money.vouchersBought}{" "}
                {receipt.money.vouchersBought === 1 ? "purchase" : "purchases"} ·{" "}
                {receipt.money.vouchersUsed} used · {receipt.money.vouchersWaiting} still waiting to
                be used.
              </p>
              <ul className="divide-y divide-charcoal-ink/10">
                {receipt.money.items.map((item) => (
                  <li
                    key={item.voucherNumber}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                  >
                    <span className="text-sm text-charcoal-ink">
                      {item.what ?? "Care voucher"}{" "}
                      <span className="text-charcoal-ink/50">{item.voucherNumber}</span>
                    </span>
                    <span className="text-sm text-charcoal-ink/70">
                      {naira(item.amountKobo)} ·{" "}
                      {item.usedAt ? `used ${shortDate(item.usedAt)}` : "not used yet"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {receipt.tier === "activity" && !receipt.isSelf && (
            // Says plainly that there is more, and that it is not ours to give.
            // A supporter who does not understand why the receipt is thin will
            // assume the care is thin.
            <div className="rounded-xl bg-charcoal-ink/5 p-4">
              <p className="text-sm text-charcoal-ink/70">
                This receipt shows what care {name} received, not what it found. {name} has not
                shared their health information with you, and only {name} can change that from
                their own account. We will not ask them on your behalf.
              </p>
            </div>
          )}

          <p className="border-t border-charcoal-ink/10 pt-3 text-xs text-charcoal-ink/50">
            Prepared {shortDate(receipt.generatedAt)} from {possessive} own care record.
            {receipt.isSelf
              ? ""
              : ` ${name} can see that you opened this, and can remove your access at any time.`}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
