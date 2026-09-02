"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { koboToNaira } from "@tarragon/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useLabCatalogue } from "@/lib/queries/lab-orders";
import { CareMessageThread } from "@/components/care-message-thread";
import { EmergencyAccessRequest } from "./emergency-access-request";
import { useCareThreads, useStartThread } from "@/lib/queries/care-messages";
import { Textarea } from "@/components/ui/textarea";
import {
  useSponsorBookCare,
  useSponsorPayOrder,
  useSponsorPayableOrders,
  useSponsorRequestRefill,
  useSponsorSetBasics,
  useSupportedPeople,
  useSupportedPersonCareStatus,
  useSupportedPersonHealth,
  type SponsorPayableOrder,
  type SupportedPerson,
  type SupportedPersonHealth,
} from "@/lib/queries/sponsorship";
import {
  openTheirAccount,
  paySomeonesBill,
  paySomeonesPlan,
  splitBillWithThem,
  type SponsorActionState,
} from "./actions";
import { useActiveServiceProducts } from "@/lib/queries/service-products";

function naira(kobo: number): string {
  return `₦${koboToNaira(kobo).toLocaleString("en-NG")}`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The statement, free: a person supporting several people had to open each
 * card in turn to see what their money had funded, with nothing to hand to
 * an accountant or keep for their own records. Everything here — totals,
 * per-person breakdown, every voucher used — is already shown on this page;
 * this only reshapes it into one file. Charging for that reshaping, on top
 * of data the page already gives away, is what the platform's own
 * No-Hidden-Cost Promise argues against (see the retired sponsor-statement
 * add-on in 20260805225206_retire_sponsor_statement_addon_ship_free_instead.sql).
 */
function buildStatementCsv(people: SupportedPerson[]): string {
  const totalFunded = people.reduce((sum, p) => sum + p.fundedKobo, 0);
  const totalUsed = people.reduce((sum, p) => sum + p.usedVouchers.length, 0);
  const totalReady = people.reduce((sum, p) => sum + p.readyVouchers.length, 0);

  const lines: string[] = [
    "Tarragon Health — statement of care you have funded",
    `Generated,${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
    "",
    "Summary",
    `People you support,${people.length}`,
    `Total funded (NGN),${koboToNaira(totalFunded)}`,
    `Vouchers used,${totalUsed}`,
    `Vouchers paid for and waiting,${totalReady}`,
    "",
    "Detail",
    ["Person", "Voucher number", "What it's for", "Status", "Value (NGN)", "Paid so far (NGN)", "Used on", "Bought by you"]
      .map(csvCell)
      .join(","),
  ];

  for (const person of people) {
    const name = person.fullName ?? "Unnamed";
    const entries = [
      ...person.usedVouchers.map((v) => ({ v, status: "Used" })),
      ...person.readyVouchers.map((v) => ({ v, status: "Ready" })),
      ...person.savingVouchers.map((v) => ({ v, status: "Still paying" })),
    ];

    if (entries.length === 0) {
      lines.push([name, "", "No vouchers yet", "", "", "", "", ""].map(csvCell).join(","));
      continue;
    }

    for (const { v, status } of entries) {
      lines.push(
        [
          name,
          v.voucherNumber,
          v.label,
          status,
          String(koboToNaira(v.faceValueKobo)),
          String(koboToNaira(v.amountPaidKobo)),
          v.redeemedAt ? shortDate(v.redeemedAt) : "",
          v.boughtByMe ? "Yes" : "No",
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }

  return lines.join("\n");
}

function DownloadStatementButton({ people }: { people: SupportedPerson[] }) {
  function download() {
    const csv = buildStatementCsv(people);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tarragon-statement-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <Button type="button" variant="outline" onClick={download}>
      Download statement
    </Button>
  );
}

/**
 * Everyone this person supports, and what their money actually did.
 *
 * The problem this exists for is not payment. Sending money to Nigeria is a
 * solved, competitive, low-margin business. The problem is that once it lands
 * there is no receipt, no record and no way to know whether it reached care or
 * was absorbed into the general run of a household. What is on offer here is
 * the receipt: money in, money turned into a named booking on a named date.
 *
 * Money is unconditional here, because paying for someone's care tells you
 * nothing about their health. Everything clinical is conditional on that person
 * having said yes to this specific supporter, in their own app — a sponsor
 * being allowed to pay for care and a sponsor being allowed to read it are two
 * different questions with two different answers, and they are kept that way.
 */
export function SupportedPeople() {
  const { data: people, isLoading, isError } = useSupportedPeople();

  if (isLoading) {
    return <p className="text-sm text-charcoal-ink/60">Loading the people you support…</p>;
  }
  if (isError || !people) {
    return (
      <p className="text-sm text-red-600">
        Could not load this just now. Refresh the page and try again.
      </p>
    );
  }

  if (people.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>You are not supporting anyone yet</CardTitle>
          <CardDescription>
            Once someone names you as next of kin, or accepts a request to let you help manage
            their care, they appear here and you can fund their care directly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/patient/family">Set that up</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const totalReady = people.reduce((sum, p) => sum + p.readyVouchers.length, 0);
  const totalUsed = people.reduce((sum, p) => sum + p.usedVouchers.length, 0);
  const totalFunded = people.reduce((sum, p) => sum + p.fundedKobo, 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 py-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="font-heading text-2xl font-semibold text-charcoal-ink">
                {people.length}
              </p>
              <p className="text-sm text-charcoal-ink/60">
                {people.length === 1 ? "person you support" : "people you support"}
              </p>
            </div>
            <div>
              <p className="font-heading text-2xl font-semibold text-brand-green">{totalUsed}</p>
              <p className="text-sm text-charcoal-ink/60">
                {totalUsed === 1 ? "check has been used" : "checks have been used"}
                {totalFunded > 0 ? ` of ${naira(totalFunded)} you have paid` : ""}
              </p>
            </div>
            <div>
              <p className="font-heading text-2xl font-semibold text-charcoal-ink">{totalReady}</p>
              <p className="text-sm text-charcoal-ink/60">paid for and waiting to be used</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-charcoal-ink/10 pt-4">
            <p className="text-xs text-charcoal-ink/50">
              A statement of everyone you fund and what it paid for, in one file.
            </p>
            <DownloadStatementButton people={people} />
          </div>
        </CardContent>
      </Card>

      {people.map((person) => (
        <PersonCard key={person.profileId} person={person} />
      ))}
    </div>
  );
}

function PersonCard({
  person,
}: {
  person: SupportedPerson;
}) {
  const name = person.fullName ?? "This person";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-lg">{name}</CardTitle>
          <Badge variant={person.permissionLevel === "manage" ? "green" : "grey"}>
            {person.permissionLevel === "manage" ? "You can act for them" : "You can follow"}
          </Badge>
          {person.isDependentAccount && <Badge variant="grey">Child</Badge>}
        </div>
        <CardDescription>
          {person.lastFundedAt
            ? `You last bought care for them ${shortDate(person.lastFundedAt)}.`
            : "You have not bought anything for them yet."}{" "}
          {person.usedVouchers.length > 0
            ? `${person.usedVouchers.length} of what you bought has been used.`
            : "Nothing has been used yet."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-charcoal-ink/60">Paid for and waiting to be used</p>
            <p className="font-heading text-2xl font-semibold text-charcoal-ink">
              {person.readyVouchers.length}
            </p>
          </div>
        </div>

        {person.readyVouchers.length > 0 && (
          <ul className="space-y-1.5">
            {person.readyVouchers.map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between gap-3 text-sm text-charcoal-ink/70"
              >
                <span>
                  {v.label}
                  <span className="text-charcoal-ink/40"> · {v.voucherNumber}</span>
                </span>
                <Badge variant="green">Ready</Badge>
              </li>
            ))}
          </ul>
        )}

        {person.savingVouchers.map((v) => (
          <div key={v.id}>
            <div className="flex items-center justify-between text-xs text-charcoal-ink/60">
              <span>Still paying for {v.label}</span>
              <span>
                {naira(v.amountPaidKobo)} of {naira(v.faceValueKobo)}
              </span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-charcoal-ink/10">
              <div
                className="h-full rounded-full bg-brand-green"
                style={{
                  width: `${Math.min(100, Math.round((v.amountPaidKobo / v.faceValueKobo) * 100))}%`,
                }}
              />
            </div>
          </div>
        ))}

        {/* Buying a check for somebody is gone: tests are paid straight to the
            laboratory, so there is nothing for us to sell in advance (see
            public.purchase_care_voucher). Paying for their PLAN is the sponsor
            path that still works, and it lives above. */}

        {person.permissionLevel === "manage" && <OpenTheirAccount person={person} />}

        {person.permissionLevel === "manage" && <PayTheirPlan person={person} />}

        {person.permissionLevel === "manage" && <ManageActions person={person} />}

        {person.usedVouchers.length > 0 && (
          <div>
            <p className="text-xs font-medium text-charcoal-ink">What it has paid for</p>
            <ul className="mt-2 space-y-1.5">
              {person.usedVouchers.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between gap-3 text-sm text-charcoal-ink/70"
                >
                  <span>
                    {v.label}
                    <span className="text-charcoal-ink/40">
                      {v.redeemedAt ? ` · ${shortDate(v.redeemedAt)}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium text-charcoal-ink">
                    {naira(v.faceValueKobo)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {person.categories.length > 0 ? (
          <>
            <HealthSummary person={person} />
            <SupporterConversation person={person} />
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-charcoal-ink/50">
              You can see what their care costs and what it paid for, and nothing else. If they want
              you to follow how they are doing, they can turn that on themselves under &ldquo;Who can
              see your health information&rdquo;.
            </p>
            <EmergencyAccessRequest profileId={person.profileId} name={name} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const CONDITION_LABEL: Record<string, string> = {
  hypertension: "High blood pressure",
  diabetes: "Diabetes",
  obesity: "Weight",
  cardiovascular: "Heart health",
  asthma: "Asthma",
  ckd: "Kidney health",
  heart_failure: "Heart failure",
};

function humanCondition(condition: string): string {
  return CONDITION_LABEL[condition] ?? condition.replace(/_/g, " ");
}

/**
 * "156/96, up from 148/90."
 *
 * Two readings compared is a fact about two readings. It is not a judgement
 * about either, and it is the difference between a number a supporter can do
 * nothing with and one they can ask a sensible question about.
 */
function bpMovement(data: SupportedPersonHealth): string | null {
  const now = data.latestBloodPressure;
  const before = data.previousBloodPressure;
  if (!now?.systolic || !before?.systolic) return null;
  if (now.systolic === before.systolic) return null;
  const direction = now.systolic > before.systolic ? "up" : "down";
  return `${direction} from ${before.systolic}/${before.diastolic ?? "?"}`;
}

/**
 * Opens their account, so an errand can be run from inside it.
 *
 * The grant is checked here and re-checked on every request afterwards, so
 * this cannot outlive permission: the moment they revoke it, the next page
 * load is the supporter's own account again.
 */
function OpenTheirAccount({ person }: { person: SupportedPerson }) {
  const [state, action, pending] = useActionState<SponsorActionState, FormData>(
    openTheirAccount,
    undefined,
  );
  const name = (person.fullName ?? "").trim().split(/\s+/)[0] || "them";

  return (
    <form action={action} className="space-y-2 rounded-lg border border-charcoal-ink/10 p-4">
      <input type="hidden" name="beneficiaryProfileId" value={person.profileId} />
      <p className="text-xs font-medium text-charcoal-ink">Open their account</p>
      <p className="text-sm text-charcoal-ink/70">
        Go into {name}&apos;s account to log a reading or book something for them, the way you would
        if you were sitting next to them. Everything you do there is saved with your name on it.
      </p>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Opening…" : `Open ${name}'s account`}
      </Button>
      {state?.error && <p className="text-sm text-clinical-red">{state.error}</p>}
    </form>
  );
}

/**
 * One bill, paid on the supporter's own card.
 *
 * The amount is never posted from here: initiateSponsorBillCheckout reads it
 * back off the order through sponsor_payable_orders, which is also what
 * authorises the payment. So the price shown and the price charged cannot
 * drift, and a tampered form cannot change either.
 */
function PayBillOnMyCard({
  person,
  bill,
}: {
  person: SupportedPerson;
  bill: SponsorPayableOrder;
}) {
  const [state, action, pending] = useActionState<SponsorActionState, FormData>(
    paySomeonesBill,
    undefined,
  );

  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="beneficiaryProfileId" value={person.profileId} />
      <input type="hidden" name="orderId" value={bill.order_id} />
      <Button type="submit" disabled={pending}>
        {pending ? "Starting…" : `Pay ${naira(bill.amount_kobo)} on my card`}
      </Button>
      {state?.error && <span className="text-xs text-clinical-red">{state.error}</span>}
    </form>
  );
}

/**
 * §91.9 two-simultaneous-charges subsidy: pays only the sponsor's share of
 * this bill, on the sponsor's own card, leaving the person owing the
 * reduced remainder themselves — they pay that from their own account.
 * Whether there is anything to split and by how much is decided entirely
 * server-side by whatever subsidy_split_rules their organisation has
 * configured; splitBillWithThem() itself never states a split, so this
 * button is safe to show unconditionally and simply reports back if there
 * turned out to be nothing configured to split.
 *
 * Only lab, pharmacy, and referral bills can be split — a video visit is
 * out of §91.9's scope for now.
 */
function SplitBillWithThem({
  person,
  bill,
}: {
  person: SupportedPerson;
  bill: SponsorPayableOrder;
}) {
  const [state, action, pending] = useActionState<SponsorActionState, FormData>(
    splitBillWithThem,
    undefined,
  );

  if (bill.order_type === "video_visit") return null;

  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="beneficiaryProfileId" value={person.profileId} />
      <input type="hidden" name="orderId" value={bill.order_id} />
      <input type="hidden" name="orderType" value={bill.order_type} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Starting…" : "Split this bill with them"}
      </Button>
      {state?.error && <span className="text-xs text-clinical-red">{state.error}</span>}
      {state?.message && <span className="text-xs text-charcoal-ink/60">{state.message}</span>}
    </form>
  );
}

/**
 * Pay for their plan, monthly, on your card.
 *
 * The single most-asked-for diaspora action, and there was no path to it at
 * any price: a supporter could buy one-off vouchers and nothing else, so the
 * continuous monitoring that makes the product worth having was the one thing
 * they could not fund. "Send money home for health" is a thing a transfer app
 * already does; paying for a named plan and being told what it did is not.
 *
 * Only naira plans are offered. The care happens in Nigeria at Nigerian cost,
 * so a supporter abroad pays the same price converted at the reference rate,
 * not a diaspora premium for the same thing.
 */
function PayTheirPlan({ person }: { person: SupportedPerson }) {
  const { data: plans } = useActiveServiceProducts();
  const [state, action, pending] = useActionState<SponsorActionState, FormData>(
    paySomeonesPlan,
    undefined,
  );

  if (person.permissionLevel !== "manage") return null;

  const payable = (plans ?? []).filter((plan) => plan.currency === "NGN" && plan.price_kobo > 0);
  if (payable.length === 0) return null;

  return (
    <form action={action} className="space-y-2 rounded-lg border border-charcoal-ink/10 p-4">
      <input type="hidden" name="beneficiaryProfileId" value={person.profileId} />
      <p className="text-xs font-medium text-charcoal-ink">Pay for their plan</p>
      <div className="flex flex-wrap items-center gap-2">
        <Select name="planCode" defaultValue="" className="max-w-xs">
          <option value="">Choose a plan</option>
          {payable.map((plan) => (
            <option key={plan.code} value={plan.code}>
              {plan.name} ({naira(plan.price_kobo)}
              {plan.interval === "yearly" ? "/yr" : "/mo"})
            </option>
          ))}
        </Select>
        <Button type="submit" disabled={pending}>
          {pending ? "Starting…" : "Pay on my card"}
        </Button>
      </div>
      {state?.error && <p className="text-sm text-clinical-red">{state.error}</p>}
      <p className="text-xs text-charcoal-ink/50">
        Billed to you, held by them. They keep their own account and can cancel it themselves at any
        time. Both of you are told when it starts.
      </p>
    </form>
  );
}

/**
 * Whether anybody is actually doing anything about it.
 *
 * This is the single most important thing on the page and it was missing
 * entirely. A supporter could be shown a blood pressure of 156/96 while the
 * platform had already raised a doctor alert with a three-day deadline — and
 * be told nothing, so the only available reading of the screen was "a
 * frightening number and apparently no one has noticed".
 *
 * Status only, and by construction: sponsor_care_status returns counts and
 * dates, never the alert's title or reasoning, so this card cannot drift into
 * telling a family member what a clinician thinks before the clinician has
 * told the patient.
 */
function CareTeamStatus({ person, firstName }: { person: SupportedPerson; firstName: string }) {
  const { data } = useSupportedPersonCareStatus(person.profileId, person.categories.length > 0);
  if (!data) return null;

  if (data.openCount === 0) {
    return (
      <div className="rounded-lg bg-brand-green/10 p-3">
        <p className="text-sm text-charcoal-ink/80">
          Nothing is waiting on their care team right now.
          {data.lastReviewedAt
            ? ` A doctor last reviewed something on ${shortDate(data.lastReviewedAt)}.`
            : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-brand-green/10 p-3">
      <p className="text-sm font-medium text-charcoal-ink">
        {data.openCount === 1
          ? `Their care team is looking at something for ${firstName}.`
          : `Their care team is looking at ${data.openCount} things for ${firstName}.`}
      </p>
      {data.nextReviewDue && (
        <p className="mt-0.5 text-sm text-charcoal-ink/70">
          {data.reviewOverdue
            ? "A doctor was due to review this by " +
              shortDate(data.nextReviewDue) +
              ". We are chasing it."
            : `A doctor reviews it by ${shortDate(data.nextReviewDue)}.`}
        </p>
      )}
      <p className="mt-1 text-xs text-charcoal-ink/50">
        You are told that a review is happening, not what was found. {firstName} and their doctor
        discuss that first.
      </p>
    </div>
  );
}

/**
 * Turns a due refill into a bill you can settle.
 *
 * A medication with a refill date days away was visible here and completely
 * unactionable — there was no order to pay and no way to create one, so the
 * most ordinary thing a family member does for an elderly parent was the one
 * thing the page could not help with.
 *
 * Only offered inside two weeks of the refill date, and only to a supporter
 * trusted to act. The RPC refuses anything that is not already an active
 * prescribed medication, so this asks a pharmacy to dispense what a doctor
 * decided; it is never a route to a new prescription.
 */
function RefillAction({
  person,
  medication,
}: {
  person: SupportedPerson;
  medication: SupportedPersonHealth["medications"][number];
}) {
  const requestRefill = useSponsorRequestRefill();
  const [note, setNote] = useState<string | null>(null);

  const daysLeft = medication.daysUntilRefill;
  if (person.permissionLevel !== "manage" || daysLeft === null) return null;
  if (daysLeft > 14) return null;

  if (note) return <span className="text-xs text-brand-green">{note}</span>;

  return (
    <>
      <span className="text-xs text-charcoal-ink/50">
        {daysLeft <= 0 ? "supply has run out" : `${daysLeft} days left`}
      </span>
      <button
        type="button"
        disabled={requestRefill.isPending}
        onClick={() =>
          requestRefill.mutate(
            { beneficiaryId: person.profileId, medicationId: medication.id },
            {
              onSuccess: () => setNote("Added to their bills below — you can pay it there."),
              onError: (error) =>
                setNote(error instanceof Error ? error.message : "Could not arrange that refill."),
            },
          )
        }
        className="rounded-md border border-brand-green/40 px-2 py-0.5 text-xs text-brand-green disabled:opacity-50"
      >
        {requestRefill.isPending ? "Arranging…" : "Arrange refill"}
      </button>
    </>
  );
}

/**
 * How they are doing, for someone who has been told they may look.
 *
 * Rendered only when person.categories is non-empty, but that flag is a
 * courtesy, not the control: every query behind this reads a table whose RLS
 * checks the same per-category consent live, so a revoked supporter gets an
 * empty card rather than stale data even if this component were somehow
 * rendered anyway.
 *
 * Numbers are shown, never judged. There is no "her blood pressure is too
 * high" anywhere in here: interpretation belongs to the care team, and the
 * conversation below is how a supporter asks for it.
 */
function HealthSummary({ person }: { person: SupportedPerson }) {
  const { data, isLoading } = useSupportedPersonHealth(person.profileId, person.categories.length > 0);
  const name = person.fullName ?? "They";
  const firstName = (person.fullName ?? "").trim().split(/\s+/)[0] || "They";

  if (isLoading) {
    return <p className="text-sm text-charcoal-ink/60">Loading how they are doing…</p>;
  }
  if (!data) return null;

  const nothingYet =
    !data.latestBloodPressure &&
    data.activeConditions.length === 0 &&
    data.medications.length === 0 &&
    !data.nextScreeningDue &&
    !data.latestResult &&
    data.openFollowUps === 0;

  return (
    <div className="space-y-3 rounded-lg border border-charcoal-ink/10 p-4">
      <p className="text-xs font-medium text-charcoal-ink">How they are doing</p>

      <CareTeamStatus person={person} firstName={firstName} />

      {nothingYet ? (
        <p className="text-sm text-charcoal-ink/60">
          {name} has not logged anything yet. There is nothing to show until they do.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-charcoal-ink/60">Last blood pressure</p>
              <p className="font-heading text-lg font-semibold text-charcoal-ink">
                {data.latestBloodPressure
                  ? `${data.latestBloodPressure.systolic ?? "?"}/${data.latestBloodPressure.diastolic ?? "?"}`
                  : "Not logged yet"}
              </p>
              {data.latestBloodPressure && (
                <p className="text-xs text-charcoal-ink/50">
                  {shortDate(data.latestBloodPressure.takenAt)}
                  {bpMovement(data) ? ` · ${bpMovement(data)}` : ""}
                </p>
              )}
              {/* Their own care plan's number, quoted. Without a scale a
                  sponsor is staring at three digits they cannot read. */}
              {data.bloodPressureTarget && (
                <p className="text-xs text-charcoal-ink/50">
                  Care team&apos;s target: under {data.bloodPressureTarget.systolic}/
                  {data.bloodPressureTarget.diastolic}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-charcoal-ink/60">Last reading of any kind</p>
              <p className="font-heading text-lg font-semibold text-charcoal-ink">
                {data.latestReadingAt ? shortDate(data.latestReadingAt) : "None yet"}
              </p>
            </div>
            <div>
              <p className="text-xs text-charcoal-ink/60">Checks due</p>
              <p className="font-heading text-lg font-semibold text-charcoal-ink">
                {data.screeningsDue}
              </p>
              {data.nextScreeningDue && (
                <p className="text-xs text-charcoal-ink/50">
                  Next {shortDate(data.nextScreeningDue)}
                </p>
              )}
            </div>
          </div>

          {data.activeConditions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-charcoal-ink/60">Being looked after for</span>
              {data.activeConditions.map((condition) => (
                <Badge key={condition} variant="grey">
                  {humanCondition(condition)}
                </Badge>
              ))}
            </div>
          )}

          {(data.latestResult || data.openFollowUps > 0) && (
            <div className="space-y-1 rounded-lg bg-charcoal-ink/5 p-3">
              {data.latestResult && (
                <p className="text-sm text-charcoal-ink/70">
                  Last test result recorded {shortDate(data.latestResult.recordedAt)}
                  {data.latestResult.status === "normal"
                    ? " — nothing flagged."
                    : " — flagged for their care team."}
                </p>
              )}
              {data.openFollowUps > 0 && (
                <p className="text-sm text-charcoal-ink/70">
                  {data.openFollowUps === 1
                    ? "One follow-up is open with their care team."
                    : `${data.openFollowUps} follow-ups are open with their care team.`}{" "}
                  You can ask about it below.
                </p>
              )}
            </div>
          )}

          {data.medications.length > 0 && (
            <div>
              <p className="text-xs text-charcoal-ink/60">Currently taking</p>
              <ul className="mt-1 space-y-1">
                {data.medications.map((medication) => (
                  <li
                    key={medication.id}
                    className="flex flex-wrap items-center gap-2 text-sm text-charcoal-ink/70"
                  >
                    <span>
                      {medication.drugName}
                      {medication.dose ? ` · ${medication.dose}` : ""}
                    </span>
                    <RefillAction person={person} medication={medication} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <p className="text-xs text-charcoal-ink/50">
        {name} shared this with you and can stop sharing it at any time. You can read it; you
        cannot change any of it.
      </p>
    </div>
  );
}

/**
 * The three-way conversation, from the supporter's side.
 *
 * One thread, not a side channel: the same rows the patient and the care team
 * read, and the patient is notified of anything written here. That is what
 * makes it usable for a daughter in London — she can ask the question once,
 * the doctor answers once, and her mother in Enugu sees both, instead of an
 * answer being relayed down a phone line and half-remembered.
 */
function SupporterConversation({ person }: { person: SupportedPerson }) {
  const { data: threads, isLoading } = useCareThreads(person.profileId);
  const start = useStartThread();
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const name = person.fullName ?? "them";

  const ask = () => {
    setError(null);
    start.mutate(
      { subject, body, patientId: person.profileId },
      {
        onSuccess: (id) => {
          setSubject("");
          setBody("");
          setComposing(false);
          setOpenId(id);
        },
        onError: (cause) =>
          setError(cause instanceof Error ? cause.message : "That did not send. Try again."),
      }
    );
  };

  return (
    <div className="space-y-3 rounded-lg border border-charcoal-ink/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-charcoal-ink">Conversations with their care team</p>
        <Button type="button" size="sm" onClick={() => setComposing((open) => !open)}>
          {composing ? "Cancel" : "Ask a question"}
        </Button>
      </div>

      <p className="text-xs text-charcoal-ink/60">
        You, {name} and their care team all see the same thread, with who said what and when.
      </p>

      {composing && (
        <div className="space-y-3 rounded-lg bg-charcoal-ink/5 p-4">
          <div className="grid gap-2">
            <label
              className="text-xs font-medium text-charcoal-ink"
              htmlFor={`ask-subject-${person.profileId}`}
            >
              What is it about?
            </label>
            <Input
              id={`ask-subject-${person.profileId}`}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="e.g. Her blood pressure readings"
              maxLength={150}
            />
          </div>
          <div className="grid gap-2">
            <label
              className="text-xs font-medium text-charcoal-ink"
              htmlFor={`ask-body-${person.profileId}`}
            >
              Your question
            </label>
            <Textarea
              id={`ask-body-${person.profileId}`}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={3}
              maxLength={4000}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={start.isPending || subject.trim().length < 3 || body.trim().length === 0}
              onClick={ask}
            >
              {start.isPending ? "Sending…" : "Send"}
            </Button>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </div>
      )}

      {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
      {!isLoading && (threads ?? []).length === 0 && !composing && (
        <p className="text-sm text-charcoal-ink/60">No conversations yet.</p>
      )}

      <ul className="divide-y divide-charcoal-ink/10">
        {(threads ?? []).map((thread) => (
          <li key={thread.id} className="py-3">
            <button
              type="button"
              className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
              onClick={() => setOpenId(openId === thread.id ? null : thread.id)}
            >
              <span className="font-medium text-charcoal-ink">{thread.subject}</span>
              <span className="flex items-center gap-2">
                {thread.status === "closed" && <Badge variant="grey">Closed</Badge>}
                <span className="text-xs text-charcoal-ink/50">
                  {shortDate(thread.last_message_at)}
                </span>
              </span>
            </button>
            {openId === thread.id && (
              <div className="mt-3">
                <CareMessageThread
                  threadId={thread.id}
                  patientId={thread.patient_id}
                  closed={thread.status === "closed"}
                  showEmergencyNotice
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What a 'manage' grantee can actually do, as opposed to merely see.
 *
 * These three replace the jobs a dedicated coordinator would otherwise have
 * done by hand: settle the bill that is holding something up, book the check
 * that is due, and fill in the boring half of setup so an elderly parent is not
 * left alone with a wizard. None of them needs a person on the payroll, and
 * none of them is available to a 'view' next of kin.
 */
function ManageActions({ person }: { person: SupportedPerson }) {
  const { data: bills } = useSponsorPayableOrders(person.profileId, true);
  const { data: bundles } = useLabCatalogue();
  const payOrder = useSponsorPayOrder();
  const bookCare = useSponsorBookCare();
  const setBasics = useSponsorSetBasics();

  const [bundleCode, setBundleCode] = useState("");
  const [showBasics, setShowBasics] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selfBookable = (bundles ?? []).filter((bundle) => bundle.self_bookable);
  const outstanding = bills ?? [];

  async function run(work: () => Promise<string>) {
    setError(null);
    setMessage(null);
    try {
      setMessage(await work());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not go through. Try again.");
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-charcoal-ink/10 p-4">
      {outstanding.length > 0 && (
        <div>
          <p className="text-xs font-medium text-charcoal-ink">Waiting to be paid for</p>
          <ul className="mt-2 space-y-2">
            {outstanding.map((bill) => (
              <li key={bill.order_id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-charcoal-ink/70">
                  {bill.label}{" "}
                  <span className="font-medium text-charcoal-ink">{naira(bill.amount_kobo)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {/* Paying on your own card is the ordinary case, so it leads.
                      Redeeming a voucher only works when they already hold a
                      paid one for that exact named service, which most real
                      bills (a refill, a video visit, a test a clinician
                      ordered) will never match — that used to be the ONLY
                      option here, and it read "No voucher for this" against a
                      bill the supporter could see and could not settle. */}
                  <PayBillOnMyCard person={person} bill={bill} />
                  <SplitBillWithThem person={person} bill={bill} />
                  {person.readyVouchers.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={payOrder.isPending}
                      onClick={() =>
                        run(async () => {
                          await payOrder.mutateAsync({
                            beneficiaryId: person.profileId,
                            voucherId: person.readyVouchers[0].id,
                            orderType: bill.order_type,
                            orderId: bill.order_id,
                          });
                          return "Paid with their voucher.";
                        })
                      }
                    >
                      Use their voucher
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selfBookable.length > 0 && (
        <div>
          <label
            className="block text-xs font-medium text-charcoal-ink"
            htmlFor={`book-${person.profileId}`}
          >
            Book a check for them
          </label>
          <div className="mt-1 flex flex-wrap gap-2">
            <Select
              id={`book-${person.profileId}`}
              value={bundleCode}
              onChange={(event) => setBundleCode(event.target.value)}
              className="max-w-xs"
            >
              <option value="">Choose a check</option>
              {selfBookable.map((bundle) => (
                <option key={bundle.code} value={bundle.code}>
                  {bundle.name} ({naira(bundle.price_kobo)})
                </option>
              ))}
            </Select>
            <Button
              type="button"
              disabled={!bundleCode || bookCare.isPending}
              onClick={() =>
                run(async () => {
                  await bookCare.mutateAsync({
                    beneficiaryId: person.profileId,
                    bundleCode,
                  });
                  setBundleCode("");
                  return "Requested. They can take it to any laboratory they like and pay there; we take nothing on it.";
                })
              }
            >
              {bookCare.isPending ? "Booking…" : "Book"}
            </Button>
          </div>
          <p className="mt-1 text-xs text-charcoal-ink/50">
            They still choose where to go and when. Requesting here just writes down which tests
            waiting.
          </p>
        </div>
      )}

      <div>
        <Button type="button" variant="outline" onClick={() => setShowBasics((open) => !open)}>
          {showBasics ? "Cancel" : "Help fill in their details"}
        </Button>
        {showBasics && (
          <form
            className="mt-3 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                await setBasics.mutateAsync({
                  beneficiaryId: person.profileId,
                  dateOfBirth: (form.get("dateOfBirth") as string) || null,
                  sex: (form.get("sex") as string) || null,
                  state: (form.get("state") as string) || null,
                  city: (form.get("city") as string) || null,
                });
                setShowBasics(false);
                return "Saved. They still need to accept the consents themselves.";
              });
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-charcoal-ink" htmlFor={`dob-${person.profileId}`}>
                  Date of birth
                </label>
                <Input id={`dob-${person.profileId}`} name="dateOfBirth" type="date" />
              </div>
              <div>
                <label className="block text-xs font-medium text-charcoal-ink" htmlFor={`sex-${person.profileId}`}>
                  Sex
                </label>
                <Select id={`sex-${person.profileId}`} name="sex" defaultValue="">
                  <option value="">Leave as is</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-charcoal-ink" htmlFor={`state-${person.profileId}`}>
                  State
                </label>
                <Input id={`state-${person.profileId}`} name="state" placeholder="Lagos" />
              </div>
              <div>
                <label className="block text-xs font-medium text-charcoal-ink" htmlFor={`city-${person.profileId}`}>
                  City or town
                </label>
                <Input id={`city-${person.profileId}`} name="city" placeholder="Ikeja" />
              </div>
            </div>
            <p className="text-xs text-charcoal-ink/60">
              Anything you leave blank stays as it is. You cannot accept their consents for them:
              that part has to be theirs.
            </p>
            <Button type="submit" disabled={setBasics.isPending}>
              {setBasics.isPending ? "Saving…" : "Save their details"}
            </Button>
          </form>
        )}
      </div>

      {message && <p className="text-sm text-deep-forest">{message}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
