"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { DOCTOR_TIER_LABEL } from "@/lib/clinical/doctor-tier";
import { CURRENCY_SYMBOL, fromMinorUnits, type Tables } from "@tarragon/shared";

type Pledge = Tables<"doctor_retention_pledges">;
type Allocation = Tables<"doctor_retention_allocations">;

const money = (amountMinor: number, currency: "GBP" | "USD") =>
  `${CURRENCY_SYMBOL[currency]}${fromMinorUnits(amountMinor, currency).toLocaleString()}`;

const PLEDGE_STATUS_VARIANT: Record<Pledge["status"], "green" | "grey" | "amber"> = {
  pledged: "amber",
  collected: "green",
  fully_allocated: "grey",
  cancelled: "grey",
};

const ALLOCATION_STATUS_VARIANT: Record<Allocation["status"], "green" | "grey" | "amber"> = {
  allocated: "amber",
  disbursed: "green",
  cancelled: "grey",
};

function usePledges() {
  return useQuery({
    queryKey: ["admin", "doctor-retention-pledges"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("doctor_retention_pledges")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

function useAllocations() {
  return useQuery({
    queryKey: ["admin", "doctor-retention-allocations"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("doctor_retention_allocations")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Doctors eligible to receive a retention top-up — any active clinical tier.
 * care_coordinator is deliberately excluded even though it is a doctor_tier
 * value: it is explicitly non-clinical, logistics-only staff (CLAUDE.md's
 * Clinical Tier Ladder), and this pool exists to retain doctors specifically,
 * not as a general staff bonus fund. Same exclusion CLINICAL_TIERS uses in
 * lib/clinical/doctor-tier.ts.
 */
function useEligibleStaff() {
  return useQuery({
    queryKey: ["admin", "doctor-retention-eligible-staff"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinical_staff")
        .select("id, full_name, doctor_tier")
        .eq("active", true)
        .not("doctor_tier", "is", null)
        .neq("doctor_tier", "care_coordinator")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });
}

export function DoctorRetentionPoolManager() {
  const queryClient = useQueryClient();
  const { data: pledges } = usePledges();
  const { data: allocations } = useAllocations();
  const { data: staff } = useEligibleStaff();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidatePool = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "doctor-retention-pledges"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "doctor-retention-allocations"] });
  };

  const recordPledge = useMutation({
    mutationFn: async (input: {
      sponsorName: string;
      sponsorContact: string;
      currency: "GBP" | "USD";
      amountMinor: number;
      note: string;
    }) => {
      const supabase = createClient();
      const { error: err } = await supabase.rpc("record_doctor_retention_pledge", {
        p_sponsor_name: input.sponsorName,
        p_currency: input.currency,
        p_amount_minor: input.amountMinor,
        p_sponsor_contact: input.sponsorContact || undefined,
        p_note: input.note || undefined,
      });
      if (err) throw err;
    },
    onSuccess: () => {
      setMessage("Pledge recorded.");
      invalidatePool();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not record pledge"),
  });

  const markCollected = useMutation({
    mutationFn: async (input: { pledgeId: string; method: string; reference: string }) => {
      const supabase = createClient();
      const { error: err } = await supabase.rpc("mark_doctor_retention_pledge_collected", {
        p_pledge_id: input.pledgeId,
        p_collection_method: input.method || undefined,
        p_collection_reference: input.reference || undefined,
      });
      if (err) throw err;
    },
    onSuccess: () => {
      setMessage("Marked collected.");
      invalidatePool();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not mark collected"),
  });

  const cancelPledge = useMutation({
    mutationFn: async (input: { pledgeId: string; reason: string }) => {
      const supabase = createClient();
      const { error: err } = await supabase.rpc("cancel_doctor_retention_pledge", {
        p_pledge_id: input.pledgeId,
        p_reason: input.reason,
      });
      if (err) throw err;
    },
    onSuccess: () => {
      setMessage("Pledge cancelled.");
      invalidatePool();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not cancel pledge"),
  });

  const allocate = useMutation({
    mutationFn: async (input: {
      pledgeId: string;
      clinicalStaffId: string;
      periodStart: string;
      periodEnd: string;
      amountMinor: number;
      note: string;
    }) => {
      const supabase = createClient();
      const { error: err } = await supabase.rpc("allocate_doctor_retention_pledge", {
        p_pledge_id: input.pledgeId,
        p_clinical_staff_id: input.clinicalStaffId,
        p_period_start: input.periodStart,
        p_period_end: input.periodEnd,
        p_amount_minor: input.amountMinor,
        p_note: input.note || undefined,
      });
      if (err) throw err;
    },
    onSuccess: () => {
      setMessage("Allocated.");
      invalidatePool();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not allocate"),
  });

  const markDisbursed = useMutation({
    mutationFn: async (input: { allocationId: string; reference: string }) => {
      const supabase = createClient();
      const { error: err } = await supabase.rpc("mark_doctor_retention_allocation_disbursed", {
        p_allocation_id: input.allocationId,
        p_disbursement_reference: input.reference || undefined,
      });
      if (err) throw err;
    },
    onSuccess: () => {
      setMessage("Marked disbursed.");
      invalidatePool();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not mark disbursed"),
  });

  const cancelAllocation = useMutation({
    mutationFn: async (input: { allocationId: string; reason: string }) => {
      const supabase = createClient();
      const { error: err } = await supabase.rpc("cancel_doctor_retention_allocation", {
        p_allocation_id: input.allocationId,
        p_reason: input.reason,
      });
      if (err) throw err;
    },
    onSuccess: () => {
      setMessage("Allocation cancelled.");
      invalidatePool();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not cancel allocation"),
  });

  const staffName = (id: string) => staff?.find((s) => s.id === id)?.full_name ?? "Unknown";
  const pledgeById = (id: string) => pledges?.find((p) => p.id === id);
  const allocatablePledges = (pledges ?? []).filter(
    (p) => p.status === "collected" || p.status === "fully_allocated"
  );

  return (
    <div className="space-y-6">
      {(message || error) && (
        <div className={`rounded-md px-3 py-2 text-sm ${error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
          {error ?? message}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Record a pledge</CardTitle>
          <CardDescription>
            Record this once a diaspora sponsor&apos;s funds are actually confirmed received
            through the org&apos;s existing off-platform banking (wire transfer, etc.) — this form
            does not collect payment itself.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              setMessage(null);
              setError(null);
              const form = new FormData(e.currentTarget);
              recordPledge.mutate(
                {
                  sponsorName: String(form.get("sponsor_name") ?? ""),
                  sponsorContact: String(form.get("sponsor_contact") ?? ""),
                  currency: String(form.get("currency") ?? "USD") as "GBP" | "USD",
                  amountMinor: Math.round(Number(form.get("amount")) * 100),
                  note: String(form.get("note") ?? ""),
                },
                { onSuccess: () => e.currentTarget.reset() }
              );
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="sponsor_name">Sponsor name</Label>
              <Input id="sponsor_name" name="sponsor_name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sponsor_contact">Sponsor contact (optional)</Label>
              <Input id="sponsor_contact" name="sponsor_contact" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="currency">Currency</Label>
              <Select id="currency" name="currency" defaultValue="USD">
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount">Amount</Label>
              <Input id="amount" name="amount" type="number" min={1} step="0.01" required />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="note">Note (optional)</Label>
              <Textarea id="note" name="note" rows={2} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" size="sm" disabled={recordPledge.isPending}>
                {recordPledge.isPending ? "Recording…" : "Record pledge"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pledges</CardTitle>
          <CardDescription>
            A pledge only becomes allocatable once marked collected — an explicit attestation
            that the funds actually arrived, not the amount originally promised.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(pledges ?? []).length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No pledges recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {(pledges ?? []).map((p) => (
                <PledgeRow
                  key={p.id}
                  pledge={p}
                  onMarkCollected={(method, reference) =>
                    markCollected.mutate({ pledgeId: p.id, method, reference })
                  }
                  onCancel={(reason) => cancelPledge.mutate({ pledgeId: p.id, reason })}
                  markCollectedPending={markCollected.isPending}
                  cancelPending={cancelPledge.isPending}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allocate to a clinical staff member</CardTitle>
          <CardDescription>
            Earmarks part of a collected pledge for a named clinical staff member and period.
            This does not pay anyone — it is the record that this money is set aside for them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {allocatablePledges.length === 0 || (staff ?? []).length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">
              {allocatablePledges.length === 0
                ? "No collected pledges available to allocate yet."
                : "No active clinical staff with an assigned tier."}
            </p>
          ) : (
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                setMessage(null);
                setError(null);
                const form = new FormData(e.currentTarget);
                allocate.mutate(
                  {
                    pledgeId: String(form.get("pledge_id") ?? ""),
                    clinicalStaffId: String(form.get("clinical_staff_id") ?? ""),
                    periodStart: String(form.get("period_start") ?? ""),
                    periodEnd: String(form.get("period_end") ?? ""),
                    amountMinor: Math.round(Number(form.get("amount")) * 100),
                    note: String(form.get("note") ?? ""),
                  },
                  { onSuccess: () => e.currentTarget.reset() }
                );
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="pledge_id">Pledge</Label>
                <Select id="pledge_id" name="pledge_id" required>
                  {allocatablePledges.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.pledge_number} · {p.sponsor_name} · {money(p.amount_minor, p.currency as "GBP" | "USD")}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="clinical_staff_id">Clinical staff member</Label>
                <Select id="clinical_staff_id" name="clinical_staff_id" required>
                  {(staff ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name} · {s.doctor_tier ? DOCTOR_TIER_LABEL[s.doctor_tier] : "—"}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="period_start">Period start</Label>
                <Input id="period_start" name="period_start" type="date" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="period_end">Period end</Label>
                <Input id="period_end" name="period_end" type="date" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="allocation_amount">Amount</Label>
                <Input id="allocation_amount" name="amount" type="number" min={1} step="0.01" required />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="allocation_note">Note (optional)</Label>
                <Textarea id="allocation_note" name="note" rows={2} />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" size="sm" disabled={allocate.isPending}>
                  {allocate.isPending ? "Allocating…" : "Allocate"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allocations</CardTitle>
          <CardDescription>
            &quot;Disbursed&quot; means an admin has attested the top-up was actually paid to this
            person through the org&apos;s normal payroll process, outside the platform.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(allocations ?? []).length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No allocations yet.</p>
          ) : (
            <ul className="space-y-3">
              {(allocations ?? []).map((a) => {
                const pledge = pledgeById(a.pledge_id);
                return (
                  <AllocationRow
                    key={a.id}
                    allocation={a}
                    staffName={staffName(a.clinical_staff_id)}
                    currency={(pledge?.currency ?? "USD") as "GBP" | "USD"}
                    onMarkDisbursed={(reference) =>
                      markDisbursed.mutate({ allocationId: a.id, reference })
                    }
                    onCancel={(reason) => cancelAllocation.mutate({ allocationId: a.id, reason })}
                    markDisbursedPending={markDisbursed.isPending}
                    cancelPending={cancelAllocation.isPending}
                  />
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PledgeRow({
  pledge,
  onMarkCollected,
  onCancel,
  markCollectedPending,
  cancelPending,
}: {
  pledge: Pledge;
  onMarkCollected: (method: string, reference: string) => void;
  onCancel: (reason: string) => void;
  markCollectedPending: boolean;
  cancelPending: boolean;
}) {
  const [collecting, setCollecting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");

  return (
    <li className="rounded-md border border-charcoal-ink/10 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-charcoal-ink/80">
          {pledge.sponsor_name}{" "}
          <span className="text-charcoal-ink/40">{pledge.pledge_number}</span>
          <span className="text-charcoal-ink/40">
            {" "}
            · {money(pledge.amount_minor, pledge.currency as "GBP" | "USD")}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <Badge variant={PLEDGE_STATUS_VARIANT[pledge.status]}>{pledge.status.replace("_", " ")}</Badge>
          {pledge.status === "pledged" && (
            <Button type="button" size="sm" variant="outline" onClick={() => setCollecting((v) => !v)}>
              Mark collected
            </Button>
          )}
          {pledge.status !== "cancelled" && (
            <Button type="button" size="sm" variant="outline" onClick={() => setCancelling((v) => !v)}>
              Cancel
            </Button>
          )}
        </span>
      </div>
      {collecting && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-charcoal-ink/10 pt-3">
          <div className="space-y-1">
            <Label className="text-xs">Collection method</Label>
            <Input
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder="e.g. wire transfer"
              className="w-48"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Reference (optional)</Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-48"
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={markCollectedPending}
            onClick={() => {
              onMarkCollected(method, reference);
              setCollecting(false);
            }}
          >
            Confirm collected
          </Button>
        </div>
      )}
      {cancelling && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-charcoal-ink/10 pt-3">
          <div className="space-y-1">
            <Label className="text-xs">Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} className="w-64" />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={cancelPending || reason.trim().length === 0}
            onClick={() => {
              onCancel(reason);
              setCancelling(false);
            }}
          >
            Confirm cancel
          </Button>
        </div>
      )}
    </li>
  );
}

function AllocationRow({
  allocation,
  staffName,
  currency,
  onMarkDisbursed,
  onCancel,
  markDisbursedPending,
  cancelPending,
}: {
  allocation: Allocation;
  staffName: string;
  currency: "GBP" | "USD";
  onMarkDisbursed: (reference: string) => void;
  onCancel: (reason: string) => void;
  markDisbursedPending: boolean;
  cancelPending: boolean;
}) {
  const [disbursing, setDisbursing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");

  return (
    <li className="rounded-md border border-charcoal-ink/10 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-charcoal-ink/80">
          {staffName}
          <span className="text-charcoal-ink/40">
            {" "}
            · {allocation.period_start} – {allocation.period_end} ·{" "}
            {money(allocation.amount_minor, currency)}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <Badge variant={ALLOCATION_STATUS_VARIANT[allocation.status]}>{allocation.status}</Badge>
          {allocation.status === "allocated" && (
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => setDisbursing((v) => !v)}>
                Mark disbursed
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setCancelling((v) => !v)}>
                Cancel
              </Button>
            </>
          )}
        </span>
      </div>
      {disbursing && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-charcoal-ink/10 pt-3">
          <div className="space-y-1">
            <Label className="text-xs">Payroll reference (optional)</Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-64"
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={markDisbursedPending}
            onClick={() => {
              onMarkDisbursed(reference);
              setDisbursing(false);
            }}
          >
            Confirm disbursed
          </Button>
        </div>
      )}
      {cancelling && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-charcoal-ink/10 pt-3">
          <div className="space-y-1">
            <Label className="text-xs">Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} className="w-64" />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={cancelPending || reason.trim().length === 0}
            onClick={() => {
              onCancel(reason);
              setCancelling(false);
            }}
          >
            Confirm cancel
          </Button>
        </div>
      )}
    </li>
  );
}
