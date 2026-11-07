import Link from "next/link";
import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { FlashClean } from "@/components/go-live/flash-clean";
import { loadImportBatches, loadImportRows } from "@/lib/diagnostic-directory/load";
import { asNotice, BAD_NOTICES, type ImportBatch, type ImportRow } from "@/lib/diagnostic-directory/model";
import { applyImportRowAction, rejectImportRowAction, stageImportAction } from "@/lib/diagnostic-directory/import-actions";
import { btn, card, input, lagosDate, Notice } from "../ui";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Import directory rows" };
export const dynamic = "force-dynamic";

const locale = DEFAULT_UI_LANGUAGE;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHOWN = ["trading_name", "branch_name", "facility_type", "town", "state", "investigation_codes", "regulator", "evidence"] as const;

/**
 * Diagnostic directory Phase 7: upload the data-collection spreadsheet, see each row's problems, and turn good rows into DRAFT
 * records one at a time. Importing never lists, verifies or confirms anything; that is still done on the provider page.
 */
export default async function DiagnosticImportPage({ searchParams }: { searchParams: Promise<{ n?: string; batch?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const sp = await searchParams;
  const notice = asNotice(sp.n);
  const batchId = sp.batch && UUID.test(sp.batch) ? sp.batch : null;
  const [batches, rows] = await Promise.all([loadImportBatches(), batchId ? loadImportRows(batchId) : Promise.resolve(null)]);
  if (!batches.ok && batches.denied) redirect("/admin");

  return (
    <div className="space-y-8">
      <PageHeader title={t("dxdir.import.title", locale)} description={t("dxdir.import.intro", locale)} backTo={{ href: "/admin/ops/diagnostic-directory", label: t("dxdir.import.back", locale) }} />
      {notice && <FlashClean />}
      {notice && <Notice notice={notice} bad={BAD_NOTICES.has(notice)} />}
      <Upload />
      {!batches.ok || (rows && !rows.ok) ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("dxdir.load_error", locale)}</p>
      ) : (
        <>
          <Batches batches={batches.data} current={batchId} />
          {rows && rows.ok && batchId && <Rows batchId={batchId} rows={rows.data} />}
        </>
      )}
    </div>
  );
}

function Upload() {
  return (
    <section aria-labelledby="dx-imp-upload" className={`${card} space-y-2`}>
      <h2 id="dx-imp-upload" className="font-heading text-lg font-semibold text-charcoal-ink">{t("dxdir.import.upload", locale)}</h2>
      <p className="text-xs text-charcoal-ink/70">{t("dxdir.import.upload_hint", locale)}</p>
      <form action={stageImportAction} className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-charcoal-ink">{t("dxdir.import.source", locale)}
          <input name="source" required minLength={3} maxLength={200} className={input} />
        </label>
        <label className="block text-xs text-charcoal-ink">{t("dxdir.import.file", locale)}
          <input type="file" name="file" accept=".csv,text/csv" required className={input} />
        </label>
        <input name="note" maxLength={1000} placeholder={t("dxdir.import.note", locale)} className={`${input} sm:col-span-2`} />
        <button type="submit" className={`${btn} bg-brand-green text-white sm:w-fit`}>{t("dxdir.import.stage", locale)}</button>
      </form>
    </section>
  );
}

function Batches({ batches, current }: { batches: ImportBatch[]; current: string | null }) {
  return (
    <section aria-labelledby="dx-imp-batches" className="space-y-2">
      <h2 id="dx-imp-batches" className="font-heading text-lg font-semibold text-charcoal-ink">{t("dxdir.import.batches", locale)}</h2>
      {batches.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">{t("dxdir.import.no_batches", locale)}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {batches.map((b) => (
            <li key={b.id}>
              <Link href={`/admin/ops/diagnostic-directory/import?batch=${b.id}`} className={b.id === current ? "font-semibold text-charcoal-ink" : "text-brand-green hover:underline"}>
                {b.source}
              </Link>{" "}
              <span className="text-xs text-charcoal-ink/60">
                {t("dxdir.import.batch_counts", locale, {
                  date: lagosDate(b.created_at), by: b.created_by ?? "-", rows: b.rows, staged: b.staged, invalid: b.invalid,
                  applied: b.applied, rejected: b.rejected,
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Rows({ batchId, rows }: { batchId: string; rows: ImportRow[] }) {
  return (
    <section aria-labelledby="dx-imp-rows" className="space-y-2">
      <h2 id="dx-imp-rows" className="font-heading text-lg font-semibold text-charcoal-ink">{t("dxdir.import.rows", locale)}</h2>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className={`${card} space-y-1 text-sm`}>
            <p className="font-medium text-charcoal-ink">
              {t("dxdir.import.row", locale, { n: r.row_number })}{" "}
              <span className="rounded-full bg-charcoal-ink/10 px-2 py-0.5 text-xs font-semibold">{t(`dxdir.import.status.${r.status}`, locale)}</span>
            </p>
            <p className="text-xs text-charcoal-ink/70">
              {SHOWN.map((k) => (typeof r.data[k] === "string" && r.data[k] !== "" ? `${k}: ${String(r.data[k])}` : null)).filter(Boolean).join(" · ")}
            </p>
            {r.problems.length > 0 && <p className="text-xs text-amber-900">{t("dxdir.import.problems", locale)} {r.problems.join("; ")}</p>}
            {r.outcome && <p className="text-xs text-charcoal-ink/70">{r.outcome}{r.decided_by ? ` (${r.decided_by}, ${lagosDate(r.decided_at)})` : ""}</p>}
            {r.status === "applied" && r.provider_listing_id && (
              <Link href={`/admin/ops/diagnostic-directory/${r.provider_listing_id}`} className="text-xs font-semibold text-brand-green hover:underline">
                {t("dxdir.import.open_draft", locale)}
              </Link>
            )}
            {(r.status === "staged" || r.status === "invalid") && (
              <div className="flex flex-wrap items-start gap-2">
                {r.status === "staged" && (
                  <form action={applyImportRowAction}>
                    <input type="hidden" name="batch_id" value={batchId} />
                    <input type="hidden" name="row_id" value={r.id} />
                    <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("dxdir.import.apply", locale)}</button>
                  </form>
                )}
                <details>
                  <summary className="cursor-pointer text-xs font-semibold text-brand-green">{t("dxdir.import.reject", locale)}</summary>
                  <form action={rejectImportRowAction} className="mt-1 flex gap-2">
                    <input type="hidden" name="batch_id" value={batchId} />
                    <input type="hidden" name="row_id" value={r.id} />
                    <input name="reason" required minLength={10} maxLength={500} placeholder={t("dxdir.f.reason", locale)} className={input} />
                    <button type="submit" className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t("dxdir.import.reject", locale)}</button>
                  </form>
                </details>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
