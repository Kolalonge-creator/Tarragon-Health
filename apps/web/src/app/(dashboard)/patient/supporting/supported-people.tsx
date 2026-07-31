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
import { useCareThreads, useStartThread } from "@/lib/queries/care-messages";
import { Textarea } from "@/components/ui/textarea";
import {
  useSponsorBookCare,
  useSponsorPayOrder,
  useSponsorPayableOrders,
  useSponsorSetBasics,
  useSupportedPeople,
  useSupportedPersonHealth,
  type SupportedPerson,
} from "@/lib/queries/sponsorship";
import { buyCareVoucher, type VoucherActionState } from "../vouchers/actions";
import { useVoucherCatalogue } from "@/lib/queries/vouchers";

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
export function SupportedPeople({ payerEmailKnown }: { payerEmailKnown: boolean }) {
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
        <CardContent className="grid gap-4 py-6 sm:grid-cols-3">
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
        </CardContent>
      </Card>

      {people.map((person) => (
        <PersonCard key={person.profileId} person={person} payerEmailKnown={payerEmailKnown} />
      ))}
    </div>
  );
}

function PersonCard({
  person,
  payerEmailKnown,
}: {
  person: SupportedPerson;
  payerEmailKnown: boolean;
}) {
  const [state, formAction, pending] = useActionState<VoucherActionState, FormData>(
    buyCareVoucher,
    undefined
  );
  const [showBuy, setShowBuy] = useState(false);
  const { data: catalogue } = useVoucherCatalogue();

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
          <Button type="button" variant="outline" onClick={() => setShowBuy((open) => !open)}>
            {showBuy ? "Cancel" : "Buy a check for them"}
          </Button>
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

        {showBuy && (
          <form action={formAction} className="space-y-3 rounded-lg bg-charcoal-ink/5 p-4">
            <input type="hidden" name="beneficiaryProfileId" value={person.profileId} />
            <div>
              <label
                className="block text-xs font-medium text-charcoal-ink"
                htmlFor={`bundle-${person.profileId}`}
              >
                Which check?
              </label>
              <Select id={`bundle-${person.profileId}`} name="panelBundleId" required>
                <option value="">Choose a check</option>
                {(catalogue ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} — {naira(b.price_kobo ?? 0)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label
                className="block text-xs font-medium text-charcoal-ink"
                htmlFor={`note-${person.profileId}`}
              >
                Add a note (optional)
              </label>
              <Input id={`note-${person.profileId}`} name="giftMessage" placeholder="Thinking of you" />
            </div>
            <p className="text-xs text-charcoal-ink/60">
              You are buying one named check for {name}, not adding money to an account. Reserving
              is free; you pay next, in one go or bit by bit. It belongs to them, cannot be moved to
              anyone else, and is never exchangeable for cash.
            </p>
            {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
            {state?.message && <p className="text-sm text-emerald-700">{state.message}</p>}
            {!payerEmailKnown && (
              <p className="text-sm text-amber-700">
                Your account needs an email address on file before you can check out.
              </p>
            )}
            <Button type="submit" disabled={pending || !payerEmailKnown}>
              {pending ? "Reserving…" : "Reserve this check"}
            </Button>
          </form>
        )}

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

        {person.clinicalAccess ? (
          <>
            <HealthSummary person={person} />
            <SupporterConversation person={person} />
          </>
        ) : (
          <p className="text-xs text-charcoal-ink/50">
            You can see what their care costs and what it paid for, and nothing else. If they want
            you to follow how they are doing, they can turn that on themselves under &ldquo;Who can
            see your health information&rdquo;.
          </p>
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
 * How they are doing, for someone who has been told they may look.
 *
 * Rendered only when person.clinicalAccess is true, but that flag is a
 * courtesy, not the control: every query behind this reads a table whose RLS
 * checks the same consent live, so a revoked supporter gets an empty card
 * rather than stale data even if this component were somehow rendered anyway.
 *
 * Numbers are shown, never judged. There is no "her blood pressure is too
 * high" anywhere in here: interpretation belongs to the care team, and the
 * conversation below is how a supporter asks for it.
 */
function HealthSummary({ person }: { person: SupportedPerson }) {
  const { data, isLoading } = useSupportedPersonHealth(person.profileId, person.clinicalAccess);
  const name = person.fullName ?? "They";

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
                  <li key={medication.id} className="text-sm text-charcoal-ink/70">
                    {medication.drugName}
                    {medication.dose ? ` · ${medication.dose}` : ""}
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
                <CareMessageThread threadId={thread.id} closed={thread.status === "closed"} />
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
                <Button
                  type="button"
                  variant="outline"
                  disabled={payOrder.isPending || person.readyVouchers.length === 0}
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
                  {person.readyVouchers.length === 0 ? "No voucher for this" : "Use their voucher"}
                </Button>
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
                  const result = await bookCare.mutateAsync({
                    beneficiaryId: person.profileId,
                    bundleCode,
                  });
                  setBundleCode("");
                  return result.paid
                    ? "Booked, and paid with a voucher they already had."
                    : `Booked for ${naira(result.price_kobo)}. Buy them a voucher for it, or they can pay when they go.`;
                })
              }
            >
              {bookCare.isPending ? "Booking…" : "Book"}
            </Button>
          </div>
          <p className="mt-1 text-xs text-charcoal-ink/50">
            They still choose where to go and when. Booking here just means it is paid for and
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
