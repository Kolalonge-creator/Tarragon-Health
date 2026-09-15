import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { resolveSelectedInsurer } from "@/lib/payer/scope";
import { InsurerPicker } from "../insurer-picker";
import { GenerateReportForm } from "./generate-report-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  STATUS_LABEL,
  STATUS_TONE,
  formatPeriod,
  formatDateTime,
  type BoardReportRow,
} from "@/lib/payer/board-report";

/**
 * The outcomes reports issued to one insurer.
 *
 * A dashboard answers "how are we doing right now". This page answers a
 * different question — "what can we put in front of our board" — and the
 * difference is that everything listed here is frozen, numbered, hashed and
 * either attested or visibly marked as a draft. Nothing on this page recomputes
 * anything; each row is a document that already exists.
 */
export default async function BoardReportIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ insurer?: string }>;
}) {
  const { insurer: requestedId } = await searchParams;
  const { options, selected } = await resolveSelectedInsurer(requestedId);

  if (!selected) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Outcomes reports</h1>
        <InsurerPicker options={options} selectedId={requestedId} />
        {options.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            No insurer is set up yet. A Tarragon admin creates one under Admin → Partners.
          </p>
        )}
      </div>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("payer_board_reports")
    .select(
      "id, report_number, period_start, period_end, status, content_hash, generated_at, attested_at, attestation_statement, attester_role_title, withdrawal_reason, snapshot"
    )
    .eq("insurer_id", selected.id)
    .order("period_end", { ascending: false })
    .order("sequence_no", { ascending: false });

  const reports = (data ?? []) as unknown as BoardReportRow[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Outcomes reports</h1>
          <p className="mt-1 text-sm text-charcoal-ink/60">{selected.name}</p>
        </div>
        <InsurerPicker options={options} selectedId={selected.id} />
      </div>

      <Card variant="soft">
        <CardHeader>
          <CardTitle>What makes these different from the dashboard</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-charcoal-ink/75">
          <p>
            Each report is a fixed document, not a live view. The figures are computed once and
            cannot be edited afterwards, every measure is published with the definition and the
            denominator it used, and anything measured on too few members is withheld rather than
            shown as a percentage.
          </p>
          <p>
            A report is a draft until a named Tarragon signatory attests it. Drafts are watermarked
            and should not be presented as final.
          </p>
        </CardContent>
      </Card>

      <GenerateReportForm insurerId={selected.id} />

      <Card>
        <CardHeader>
          <CardTitle>Issued reports</CardTitle>
          <CardDescription>Newest period first.</CardDescription>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">
              No report has been generated for this insurer yet.
            </p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">
              {reports.map((r) => (
                <li key={r.id} className="py-3">
                  <Link
                    href={`/payer/board-report/${r.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 hover:underline"
                  >
                    <span className="space-y-0.5">
                      <span className="block font-medium text-charcoal-ink">{r.report_number}</span>
                      <span className="block text-sm text-charcoal-ink/60">
                        {formatPeriod(r.period_start, r.period_end)} · generated{" "}
                        {formatDateTime(r.generated_at)}
                      </span>
                    </span>
                    <Badge className={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
