"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fromMinorUnits, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";
import {
  ACTIVE_PLANS_QUERY_KEY,
  ALL_PLANS_QUERY_KEY,
} from "@/lib/queries/subscription-plans";
import {
  applyPriceAdjustment,
  previewPriceAdjustment,
  type BulkAdjustmentPreviewRow,
  type BulkAdjustmentResult,
} from "./actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

function formatMinor(minor: number, currency: Currency): string {
  return `${CURRENCY_SYMBOL[currency]}${fromMinorUnits(minor, currency).toLocaleString()}`;
}

const STATUS_LABEL: Record<BulkAdjustmentPreviewRow["status"], string> = {
  adjust: "Will adjust",
  locked: "Kept for subscribers — clone to reprice",
  free: "Free — never adjusted",
  inactive_skipped: "Inactive — skipped",
  unchanged: "No change after rounding",
};

/**
 * The annual inflation-review tool: preview then apply a percentage change
 * across plans/add-ons. Existing subscribers are never touched (their rows
 * are reported for the clone-as-new-plan flow), and the patient-facing
 * promise of 30 days' notice is a comms step the admin owns — the card says
 * so explicitly.
 */
export function PriceAdjustmentManager() {
  const queryClient = useQueryClient();
  const [percent, setPercent] = useState("10");
  const [currency, setCurrency] = useState("NGN");
  const [includePlans, setIncludePlans] = useState(true);
  const [includeAddOns, setIncludeAddOns] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [preview, setPreview] = useState<BulkAdjustmentPreviewRow[] | null>(null);
  const [result, setResult] = useState<BulkAdjustmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const input = {
    percent,
    currency,
    includePlans,
    includeAddOns,
    includeInactive,
  };

  function handlePreview() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const response = await previewPriceAdjustment(input);
      if (!response.ok) {
        setError(response.error);
        setPreview(null);
        return;
      }
      setPreview(response.rows);
    });
  }

  function handleApply() {
    setError(null);
    startTransition(async () => {
      const response = await applyPriceAdjustment(input);
      setResult(response);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ALL_PLANS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ACTIVE_PLANS_QUERY_KEY });
    });
  }

  const adjustCount = preview?.filter((row) => row.status === "adjust").length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk price adjustment (annual review)</CardTitle>
        <CardDescription>
          Apply a percentage change across plans and add-ons — e.g. the yearly inflation review.
          Rows with active subscribers are never changed (clone them as new plans instead), NGN
          prices round to the nearest ₦500, and adjusted rows are re-synced to Paystack/Stripe
          automatically. Remember: the No-Hidden-Cost Promise commits us to telling patients at
          least 30 days before a Naira change takes effect — send a broadcast before applying.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="adjust-percent">Change (%)</Label>
            <Input
              id="adjust-percent"
              type="number"
              step="0.5"
              min={-50}
              max={100}
              value={percent}
              onChange={(event) => {
                setPercent(event.target.value);
                setPreview(null);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adjust-currency">Currency</Label>
            <Select
              id="adjust-currency"
              value={currency}
              onChange={(event) => {
                setCurrency(event.target.value);
                setPreview(null);
              }}
            >
              <option value="NGN">NGN only</option>
              <option value="GBP">GBP only</option>
              <option value="USD">USD only</option>
              <option value="ALL">All currencies</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Scope</Label>
            <div className="flex flex-col gap-1 text-sm text-charcoal-ink/80">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includePlans}
                  onChange={(event) => {
                    setIncludePlans(event.target.checked);
                    setPreview(null);
                  }}
                />
                Plans
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeAddOns}
                  onChange={(event) => {
                    setIncludeAddOns(event.target.checked);
                    setPreview(null);
                  }}
                />
                Add-ons
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeInactive}
                  onChange={(event) => {
                    setIncludeInactive(event.target.checked);
                    setPreview(null);
                  }}
                />
                Include inactive rows
              </label>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={pending} onClick={handlePreview}>
            {pending ? "Working…" : "Preview changes"}
          </Button>
          {preview && adjustCount > 0 && (
            <Button disabled={pending} onClick={handleApply}>
              Apply {adjustCount} change{adjustCount === 1 ? "" : "s"}
            </Button>
          )}
        </div>

        {preview && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs uppercase tracking-wide text-charcoal-ink/60">
                  <th className="py-2 pr-4">Item</th>
                  <th className="py-2 pr-4">Current</th>
                  <th className="py-2 pr-4">New</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={`${row.target}-${row.id}`} className="border-b border-charcoal-ink/5">
                    <td className="py-2 pr-4">
                      <span className="font-medium text-charcoal-ink">{row.name}</span>{" "}
                      <span className="text-charcoal-ink/40">
                        · {row.code} · {row.target === "plan" ? "plan" : "add-on"}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-charcoal-ink/70">
                      {formatMinor(row.oldMinor, row.currency)}
                    </td>
                    <td className="py-2 pr-4 font-medium text-charcoal-ink">
                      {row.status === "adjust" ? formatMinor(row.newMinor, row.currency) : "—"}
                    </td>
                    <td className="py-2">
                      <Badge variant={row.status === "adjust" ? "green" : "grey"}>
                        {STATUS_LABEL[row.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {result?.ok && (
          <div className="space-y-1 text-sm text-charcoal-ink/80">
            <p>
              Applied {result.adjusted.length} change{result.adjusted.length === 1 ? "" : "s"}.
              {result.locked.length > 0 &&
                ` Kept for subscribers (clone to reprice): ${result.locked.join(", ")}.`}
            </p>
            {result.syncFailures.length > 0 && (
              <p className="text-red-600">
                Sync failed for {result.syncFailures.map((f) => f.code).join(", ")} — these rows are
                repriced but inactive until synced (use &quot;Sync to Paystack/Stripe&quot; above).
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
