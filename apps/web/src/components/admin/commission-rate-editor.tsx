"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { koboToNaira, nairaToKobo } from "@tarragon/shared";
import type { Enums } from "@tarragon/shared";

export type CommissionRateType = Enums<"commission_rate_type">;

export interface CommissionRateValue {
  commissionRateType: CommissionRateType;
  commissionRate: number | null;
  commissionFlatKobo: number | null;
}

interface CommissionRateEditorProps {
  value: CommissionRateValue;
  onSave: (value: CommissionRateValue) => void;
  isSaving?: boolean;
  error?: string | null;
  idPrefix: string;
}

/** Shared percentage/flat commission-rate editor — reused across the lab
 * bundles, pharmacy medications, and specialist provider admin surfaces,
 * which all commission-earning catalogue tables model identically
 * (commission_rate_type + commission_rate + commission_flat_kobo). */
export function CommissionRateEditor({
  value,
  onSave,
  isSaving,
  error,
  idPrefix,
}: CommissionRateEditorProps) {
  const [rateType, setRateType] = useState<CommissionRateType>(value.commissionRateType);
  const [percent, setPercent] = useState(
    value.commissionRate !== null ? String(Math.round(value.commissionRate * 10000) / 100) : ""
  );
  const [flatNaira, setFlatNaira] = useState(
    value.commissionFlatKobo !== null ? String(koboToNaira(value.commissionFlatKobo)) : ""
  );

  const canSave =
    rateType === "percentage"
      ? percent.trim().length > 0 && !Number.isNaN(Number(percent))
      : flatNaira.trim().length > 0 && !Number.isNaN(Number(flatNaira));

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-charcoal-ink/10 bg-warm-ivory p-2.5">
      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-rate-type`} className="text-xs text-charcoal-ink/60">
          Type
        </label>
        <Select
          id={`${idPrefix}-rate-type`}
          value={rateType}
          onChange={(e) => setRateType(e.target.value as CommissionRateType)}
          className="h-9 w-32"
        >
          <option value="percentage">Percentage</option>
          <option value="flat">Flat fee</option>
        </Select>
      </div>
      {rateType === "percentage" ? (
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-rate-pct`} className="text-xs text-charcoal-ink/60">
            Commission %
          </label>
          <Input
            id={`${idPrefix}-rate-pct`}
            type="number"
            min="0"
            max="100"
            step="0.01"
            className="h-9 w-24"
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
          />
        </div>
      ) : (
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-rate-flat`} className="text-xs text-charcoal-ink/60">
            Flat fee (₦)
          </label>
          <Input
            id={`${idPrefix}-rate-flat`}
            type="number"
            min="0"
            step="1"
            className="h-9 w-28"
            value={flatNaira}
            onChange={(e) => setFlatNaira(e.target.value)}
          />
        </div>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={!canSave || isSaving}
        onClick={() =>
          onSave({
            commissionRateType: rateType,
            commissionRate: rateType === "percentage" ? Number(percent) / 100 : null,
            commissionFlatKobo: rateType === "flat" ? nairaToKobo(Number(flatNaira)) : null,
          })
        }
      >
        {isSaving ? "Saving…" : "Save rate"}
      </Button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </div>
  );
}
