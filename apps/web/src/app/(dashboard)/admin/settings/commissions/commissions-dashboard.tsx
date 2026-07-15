"use client";

import { useMemo, useState } from "react";
import { useAdminCommissions, useMarkCommissionPaid } from "@/lib/queries/commissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON } from "@/lib/icons";
import { koboToNaira, type CommissionStatus, type CommissionType } from "@tarragon/shared";

const TYPE_BADGE: Record<CommissionType, { variant: BadgeProps["variant"]; label: string }> = {
  lab: { variant: "blue", label: "Lab" },
  pharmacy: { variant: "green", label: "Pharmacy" },
  referral: { variant: "grey", label: "Referral" },
  home_visit: { variant: "amber", label: "Home visit" },
  delivery: { variant: "green", label: "Delivery" },
};

const STATUS_BADGE: Record<CommissionStatus, { variant: BadgeProps["variant"]; label: string }> = {
  pending: { variant: "amber", label: "Pending" },
  confirmed: { variant: "blue", label: "Confirmed" },
  paid: { variant: "green", label: "Paid" },
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function CommissionsDashboard() {
  const { data: commissions, isLoading, isError } = useAdminCommissions({});
  const markPaid = useMarkCommissionPaid();
  const [typeFilter, setTypeFilter] = useState<CommissionType | "">("");
  const [statusFilter, setStatusFilter] = useState<CommissionStatus | "">("");

  const totals = useMemo(() => {
    const all = commissions ?? [];
    const pendingKobo = all
      .filter((c) => c.status !== "paid")
      .reduce((sum, c) => sum + c.amount_kobo, 0);
    const paidKobo = all.filter((c) => c.status === "paid").reduce((sum, c) => sum + c.amount_kobo, 0);
    return { pendingKobo, paidKobo, count: all.length };
  }, [commissions]);

  const filtered = useMemo(() => {
    return (commissions ?? []).filter(
      (c) => (!typeFilter || c.commission_type === typeFilter) && (!statusFilter || c.status === statusFilter),
    );
  }, [commissions, typeFilter, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          icon={SEMANTIC_ICON.commission}
          label="Owed to Tarragon"
          value={`₦${koboToNaira(totals.pendingKobo).toLocaleString()}`}
        />
        <StatTile
          icon={SEMANTIC_ICON.commission}
          label="Paid"
          value={`₦${koboToNaira(totals.paidKobo).toLocaleString()}`}
        />
        <StatTile icon={SEMANTIC_ICON.commission} label="Total commissions" value={String(totals.count)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Commissions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="commission_type_filter">Type</Label>
              <Select
                id="commission_type_filter"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as CommissionType | "")}
              >
                <option value="">All types</option>
                <option value="lab">Lab</option>
                <option value="pharmacy">Pharmacy</option>
                <option value="referral">Referral</option>
                <option value="home_visit">Home visit</option>
                <option value="delivery">Delivery</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="commission_status_filter">Status</Label>
              <Select
                id="commission_status_filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as CommissionStatus | "")}
              >
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="paid">Paid</option>
              </Select>
            </div>
          </div>

          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load commissions.</p>}
          {commissions && commissions.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No commissions recorded yet.</p>
          )}
          {commissions && commissions.length > 0 && filtered.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No commissions match these filters.</p>
          )}
          {filtered.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {filtered.map((commission) => {
                const typeBadge = TYPE_BADGE[commission.commission_type];
                const statusBadge = STATUS_BADGE[commission.status];
                return (
                  <li key={commission.id} className="space-y-1 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={typeBadge.variant}>{typeBadge.label}</Badge>
                      <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                      {commission.source_reference && (
                        <span className="text-xs text-charcoal-ink/60">{commission.source_reference}</span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-charcoal-ink">
                      {commission.partner_name ?? "Unknown partner"}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-charcoal-ink/60">
                        ₦{koboToNaira(commission.amount_kobo).toLocaleString()} · earned{" "}
                        {formatDate(commission.earned_at)}
                      </p>
                      {commission.status !== "paid" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={markPaid.isPending}
                          onClick={() => markPaid.mutate(commission.id)}
                        >
                          {markPaid.isPending ? "Saving…" : "Mark as paid"}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
