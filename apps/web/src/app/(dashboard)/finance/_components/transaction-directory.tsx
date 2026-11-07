"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, Download, Columns3, Bookmark, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { LoadFailure, StaleDataNotice } from "@/components/ui/load-failure";
import { formatMinor, formatNumber } from "@/lib/analytics/format";
import { PAYER_TYPE_LABEL, providerLabel, streamLabel } from "@/lib/finance/definitions";
import {
  EMPTY_FILTERS,
  EVENT_KINDS,
  EVENT_KIND_LABEL,
  ExportTooLargeError,
  PAGE_SIZE,
  PAYER_TYPES,
  SETTLEMENT_LABEL,
  SETTLEMENT_STATUSES,
  activeFilterCount,
  fetchAllTransactionsForExport,
  filtersFromParams,
  filtersToParams,
  transactionHref,
  transactionsCsv,
  useTransactions,
  type TransactionFilters,
  type TransactionRow,
} from "@/lib/finance/transactions";
import { PeriodSelector, useFinancePeriod } from "./period-selector";
import { CenterNote } from "./primitives";

// ---------------------------------------------------------------------------
// Per-viewer conveniences in browser storage (never shared, never relied on).
// ---------------------------------------------------------------------------

const COLUMNS_KEY = "finance.transactions.columns.v1";
const SAVED_KEY = "finance.transactions.saved.v1";

const COLUMNS = [
  { key: "date", label: "Date", always: true },
  { key: "reference", label: "Reference", always: false },
  { key: "payer", label: "Payer", always: true },
  { key: "beneficiary", label: "Beneficiary", always: false },
  { key: "category", label: "Category", always: false },
  { key: "amount", label: "Amount", always: true },
  { key: "provider", label: "Provider", always: false },
  { key: "status", label: "Status", always: true },
  { key: "settlement", label: "Settlement", always: false },
] as const;
type ColumnKey = (typeof COLUMNS)[number]["key"];

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private window or blocked storage: the page works without it.
  }
}

interface SavedFilter {
  name: string;
  query: string;
}

// ---------------------------------------------------------------------------

const STATUS_BADGE = {
  payment: "normal",
  failed_payment: "attention",
  refund: "info",
} as const;

const SETTLEMENT_BADGE = {
  settled: "normal",
  awaiting_settlement: "grey",
  exception: "attention",
  not_applicable: "inactive",
} as const;

function ToggleChips({
  legend,
  options,
  labels,
  selected,
  onChange,
}: {
  legend: string;
  options: readonly string[];
  labels: Record<string, string>;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1.5">
      <legend className="mr-1 text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">{legend}</legend>
      {options.map((o) => {
        const on = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? selected.filter((s) => s !== o) : [...selected, o])}
            className={`rounded-full border px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green ${
              on
                ? "border-brand-green bg-soft-sage text-charcoal-ink dark:bg-brand-green/20 dark:text-night-ink"
                : "border-charcoal-ink/15 text-charcoal-ink/70 hover:border-charcoal-ink/30 dark:border-night-ink/20 dark:text-night-ink/70"
            }`}
          >
            {labels[o] ?? o}
          </button>
        );
      })}
    </fieldset>
  );
}

function SortHeader({
  label,
  column,
  filters,
  onSort,
  right,
}: {
  label: string;
  column: "occurred_at" | "amount";
  filters: TransactionFilters;
  onSort: (sort: "occurred_at" | "amount", dir: "asc" | "desc") => void;
  right?: boolean;
}) {
  const active = filters.sort === column;
  const nextDir = active && filters.dir === "desc" ? "asc" : "desc";
  return (
    <th
      scope="col"
      aria-sort={active ? (filters.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`py-2 pr-4 font-medium ${right ? "text-right" : "text-left"}`}
    >
      <button type="button" onClick={() => onSort(column, nextDir)} className="inline-flex items-center gap-1 hover:text-charcoal-ink dark:hover:text-night-ink">
        {label}
        {active && (filters.dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
      </button>
    </th>
  );
}

function formatWhen(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }) : "Not recorded";
}

export function TransactionDirectory() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const period = useFinancePeriod();
  const filters = useMemo(() => filtersFromParams(new URLSearchParams(params.toString())), [params]);
  const q = useTransactions(period.from, period.to, filters);

  const [searchText, setSearchText] = useState(filters.search);
  const [minText, setMinText] = useState(filters.minNaira);
  const [maxText, setMaxText] = useState(filters.maxNaira);
  const [shown, setShown] = useState<ColumnKey[]>(COLUMNS.map((c) => c.key));
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const [showColumns, setShowColumns] = useState(false);
  const [exportState, setExportState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  // Browser storage is read after the first render (it does not exist on the server), from a callback rather than
  // synchronously in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    const id = setTimeout(() => {
      setShown(readStorage<ColumnKey[]>(COLUMNS_KEY, COLUMNS.map((c) => c.key)));
      setSaved(readStorage<SavedFilter[]>(SAVED_KEY, []));
    }, 0);
    return () => clearTimeout(id);
  }, []);

  // When the URL's search changes from outside the box (a saved filter, Clear filters, back button), follow it.
  const [lastUrlSearch, setLastUrlSearch] = useState(filters.search);
  if (lastUrlSearch !== filters.search) {
    setLastUrlSearch(filters.search);
    setSearchText(filters.search);
  }

  function apply(next: Partial<TransactionFilters>, keepPage = false) {
    const merged = { ...filters, ...next, page: keepPage ? (next.page ?? filters.page) : 0 };
    const p = filtersToParams(merged, new URLSearchParams(params.toString()));
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }

  // Search as you type, after a pause.
  useEffect(() => {
    if (searchText === filters.search) return;
    const t = setTimeout(() => apply({ search: searchText }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  const amountInvalid = (v: string) => v.trim() !== "" && !/^\d{1,12}(\.\d{1,2})?$/.test(v.replace(/,/g, "").trim());

  function toggleColumn(key: ColumnKey) {
    const next = shown.includes(key) ? shown.filter((k) => k !== key) : [...shown, key];
    setShown(next);
    writeStorage(COLUMNS_KEY, next);
  }

  function saveCurrent() {
    const name = window.prompt("Name this filter");
    if (!name?.trim()) return;
    const query = params.toString();
    const next = [...saved.filter((s) => s.name !== name.trim()), { name: name.trim().slice(0, 40), query }].slice(-12);
    setSaved(next);
    writeStorage(SAVED_KEY, next);
  }

  function removeSaved(name: string) {
    const next = saved.filter((s) => s.name !== name);
    setSaved(next);
    writeStorage(SAVED_KEY, next);
  }

  async function exportCsv() {
    setExportState({ busy: true, error: null });
    try {
      const rows = await fetchAllTransactionsForExport(period.from, period.to, filters);
      const blob = new Blob([transactionsCsv(rows, { from: period.from, to: period.to, generatedAt: new Date().toISOString() })], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tarragon-transactions-${period.from}-to-${period.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setExportState({ busy: false, error: null });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      setExportState({
        busy: false,
        error:
          e instanceof ExportTooLargeError
            ? e.message
            : code === "42501"
              ? "Exporting needs the finance export permission. Ask a finance administrator to grant it."
              : "The export could not be completed and nothing was saved. Try again.",
      });
    }
  }

  const data = q.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const col = (k: ColumnKey) => shown.includes(k) || COLUMNS.find((c) => c.key === k)?.always;

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm dark:border-night-ink/15 dark:bg-night-card dark:shadow-none">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PeriodSelector period={period} />
          <label className="grid min-w-64 flex-1 gap-1 text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70 sm:max-w-sm">
            Search
            <Input
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value.slice(0, 100))}
              placeholder="Payer, beneficiary or reference"
              className="h-9"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <ToggleChips legend="Type" options={EVENT_KINDS} labels={EVENT_KIND_LABEL} selected={filters.kinds} onChange={(kinds) => apply({ kinds })} />
          <ToggleChips legend="Payer" options={PAYER_TYPES} labels={PAYER_TYPE_LABEL} selected={filters.payerTypes} onChange={(payerTypes) => apply({ payerTypes })} />
          <ToggleChips legend="Settlement" options={SETTLEMENT_STATUSES} labels={SETTLEMENT_LABEL} selected={filters.settlement} onChange={(settlement) => apply({ settlement })} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (amountInvalid(minText) || amountInvalid(maxText)) return;
              apply({ minNaira: minText.replace(/,/g, "").trim(), maxNaira: maxText.replace(/,/g, "").trim() });
            }}
          >
            <label className="grid gap-1 text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
              Amount from (₦)
              <Input className="h-9 w-32" inputMode="decimal" value={minText} onChange={(e) => setMinText(e.target.value)} aria-invalid={amountInvalid(minText)} />
            </label>
            <label className="grid gap-1 text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
              to (₦)
              <Input className="h-9 w-32" inputMode="decimal" value={maxText} onChange={(e) => setMaxText(e.target.value)} aria-invalid={amountInvalid(maxText)} />
            </label>
            <Button type="submit" size="sm" variant="outline" disabled={amountInvalid(minText) || amountInvalid(maxText)}>
              Apply
            </Button>
          </form>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {activeFilterCount(filters) > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setMinText("");
                  setMaxText("");
                  setSearchText("");
                  apply(EMPTY_FILTERS);
                }}
              >
                Clear filters ({activeFilterCount(filters)})
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={saveCurrent}>
              <Bookmark className="h-4 w-4" aria-hidden /> Save filter
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setShowColumns((s) => !s)} aria-expanded={showColumns}>
              <Columns3 className="h-4 w-4" aria-hidden /> Columns
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={exportCsv} disabled={exportState.busy || !data || data.total === 0}>
              <Download className="h-4 w-4" aria-hidden /> {exportState.busy ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
        </div>
        {saved.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-charcoal-ink/60 dark:text-night-ink/60">Saved:</span>
            {saved.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1 rounded-full border border-charcoal-ink/15 pl-2.5 dark:border-night-ink/20">
                <button type="button" className="hover:underline" onClick={() => router.replace(`${pathname}?${s.query}`, { scroll: false })}>
                  {s.name}
                </button>
                <button type="button" aria-label={`Remove saved filter ${s.name}`} onClick={() => removeSaved(s.name)} className="rounded-full p-1 hover:bg-soft-sage">
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}
        {showColumns && (
          <fieldset className="flex flex-wrap gap-3 text-xs">
            <legend className="sr-only">Columns shown</legend>
            {COLUMNS.filter((c) => !c.always).map((c) => (
              <label key={c.key} className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={shown.includes(c.key)} onChange={() => toggleColumn(c.key)} />
                {c.label}
              </label>
            ))}
          </fieldset>
        )}
        {exportState.error && <LoadFailure>{exportState.error}</LoadFailure>}
      </div>

      {q.isError && !data && (
        <LoadFailure>
          The transactions could not be loaded, so none are shown. This is not the same as there being none. Reload the page to try again.
        </LoadFailure>
      )}
      {q.isError && data && <StaleDataNotice>The list below may be out of date: the last refresh failed.</StaleDataNotice>}
      {q.isLoading && <CenterNote>Loading transactions…</CenterNote>}

      {data && (
        <div className="rounded-xl border border-charcoal-ink/10 bg-white shadow-sm dark:border-night-ink/15 dark:bg-night-card dark:shadow-none">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-charcoal-ink/10 px-4 py-3 text-sm dark:border-night-ink/15">
            <p className="text-charcoal-ink dark:text-night-ink">
              <span className="font-medium">{formatNumber(data.total)}</span> {data.total === 1 ? "record" : "records"} · {period.label}
            </p>
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Payments {formatMinor(data.total_payments_minor, "NGN")} · Refunds {formatMinor(data.total_refunds_minor, "NGN")}
            </p>
          </div>
          {data.rows.length === 0 ? (
            <CenterNote>No transactions match these filters in this period.</CenterNote>
          ) : (
            <>
              {/* Table on wider screens */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <caption className="sr-only">Transactions, {period.label}</caption>
                  <thead className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                    <tr className="border-b border-charcoal-ink/10 dark:border-night-ink/15">
                      <SortHeader label="Date" column="occurred_at" filters={filters} onSort={(sort, dir) => apply({ sort, dir })} />
                      {col("reference") && <th scope="col" className="py-2 pr-4 text-left font-medium">Reference</th>}
                      <th scope="col" className="py-2 pr-4 text-left font-medium">Payer</th>
                      {col("beneficiary") && <th scope="col" className="py-2 pr-4 text-left font-medium">Beneficiary</th>}
                      {col("category") && <th scope="col" className="py-2 pr-4 text-left font-medium">Category</th>}
                      <SortHeader label="Amount" column="amount" filters={filters} onSort={(sort, dir) => apply({ sort, dir })} right />
                      {col("provider") && <th scope="col" className="py-2 pr-4 text-left font-medium">Provider</th>}
                      <th scope="col" className="py-2 pr-4 text-left font-medium">Status</th>
                      {col("settlement") && <th scope="col" className="py-2 pr-4 text-left font-medium">Settlement</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <Row key={r.event_id} r={r} col={col} />
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Cards on phones */}
              <ul className="divide-y divide-charcoal-ink/5 md:hidden dark:divide-night-ink/10">
                {data.rows.map((r) => {
                  const href = transactionHref(r.record_type, r.record_id);
                  const body = (
                    <div className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-charcoal-ink dark:text-night-ink">{r.payer_label}</p>
                        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                          {streamLabel(r.stream)} · {formatWhen(r.occurred_at)}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge variant={STATUS_BADGE[r.event_kind]}>{EVENT_KIND_LABEL[r.event_kind]}</Badge>
                          <Badge variant={SETTLEMENT_BADGE[r.settlement_status]}>{SETTLEMENT_LABEL[r.settlement_status]}</Badge>
                        </div>
                      </div>
                      <p className="shrink-0 tabular-nums font-medium text-charcoal-ink dark:text-night-ink">
                        {r.event_kind === "refund" ? "−" : ""}
                        {formatMinor(r.amount_minor, r.currency)}
                      </p>
                    </div>
                  );
                  return <li key={r.event_id}>{href ? <Link href={href} className="block hover:bg-soft-sage/40">{body}</Link> : body}</li>;
                })}
              </ul>
            </>
          )}
          <nav aria-label="Pages" className="flex items-center justify-between gap-2 border-t border-charcoal-ink/10 px-4 py-3 text-xs dark:border-night-ink/15">
            <span className="text-charcoal-ink/60 dark:text-night-ink/60">
              Page {filters.page + 1} of {formatNumber(pages)}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={filters.page === 0} onClick={() => apply({ page: filters.page - 1 }, true)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={filters.page + 1 >= pages} onClick={() => apply({ page: filters.page + 1 }, true)}>
                Next
              </Button>
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}

function Row({ r, col }: { r: TransactionRow; col: (k: ColumnKey) => boolean | undefined }) {
  const href = transactionHref(r.record_type, r.record_id);
  return (
    <tr className="border-b border-charcoal-ink/5 last:border-0 hover:bg-soft-sage/30 dark:border-night-ink/10 dark:hover:bg-brand-green/10">
      <td className="whitespace-nowrap py-2.5 pl-4 pr-4 text-charcoal-ink/80 dark:text-night-ink/80">
        {href ? (
          <Link href={href} className="font-medium text-brand-green hover:underline dark:text-brand-green-bright">
            {formatWhen(r.occurred_at)}
          </Link>
        ) : (
          formatWhen(r.occurred_at)
        )}
      </td>
      {col("reference") && <td className="py-2.5 pr-4 font-mono text-xs text-charcoal-ink/70 dark:text-night-ink/70">{r.reference ?? "None"}</td>}
      <td className="py-2.5 pr-4 text-charcoal-ink dark:text-night-ink">
        {r.payer_label}
        {r.payer_type !== "individual" && (
          <span className="ml-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">({PAYER_TYPE_LABEL[r.payer_type] ?? r.payer_type})</span>
        )}
      </td>
      {col("beneficiary") && <td className="py-2.5 pr-4 text-charcoal-ink/80 dark:text-night-ink/80">{r.beneficiary_label ?? "Same as payer"}</td>}
      {col("category") && (
        <td className="py-2.5 pr-4 text-charcoal-ink/80 dark:text-night-ink/80">
          {streamLabel(r.stream)}
          {r.is_renewal ? " renewal" : ""}
        </td>
      )}
      <td className="whitespace-nowrap py-2.5 pr-4 text-right tabular-nums font-medium text-charcoal-ink dark:text-night-ink">
        {r.event_kind === "refund" ? "−" : ""}
        {formatMinor(r.amount_minor, r.currency)}
        {r.refunded_minor > 0 && (
          <span className="block text-xs font-normal text-charcoal-ink/60 dark:text-night-ink/60">{formatMinor(r.refunded_minor, r.currency)} refunded</span>
        )}
      </td>
      {col("provider") && <td className="py-2.5 pr-4 text-charcoal-ink/80 dark:text-night-ink/80">{providerLabel(r.provider)}</td>}
      <td className="py-2.5 pr-4">
        <Badge variant={STATUS_BADGE[r.event_kind]}>{EVENT_KIND_LABEL[r.event_kind]}</Badge>
        {r.processing_error && <span className="ml-1 text-xs text-status-attention-text">not applied</span>}
      </td>
      {col("settlement") && (
        <td className="py-2.5 pr-4">
          <Badge variant={SETTLEMENT_BADGE[r.settlement_status]}>{SETTLEMENT_LABEL[r.settlement_status]}</Badge>
        </td>
      )}
    </tr>
  );
}
