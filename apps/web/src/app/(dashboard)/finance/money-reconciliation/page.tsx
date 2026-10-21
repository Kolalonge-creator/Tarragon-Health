import Link from "next/link";
import { getProposedConfig } from "@tarragon/shared";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKobo } from "@/lib/format-money";
import {
  KIND_LABEL,
  KIND_ORDER,
  OWNER_LABEL,
  ageLabel,
  mismatchListSchema,
  parseScreenParams,
  subjectHref,
  subjectName,
  summaryListSchema,
  type MismatchRow,
} from "@/lib/finance/money-reconciliation";

export const metadata = { title: "Money reconciliation" };
export const dynamic = "force-dynamic";

const configSchema = z.object({
  unsent_refund_minutes: z.number().int().positive(),
  grace_minutes: z.number().int().nonnegative(),
  page_size: z.number().int().positive().max(200),
});

function href(params: { kind: string | null; includeTest: boolean; page: number }): string {
  const q = new URLSearchParams();
  if (params.kind) q.set("kind", params.kind);
  if (params.includeTest) q.set("test", "1");
  if (params.page > 1) q.set("page", String(params.page));
  const s = q.toString();
  return s ? `/finance/money-reconciliation?${s}` : "/finance/money-reconciliation";
}

function RecordLink({ type, id }: { type: string; id: string }) {
  const target = subjectHref(type);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-1">
      <span className="text-charcoal-ink/60">{subjectName(type)}</span>
      <code className="rounded bg-charcoal-ink/5 px-1 text-xs">{id}</code>
      {target && (
        <Link href={target} className="text-xs font-medium text-brand-green hover:underline">
          Open list
        </Link>
      )}
    </span>
  );
}

function Row({ r }: { r: MismatchRow }) {
  return (
    <div className="space-y-1 border-b border-charcoal-ink/10 py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{KIND_LABEL[r.kind] ?? r.kind}</span>
        <span className="font-semibold">
          {r.delta_kobo === null ? "Amount not stored" : `${r.delta_kobo > 0 ? "+" : ""}${formatKobo(r.delta_kobo)}`}
        </span>
      </div>
      <p className="text-charcoal-ink/70">{r.detail}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <Badge variant={r.severity === "high" ? "red" : "amber"}>{r.severity === "high" ? "Money differs" : "Check"}</Badge>
        <RecordLink type={r.subject_type} id={r.subject_id} />
        {r.related_type && r.related_id && <RecordLink type={r.related_type} id={r.related_id} />}
        <span className="text-charcoal-ink/60">Wrong for {ageLabel(r.since)}</span>
        <span className="text-charcoal-ink/60">Likely owner: {OWNER_LABEL[r.owner_hint] ?? r.owner_hint}</span>
      </div>
    </div>
  );
}

/**
 * Read-only money reconciliation: only the places where two money records disagree. It never moves, posts, retries or fixes money, and
 * it holds no balance (INV-09). The database functions check the caller again (finance, admin or finance.view) and RAISE for anyone else,
 * so a failed read is shown as an error here and is never mistaken for "nothing disagrees".
 */
export default async function MoneyReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; test?: string; page?: string }>;
}) {
  const params = parseScreenParams(await searchParams);
  const config = configSchema.parse(getProposedConfig("finance.reconciliation").value);
  const supabase = await createClient();

  const args = { p_include_test: params.includeTest, p_unsent_minutes: config.unsent_refund_minutes, p_grace_minutes: config.grace_minutes };
  const [list, summary] = await Promise.all([
    supabase.rpc("money_reconciliation_list", {
      ...args,
      p_kind: params.kind,
      p_limit: config.page_size,
      p_offset: (params.page - 1) * config.page_size,
    }),
    supabase.rpc("money_reconciliation_summary", args),
  ]);

  const rows = list.error ? null : mismatchListSchema.safeParse(list.data);
  const counts = summary.error ? null : summaryListSchema.safeParse(summary.data);
  const failed = !rows?.success || !counts?.success;
  // A page past the end must never read as "all clear" while the counts above say otherwise.
  const viewCount = counts?.success
    ? counts.data.filter((c) => params.kind === null || c.kind === params.kind).reduce((a, c) => a + c.n, 0)
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Money reconciliation</h1>
        <p className="text-sm text-charcoal-ink/60">
          Only the places where Paystack payments, orders, entitlements, refunds, clinician earnings, payouts and the general ledger
          disagree. Nothing here changes any money: fix each item where it belongs, then reload. A refund counts as stuck while sending
          after the refund policy window, an approved refund that has not gone back is flagged after {config.unsent_refund_minutes} minutes,
          and records that are normally made within moments of each other are checked after {config.grace_minutes} minutes.
        </p>
      </div>

      {failed && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          The reconciliation could not be read{list.error ? `: ${list.error.message}` : summary.error ? `: ${summary.error.message}` : ""}. This is
          not the same as everything agreeing. Reload, and if it keeps failing tell engineering.
        </p>
      )}

      {rows?.success && counts?.success && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                {counts.data.length === 0 ? "Everything checked agrees" : `${counts.data.reduce((a, c) => a + c.n, 0)} to look at`}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2">
                <Link href={href({ ...params, kind: null, page: 1 })} className={`rounded-full border px-3 py-1 ${params.kind === null ? "border-brand-green bg-brand-green/10" : "border-charcoal-ink/20"}`}>
                  All
                </Link>
                {[...counts.data]
                  .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
                  .map((c) => (
                    <Link
                      key={c.kind}
                      href={href({ ...params, kind: c.kind, page: 1 })}
                      className={`rounded-full border px-3 py-1 ${params.kind === c.kind ? "border-brand-green bg-brand-green/10" : "border-charcoal-ink/20"}`}
                    >
                      {KIND_LABEL[c.kind] ?? c.kind}: {c.n}
                    </Link>
                  ))}
              </div>
              <p className="text-xs text-charcoal-ink/60">
                {params.includeTest ? "Test records are included. " : "Test records are left out. "}
                <Link href={href({ ...params, includeTest: !params.includeTest, page: 1 })} className="font-medium text-brand-green hover:underline">
                  {params.includeTest ? "Leave them out" : "Include test records"}
                </Link>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{params.kind ? (KIND_LABEL[params.kind] ?? params.kind) : "Mismatches"}</CardTitle>
            </CardHeader>
            <CardContent>
              {rows.data.length === 0 && viewCount > 0 ? (
                <p role="status" className="text-sm text-amber-800">
                  There is nothing on this page, but {viewCount} item{viewCount === 1 ? "" : "s"} exist in this view.{" "}
                  <Link href={href({ ...params, page: 1 })} className="font-medium text-brand-green hover:underline">Back to page 1</Link>
                </p>
              ) : rows.data.length === 0 ? (
                <p className="text-sm text-charcoal-ink/60">Nothing disagrees in this view.</p>
              ) : (
                rows.data.map((r) => <Row key={`${r.kind}:${r.subject_id}:${r.related_id ?? ""}:${r.detail}`} r={r} />)
              )}
              {(() => {
                const total = rows.data[0]?.total_count ?? 0;
                const pages = Math.max(1, Math.ceil(total / config.page_size));
                if (pages <= 1) return null;
                return (
                  <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pages">
                    {params.page > 1 ? <Link href={href({ ...params, page: params.page - 1 })} className="text-brand-green hover:underline">Previous</Link> : <span />}
                    <span className="text-charcoal-ink/60">Page {params.page} of {pages}</span>
                    {params.page < pages ? <Link href={href({ ...params, page: params.page + 1 })} className="text-brand-green hover:underline">Next</Link> : <span />}
                  </nav>
                );
              })()}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
