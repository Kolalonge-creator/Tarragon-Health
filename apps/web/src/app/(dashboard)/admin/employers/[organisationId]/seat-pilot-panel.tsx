import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionForm } from "@/components/testing-days/action-form";
import { closePilot, confirmPilotPayment, createPilot, issuePilotInvoice } from "@/lib/employer-pilot/actions";
import { nairaFromKobo } from "@/lib/employer-pilot/model";

const STATE_LABEL: Record<string, string> = {
  draft: "Draft: invoice not issued",
  invoiced: "Invoice issued, waiting for payment",
  active: "Active",
  ended: "Ended",
  cancelled: "Cancelled",
};

/**
 * Finance steps for an employer seat pilot, on the employer's admin page. It runs on the caller's own session, so the database decides
 * who may act (finance or admin). It shows terms and money only: no member names, no usage. The employer's own aggregate report is at
 * /dashboard/corporate/pilot.
 */
export async function SeatPilotPanel({ organisationId }: { organisationId: string }) {
  const supabase = await createClient();
  const [{ data: pilots }, { data: packages }] = await Promise.all([
    supabase
      .from("employer_seat_pilots")
      .select(
        "id, state, seats_purchased, seat_price_kobo, total_kobo, starts_on, ends_on, terms_version, payment_method, payment_reference, invoice_id",
      )
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false }),
    supabase
      .from("employer_benefit_packages")
      .select("id, name")
      .eq("organisation_id", organisationId)
      .eq("is_active", true)
      .not("catalog_item_id", "is", null),
  ]);
  const live = (pilots ?? []).some((p) => ["draft", "invoiced", "active"].includes(p.state));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Membership seat pilot</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-charcoal-ink/70">
          A block of Membership seats paid in one invoice. Seats are priced at this employer&apos;s organisation price on the day the offer is
          made. Record a payment only after you have seen the money in the bank statement or the Paystack dashboard. See the ops runbook
          (docs/runbooks/employer-pilot.md).
        </p>

        {(pilots ?? []).map((p) => (
          <div key={p.id} className="space-y-3 rounded-md border border-charcoal-ink/15 p-4">
            <p className="flex flex-wrap items-center gap-2 font-medium text-charcoal-ink">
              {p.seats_purchased} seats at {nairaFromKobo(p.seat_price_kobo)}: {nairaFromKobo(p.total_kobo)}
              <Badge variant="grey">{STATE_LABEL[p.state] ?? p.state}</Badge>
            </p>
            <p className="text-sm text-charcoal-ink/60">
              Claim window {p.starts_on} to {p.ends_on}. Terms version {p.terms_version}.
              {p.payment_reference ? ` Paid by ${p.payment_method === "paystack_link" ? "Paystack link" : "bank transfer"}, reference ${p.payment_reference}.` : ""}
            </p>
            {p.state === "draft" ? (
              <ActionForm action={issuePilotInvoice} hidden={{ pilotId: p.id, organisationId }} submitLabel="Issue invoice" />
            ) : null}
            {p.state === "invoiced" ? (
              <ActionForm action={confirmPilotPayment} hidden={{ pilotId: p.id, organisationId }} submitLabel="Record payment received">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`method-${p.id}`}>How it was paid</Label>
                    <select
                      id={`method-${p.id}`}
                      name="method"
                      className="h-9 w-full rounded-md border border-charcoal-ink/20 bg-white px-2 text-sm"
                      defaultValue="bank_transfer"
                    >
                      <option value="bank_transfer">Bank transfer</option>
                      <option value="paystack_link">Paystack payment link</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`ref-${p.id}`}>Bank or Paystack reference</Label>
                    <Input id={`ref-${p.id}`} name="reference" required minLength={4} maxLength={120} />
                  </div>
                </div>
              </ActionForm>
            ) : null}
            {["draft", "invoiced", "active"].includes(p.state) ? (
              <ActionForm
                action={closePilot}
                hidden={{ pilotId: p.id, organisationId }}
                submitLabel={p.state === "active" ? "End pilot" : "Cancel pilot"}
                variant="outline"
              >
                <div className="space-y-1">
                  <Label htmlFor={`reason-${p.id}`}>Reason (kept on record)</Label>
                  <Input id={`reason-${p.id}`} name="reason" required minLength={10} maxLength={500} />
                </div>
              </ActionForm>
            ) : null}
          </div>
        ))}

        {live ? (
          <p className="text-sm text-charcoal-ink/60">Close the live pilot before starting another.</p>
        ) : (packages ?? []).length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">
            This employer has no Membership benefit package yet. Create one on the eligibility and benefits page first.
          </p>
        ) : (
          <ActionForm action={createPilot} hidden={{ organisationId }} submitLabel="Create pilot">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="benefitPackageId">Benefit package</Label>
                <select
                  id="benefitPackageId"
                  name="benefitPackageId"
                  required
                  className="h-9 w-full rounded-md border border-charcoal-ink/20 bg-white px-2 text-sm"
                >
                  {(packages ?? []).map((pk) => (
                    <option key={pk.id} value={pk.id}>
                      {pk.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="seats">Seats</Label>
                <Input id="seats" name="seats" type="number" min={1} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="termsVersion">Terms version accepted</Label>
                <Input id="termsVersion" name="termsVersion" required maxLength={60} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="startsOn">Claim window starts</Label>
                <Input id="startsOn" name="startsOn" type="date" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="endsOn">Claim window ends</Label>
                <Input id="endsOn" name="endsOn" type="date" required />
              </div>
            </div>
          </ActionForm>
        )}
      </CardContent>
    </Card>
  );
}
