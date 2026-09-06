"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog, ConfirmDialogFacts } from "@/components/ui/confirm-dialog";
import { formatKobo, nairaInputToKobo } from "@/lib/format-money";
import { adjudicateClaimAction } from "./actions";

type Row = {
  id: string;
  service_category: string;
  billed_amount_kobo: number;
  insurer_covered_kobo: number | null;
  patient_copay_kobo: number;
  status: string;
  claim_reference: string | null;
  denial_reason: string | null;
  submitted_at: string;
  insurance_policies: { insurer_id: string; plan_name: string | null } | null;
};

const STATUS_BADGE: Record<string, "amber" | "green" | "red" | "blue" | "grey"> = {
  submitted: "amber",
  adjudicating: "blue",
  approved: "green",
  partially_approved: "green",
  denied: "red",
  paid: "grey",
};

/** What the operator is about to approve, held until they confirm it. */
type PendingApproval = {
  claimId: string;
  serviceCategory: string;
  billedKobo: number;
  coveredKobo: number;
  claimReference: string;
};

export function ClaimsManager({ rows }: { rows: Row[] }) {
  const [feedback, setFeedback] = useState<{ error?: string; message?: string } | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(fd: FormData) {
    startTransition(async () => {
      const result = await adjudicateClaimAction(undefined, fd);
      setFeedback(result ?? null);
      router.refresh();
    });
  }

  /**
   * Amounts are read in naira on this screen, so they are typed in naira too.
   * The single conversion to kobo happens here, at the submit boundary, and
   * the operator sees the converted amount against the billed amount before
   * anything is sent.
   */
  function reviewApproval(row: Row, form: HTMLFormElement) {
    const fd = new FormData(form);
    const coveredKobo = nairaInputToKobo(fd.get("insurerCoveredNaira"));
    if (coveredKobo === null) {
      setFeedback({ error: "Enter the covered amount in naira." });
      return;
    }
    setFeedback(null);
    setPendingApproval({
      claimId: row.id,
      serviceCategory: row.service_category,
      billedKobo: row.billed_amount_kobo,
      coveredKobo,
      claimReference: String(fd.get("claimReference") ?? "").trim(),
    });
  }

  function confirmApproval() {
    if (!pendingApproval) return;
    const fd = new FormData();
    fd.set("claimId", pendingApproval.claimId);
    fd.set("status", "approved");
    fd.set("insurerCoveredKobo", String(pendingApproval.coveredKobo));
    if (pendingApproval.claimReference) fd.set("claimReference", pendingApproval.claimReference);
    setPendingApproval(null);
    submit(fd);
  }

  const overBilled = pendingApproval !== null && pendingApproval.coveredKobo > pendingApproval.billedKobo;

  return (
    <div className="space-y-4">
      {feedback?.error && <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{feedback.error}</p>}
      {feedback?.message && (
        <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">{feedback.message}</p>
      )}

      <ConfirmDialog
        open={pendingApproval !== null}
        title="Approve this claim?"
        description={
          pendingApproval
            ? `Approving ${formatKobo(pendingApproval.coveredKobo)} of ${formatKobo(pendingApproval.billedKobo)} billed for ${pendingApproval.serviceCategory}.`
            : undefined
        }
        confirmLabel="Approve claim"
        onCancel={() => setPendingApproval(null)}
        onConfirm={confirmApproval}
      >
        {pendingApproval && (
          <>
            <ConfirmDialogFacts
              rows={[
                { label: "Billed", value: formatKobo(pendingApproval.billedKobo) },
                { label: "Insurer covers", value: formatKobo(pendingApproval.coveredKobo) },
                {
                  label: "Left for the patient",
                  value: formatKobo(Math.max(0, pendingApproval.billedKobo - pendingApproval.coveredKobo)),
                },
                { label: "Claim reference", value: pendingApproval.claimReference || "None" },
              ]}
            />
            {overBilled && (
              <p className="text-sm text-red-600">
                This is more than the amount billed. Check the figure before approving.
              </p>
            )}
          </>
        )}
      </ConfirmDialog>

      {rows.length === 0 ? (
        <p className="text-sm text-charcoal-ink/60">No claims yet.</p>
      ) : (
        rows.map((r) => (
          <Card key={r.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  {r.service_category} · Billed {formatKobo(r.billed_amount_kobo)}
                  {r.insurance_policies?.plan_name ? ` · ${r.insurance_policies.plan_name}` : ""}
                  {r.claim_reference ? ` · Ref ${r.claim_reference}` : ""}
                </CardTitle>
                <Badge variant={STATUS_BADGE[r.status] ?? "grey"}>{r.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-charcoal-ink/70">
                Insurer covered {r.insurer_covered_kobo !== null ? formatKobo(r.insurer_covered_kobo) : "—"} · Patient
                copay {formatKobo(r.patient_copay_kobo)}
              </p>
              {r.status === "submitted" || r.status === "adjudicating" ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      reviewApproval(r, e.currentTarget);
                    }}
                  >
                    <Input
                      name="insurerCoveredNaira"
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      aria-label={`Amount covered in naira, of ${formatKobo(r.billed_amount_kobo)} billed`}
                      placeholder="Covered (₦)"
                      required
                      className="h-9 w-40"
                    />
                    <Input name="claimReference" placeholder="Claim ref (optional)" className="h-9 w-40" />
                    <Button type="submit" size="sm" disabled={pending}>
                      Review and approve
                    </Button>
                  </form>
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submit(new FormData(e.currentTarget));
                    }}
                  >
                    <input type="hidden" name="claimId" value={r.id} />
                    <input type="hidden" name="status" value="denied" />
                    <Input name="denialReason" placeholder="Reason for denial" required className="h-9 w-56" />
                    <Button type="submit" size="sm" variant="outline" disabled={pending}>
                      Deny
                    </Button>
                  </form>
                </div>
              ) : (r.status === "approved" || r.status === "partially_approved") ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit(new FormData(e.currentTarget));
                  }}
                >
                  <input type="hidden" name="claimId" value={r.id} />
                  <input type="hidden" name="status" value="paid" />
                  <Button type="submit" size="sm" disabled={pending}>
                    Mark settled/paid
                  </Button>
                </form>
              ) : (
                r.denial_reason && <p className="text-sm text-charcoal-ink/60">{r.denial_reason}</p>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
