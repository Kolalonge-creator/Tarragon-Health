"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  COMPARE_KEYS,
  COMPARE_LABEL,
  PERIOD_KEYS,
  PERIOD_LABEL,
  lagosToday,
  periodSearchParams,
  resolvePeriod,
  type CompareKey,
  type PeriodKey,
  type ResolvedPeriod,
} from "@/lib/finance/periods";

/**
 * The reporting period for the current finance page, read from the URL
 * (`?period=&compare=&from=&to=`). Every widget on the page calls this, so they
 * all cover the same dates, and a link to the page keeps the period.
 */
export function useFinancePeriod(): ResolvedPeriod {
  const params = useSearchParams();
  const period = params.get("period");
  const compare = params.get("compare");
  const from = params.get("from");
  const to = params.get("to");
  return useMemo(() => resolvePeriod({ period, compare, from, to }, lagosToday()), [period, compare, from, to]);
}

export function PeriodSelector({ period }: { period: ResolvedPeriod }) {
  const router = useRouter();
  const pathname = usePathname();
  const [customFrom, setCustomFrom] = useState(period.key === "custom" ? period.from : "");
  const [customTo, setCustomTo] = useState(period.key === "custom" ? period.to : "");
  const [showCustom, setShowCustom] = useState(period.key === "custom");

  function go(next: { period: PeriodKey; compare: CompareKey; from?: string; to?: string }) {
    router.replace(`${pathname}?${periodSearchParams(next).toString()}`, { scroll: false });
  }

  const customInvalid = !customFrom || !customTo || customFrom > customTo;

  return (
    <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Reporting period">
      <label className="grid gap-1 text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
        Period
        <Select
          className="h-9 w-44"
          value={showCustom ? "custom" : period.key}
          onChange={(e) => {
            const key = e.target.value as PeriodKey;
            if (key === "custom") {
              setShowCustom(true);
              return;
            }
            setShowCustom(false);
            go({ period: key, compare: period.compare });
          }}
        >
          {PERIOD_KEYS.map((k) => (
            <option key={k} value={k}>
              {PERIOD_LABEL[k]}
            </option>
          ))}
        </Select>
      </label>

      {showCustom && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!customInvalid) go({ period: "custom", compare: period.compare, from: customFrom, to: customTo });
          }}
        >
          <label className="grid gap-1 text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
            From
            <input
              type="date"
              className="h-9 rounded-md border border-charcoal-ink/20 bg-white px-2 text-sm dark:border-night-ink/25 dark:bg-night-card dark:text-night-ink"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
            To
            <input
              type="date"
              className="h-9 rounded-md border border-charcoal-ink/20 bg-white px-2 text-sm dark:border-night-ink/25 dark:bg-night-card dark:text-night-ink"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </label>
          <Button type="submit" size="sm" disabled={customInvalid}>
            Apply
          </Button>
        </form>
      )}

      <label className="grid gap-1 text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
        Compare with
        <Select
          className="h-9 w-52"
          value={period.compare}
          onChange={(e) =>
            go({
              period: period.key,
              compare: e.target.value as CompareKey,
              ...(period.key === "custom" ? { from: period.from, to: period.to } : {}),
            })
          }
        >
          {COMPARE_KEYS.map((k) => (
            <option key={k} value={k}>
              {COMPARE_LABEL[k]}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}
