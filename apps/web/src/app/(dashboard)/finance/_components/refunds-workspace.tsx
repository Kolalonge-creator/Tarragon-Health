"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, ConfirmDialogFacts } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadFailure } from "@/components/ui/load-failure";
import { formatMinor, formatNumber } from "@/lib/analytics/format";
import { parseOptionalMoney } from "@/lib/finance/money-input";
import {
  decisionAvailability,
  decisionMessage,
  refundTab,
  useDecideRefund,
  useRefundQueue,
  useRefundSettings,
  useSetRefundThreshold,
  type QueuedRefund,
  type RefundTab,
} from "@/lib/finance/refunds";
import { transactionHref } from "@/lib/finance/transactions";
import { CenterNote, SectionCard } from "./primitives";

const TAB_LABEL: Record<RefundTab, string> = {
  decide: "Waiting for a decision",
  in_progress: "Being paid",
  failed: "Failed at Paystack",
  finished: "Finished (30 days)",
};

const STATE_TONE: Record<string, "attention" | "info" | "normal" | "grey" | "critical"> = {
  pending: "attention",
  approved: "info",
  processing: "info",
  completed: "normal",
  rejected: "grey",
  failed: "critical",
};

const STATE_LABEL: Record<string, string> = {
  pending: "Waiting",
  approved: "Approved, queued",
  processing: "Sent to Paystack",
  completed: "Refunded",
  rejected: "Rejected",
  failed: "Failed",
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }) : "Not recorded";
const words = (code: string | null) => (code ? code.replace(/_/g, " ") : "Not recorded");

function ThresholdCard() {
  const settings = useRefundSettings();
  const save = useSetRefundThreshold();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const parsed = parseOptionalMoney(amount);
  const reasonOk = reason.trim().length >= 10;

  const current = settings.data?.second_approval_threshold_minor ?? null;
  return (
    <SectionCard
      title="Second approver"
      description="Refunds at or above this amount need two different people to approve them. With no amount set, one approval is enough."
      actions={
        !editing && settings.data ? (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Change
          </Button>
        ) : undefined
      }
    >
      {settings.isError && <LoadFailure>The setting could not be loaded. Until it loads, assume large refunds may need a second approver.</LoadFailure>}
      {settings.data && !editing && (
        <p className="text-sm text-charcoal-ink dark:text-night-ink">
          {current === null ? (
            <>Not set: <span className="font-medium">one approval is enough for every refund.</span></>
          ) : (
            <>
              Refunds of <span className="font-medium">{formatMinor(current, "NGN")}</span> or more need a second approver.
            </>
          )}
          {settings.data.updated_by && (
            <span className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Last changed by {settings.data.updated_by}, {when(settings.data.updated_at)}
            </span>
          )}
        </p>
      )}
      {editing && (
        <form
          className="grid gap-3 sm:max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            if (!parsed.ok || !reasonOk) return;
            save.mutate(
              { thresholdMinor: parsed.minor, reason: reason.trim() },
              { onSuccess: () => { setEditing(false); setAmount(""); setReason(""); } }
            );
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="refund-threshold">Amount (₦). Leave empty for one approval on every refund.</Label>
            <Input id="refund-threshold" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!parsed.ok} />
            {!parsed.ok && <p className="text-xs text-status-critical-text">{parsed.error}</p>}
          </div>
          <div className="grid gap-1">
            <Label htmlFor="refund-threshold-reason">Why (at least 10 characters, kept in the audit log)</Label>
            <Textarea id="refund-threshold-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>
          {save.isError && (
            <LoadFailure>
              {(save.error as { code?: string })?.code === "42501"
                ? "Changing this needs the finance approvals permission."
                : "The setting was not saved. Try again."}
            </LoadFailure>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!parsed.ok || !reasonOk || save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </SectionCard>
  );
}

function RefundRow({
  r,
  canDecide,
  onDecide,
}: {
  r: QueuedRefund;
  canDecide: boolean;
  onDecide: (r: QueuedRefund, approve: boolean) => void;
}) {
  const avail = decisionAvailability(r, canDecide);
  // The payment being refunded: a refund only becomes its own record once Paystack confirms it.
  const href = transactionHref("order", r.order_id);
  return (
    <li className="space-y-2 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
            {r.payer ?? "Member"}
            {r.beneficiary && <span className="font-normal text-charcoal-ink/60 dark:text-night-ink/60"> for {r.beneficiary}</span>}
            <span className="font-normal text-charcoal-ink/60 dark:text-night-ink/60"> · {words(r.item)}</span>
          </p>
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            Requested {when(r.requested_at)}
            {r.requested_by ? ` by ${r.requested_by}${r.requested_by_staff ? " (staff)" : ""}` : ""}
            {r.paystack_reference ? ` · Ref ${r.paystack_reference}` : ""}
          </p>
          <p className="mt-1 max-w-2xl text-sm text-charcoal-ink/80 dark:text-night-ink/80">&ldquo;{r.reason}&rdquo;</p>
        </div>
        <div className="text-right">
          <p className="font-heading text-lg font-semibold tabular-nums text-charcoal-ink dark:text-night-ink">{formatMinor(r.amount_minor, "NGN")}</p>
          <div className="mt-1 flex flex-wrap justify-end gap-1">
            <Badge variant={STATE_TONE[r.state] ?? "grey"}>{STATE_LABEL[r.state] ?? r.state}</Badge>
            {r.state === "pending" && r.needs_second_approval && (
              <Badge variant="info">{r.first_approved_by ? "1 of 2 approvals" : "Needs 2 approvals"}</Badge>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        <span>
          {r.first_approved_by && `First approval: ${r.first_approved_by}, ${when(r.first_approved_at)}${r.first_approval_note ? ` ("${r.first_approval_note}")` : ""}. `}
          {r.decided_by && `${r.state === "rejected" ? "Rejected" : "Approved"} by ${r.decided_by}, ${when(r.decided_at)}${r.decision_note ? ` ("${r.decision_note}")` : ""}. `}
          {r.completed_at && `Paystack confirmed ${when(r.completed_at)}. `}
          {r.state === "failed" && `Failed after ${formatNumber(r.attempts)} attempt${r.attempts === 1 ? "" : "s"}${r.last_error_code ? ` (${r.last_error_code})` : ""}. `}
          {href && (
            <Link href={href} className="font-medium text-brand-green hover:underline dark:text-brand-green-bright">
              Open the payment
            </Link>
          )}
        </span>
        {r.state === "pending" && (
          <span className="flex flex-wrap items-center gap-2">
            {avail.why && <span className="max-w-xs text-right">{avail.why}</span>}
            <Button size="sm" variant="outline" disabled={!avail.reject} onClick={() => onDecide(r, false)}>
              Reject
            </Button>
            <Button size="sm" disabled={!avail.approve} onClick={() => onDecide(r, true)}>
              {r.needs_second_approval && !r.first_approved_by ? "Give first approval" : r.needs_second_approval ? "Give second approval" : "Approve"}
            </Button>
          </span>
        )}
      </div>
    </li>
  );
}

export function RefundsWorkspace() {
  const q = useRefundQueue();
  const decide = useDecideRefund();
  const [tab, setTab] = useState<RefundTab>("decide");
  const [pending, setPending] = useState<{ r: QueuedRefund; approve: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "info" | "refusal"; text: string } | null>(null);

  const data = q.data;
  const rows = data?.refunds ?? [];
  const counts = rows.reduce<Record<RefundTab, number>>(
    (acc, r) => ({ ...acc, [refundTab(r)]: acc[refundTab(r)] + 1 }),
    { decide: 0, in_progress: 0, failed: 0, finished: 0 }
  );
  const shown = rows.filter((r) => refundTab(r) === tab);
  const rejectNeedsReason = pending && !pending.approve && note.trim().length < 5;

  function confirm() {
    if (!pending) return;
    const { r, approve } = pending;
    decide.mutate(
      { refundId: r.id, approve, note },
      {
        onSuccess: (res) => setMessage(decisionMessage(res)),
        onError: (e) =>
          setMessage({
            tone: "refusal",
            text: (e as { code?: string })?.code === "42501" ? "You are not allowed to decide refunds." : "The decision was not saved. Refresh and try again.",
          }),
      }
    );
    setPending(null);
    setNote("");
  }

  return (
    <div className="space-y-6">
      <ThresholdCard />

      <SectionCard title="Checkout refunds" description="Refund requests for Membership and other checkout orders. A refund only counts as refunded once Paystack confirms it.">
        {q.isError && (
          <LoadFailure>The refunds could not be loaded, so none are shown. That is not the same as there being none. Reload to try again.</LoadFailure>
        )}
        {q.isLoading && <CenterNote>Loading refunds…</CenterNote>}
        {message && (
          <p
            role="status"
            className={`mb-3 rounded-md px-3 py-2 text-sm ${
              message.tone === "refusal"
                ? "bg-status-attention-tint text-status-attention-text"
                : "bg-soft-sage text-charcoal-ink dark:bg-brand-green/15 dark:text-night-ink"
            }`}
          >
            {message.text}
          </p>
        )}
        {data && (
          <>
            <div role="tablist" aria-label="Refunds by stage" className="mb-2 flex flex-wrap gap-1 border-b border-charcoal-ink/10 dark:border-night-ink/15">
              {(Object.keys(TAB_LABEL) as RefundTab[]).map((t) => (
                <button
                  key={t}
                  role="tab"
                  type="button"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                    tab === t
                      ? "border-brand-green font-medium text-charcoal-ink dark:text-night-ink"
                      : "border-transparent text-charcoal-ink/60 hover:text-charcoal-ink dark:text-night-ink/60"
                  }`}
                >
                  {TAB_LABEL[t]} <span className="tabular-nums">({counts[t]})</span>
                </button>
              ))}
            </div>
            {!data.can_decide && (
              <p className="mb-2 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                You can see refunds but not decide them. A finance administrator can grant the refund approval permission.
              </p>
            )}
            {shown.length === 0 ? (
              <CenterNote>Nothing here.</CenterNote>
            ) : (
              <ul role="tabpanel" className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
                {shown.map((r) => (
                  <RefundRow key={r.id} r={r} canDecide={data.can_decide} onDecide={(row, approve) => { setMessage(null); setNote(""); setPending({ r: row, approve }); }} />
                ))}
              </ul>
            )}
          </>
        )}
      </SectionCard>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.approve
            ? pending.r.needs_second_approval && !pending.r.first_approved_by
              ? "Give the first approval?"
              : "Approve this refund?"
            : "Reject this refund?"
        }
        description={
          pending?.approve
            ? pending.r.needs_second_approval && !pending.r.first_approved_by
              ? "Nothing is paid yet. A second, different person must also approve."
              : "The refund is queued for Paystack. The Membership or service it paid for ends now, and the payer is told."
            : "The payer is told the refund was declined. Your reason is kept on the record for staff."
        }
        confirmLabel={pending?.approve ? "Approve" : "Reject"}
        destructive={!pending?.approve}
        confirmDisabled={Boolean(rejectNeedsReason) || decide.isPending}
        onConfirm={confirm}
        onCancel={() => { setPending(null); setNote(""); }}
      >
        {pending && (
          <>
            <ConfirmDialogFacts
              rows={[
                { label: "Amount", value: formatMinor(pending.r.amount_minor, "NGN") },
                { label: "Paid by", value: pending.r.payer ?? "Member" },
                ...(pending.r.beneficiary ? [{ label: "For", value: pending.r.beneficiary }] : []),
                { label: "Item", value: words(pending.r.item) },
                ...(pending.r.first_approved_by ? [{ label: "First approval", value: pending.r.first_approved_by }] : []),
              ]}
            />
            <div className="mt-3 grid gap-1">
              <Label htmlFor="refund-note">{pending.approve ? "Note (optional)" : "Reason (at least 5 characters, kept on the record)"}</Label>
              <Textarea id="refund-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
