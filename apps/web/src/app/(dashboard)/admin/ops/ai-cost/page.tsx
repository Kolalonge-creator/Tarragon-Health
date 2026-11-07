import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { loadAiCost } from "@/lib/ai-review/load";
import { nairaFromKobo } from "@/lib/ai-review/model";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/ui/data-table";

export const metadata = { title: "AI cost" };
export const dynamic = "force-dynamic";

/** S80c: AI cost per assistant per month in naira from integer kobo. Unpriced calls are counted apart and never shown as free. */
export default async function AiCostPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const locale = DEFAULT_UI_LANGUAGE;
  const loaded = await loadAiCost();
  if (!loaded.ok && loaded.denied) redirect("/admin");

  const columns: DataTableColumn[] = [
    { header: "AI", sortable: true },
    { header: "Month", sortable: true, defaultDir: "desc" },
    { header: t("aicostmonth.calls", locale), sortable: true, defaultDir: "desc", align: "right" },
    { header: t("aicostmonth.tokens", locale), align: "right" },
    { header: t("aicostmonth.cost", locale), sortable: true, defaultDir: "desc", align: "right" },
    { header: t("aicostmonth.unpriced", locale), sortable: true, defaultDir: "desc", align: "right" },
  ];
  const rows: DataTableRow[] = loaded.ok
    ? loaded.data.map((r) => ({
        key: `${r.system_code}:${r.month}`,
        searchText: `${r.system_code} ${r.month.slice(0, 7)}`,
        // A missing price sorts last (null), never as a zero cost.
        sort: [r.system_code, r.month, r.calls, null, r.cost_kobo, r.unpriced_calls],
        cells: [
          <span key="ai" className="font-medium text-charcoal-ink">{r.system_code}</span>,
          r.month.slice(0, 7),
          r.calls,
          `${r.input_tokens.toLocaleString("en-NG")} / ${r.output_tokens.toLocaleString("en-NG")}`,
          r.cost_kobo === null ? t("aicostmonth.price_missing", locale) : nairaFromKobo(r.cost_kobo),
          r.unpriced_calls,
        ],
      }))
    : [];

  return (
    <div className="space-y-6">
      <PageHeader title={t("aicostmonth.title", locale)} description={t("aicostmonth.intro", locale)} />
      {!loaded.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("aicostmonth.load_error", locale)}</p>
      ) : (
        <DataTable
          caption={t("aicostmonth.title", locale)}
          columns={columns}
          rows={rows}
          searchLabel="Search by AI or month"
          initialSort={{ column: 1, dir: "desc" }}
          emptyMessage={t("aicostmonth.empty", locale)}
        />
      )}
    </div>
  );
}
