import { careGapText } from "@tarragon/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON } from "@/lib/icons";
import type { CareGapLedger, CareGapSummary, CareGapType, LedgerCell, LedgerReasonCell } from "@/lib/care-gaps/load-care-gaps";
import { gapTypeLabel } from "@/lib/care-gaps/gap-model";

const GAP_TYPE_LABEL: Record<CareGapType, string> = {
  overdue_screening: "Overdue screenings",
  stale_monitoring: "Stale chronic monitoring",
  unactioned_abnormal: "Unactioned abnormal results",
};

const cellText = (c: { n: number | null; suppressed: boolean }) => (c.suppressed || c.n === null ? careGapText("institution.withheld") : String(c.n));

function CellList({ cells, label }: { cells: (LedgerCell | LedgerReasonCell)[]; label: (key: string) => string }) {
  return (
    <ul className="grid grid-cols-1 gap-1 text-sm text-charcoal-ink/80 md:grid-cols-2">
      {cells.map((c) => (
        <li key={c.key} className="flex justify-between gap-3 border-b border-charcoal-ink/10 py-1">
          <span>{label(c.key)}</span>
          <span className="font-medium text-deep-forest">{cellText(c)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The ledger-backed counts: people with an open gap of each kind, and gaps closed in the last 90 days by a recorded outcome. Counts of people only. */
function LedgerBlock({ ledger }: { ledger: CareGapLedger | null }) {
  if (ledger === null) return <p className="text-sm text-charcoal-ink/60">These counts could not be loaded right now.</p>;
  if (!ledger.live) return <p className="text-sm text-charcoal-ink/60">{careGapText("institution.not_live")}</p>;
  return (
    <div className="space-y-3" data-testid="care-gap-ledger">
      <div>
        <p className="text-sm font-medium text-charcoal-ink">{careGapText("institution.open")}</p>
        <CellList cells={ledger.open.byType} label={gapTypeLabel} />
        {ledger.open.anyPeople !== null && (
          <p className="mt-1 text-sm text-charcoal-ink/70">
            {careGapText("institution.any_open")}: <span className="font-medium text-deep-forest">{ledger.open.anyPeople}</span>
          </p>
        )}
      </div>
      <div>
        <p className="text-sm font-medium text-charcoal-ink">{careGapText("institution.closed")}</p>
        <CellList cells={ledger.closed90d.byType} label={gapTypeLabel} />
        <p className="mt-2 text-sm font-medium text-charcoal-ink">{careGapText("institution.closed_by_reason")}</p>
        <CellList cells={ledger.closed90d.byReason} label={(k) => k.charAt(0).toUpperCase() + k.slice(1)} />
      </div>
      <p className="text-xs text-charcoal-ink/60">{careGapText("institution.withheld_note", { min: ledger.minCell })}</p>
    </div>
  );
}

/**
 * Care-gap closure tracked to completion (docs/Tarragon_Health_Master_Operating_Plan_v4.md
 * §13 — "care gap tracking"), as counts only.
 *
 * The per-member list this used to render was removed on 2026-07-29 under I9,
 * along with the RLS access that made it possible. The original justification
 * — that org-staff already had direct access to the underlying tables, so
 * showing the list exposed nothing new — was true and was the actual problem.
 *
 * S90: the "closed in the last 90 days" approximation is gone. Closed counts now come from the care gap ledger
 * (a closure is a recorded row with the outcome that closed it), through the single minimum-cell rule.
 */
export function CareGapPanel({ summary }: { summary: CareGapSummary | null }) {
  if (!summary) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.booking className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Care gaps
        </CardTitle>
        <CardDescription>
          Members with an overdue screening, stale chronic monitoring, or an abnormal result that hasn&apos;t
          been actioned yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile icon={SEMANTIC_ICON.booking} label="Open gaps" value={String(summary.totalOpen)} />
          {(Object.keys(GAP_TYPE_LABEL) as CareGapType[]).map((type) => (
            <StatTile
              key={type}
              icon={SEMANTIC_ICON.booking}
              label={GAP_TYPE_LABEL[type]}
              value={String(summary.byType[type])}
            />
          ))}
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-charcoal-ink">{careGapText("institution.title")}</p>
          <p className="text-sm text-charcoal-ink/60">{careGapText("institution.intro")}</p>
          <LedgerBlock ledger={summary.ledger} />
        </div>
        <p className="text-sm text-charcoal-ink/60">
          Each gap is worked by the member&apos;s own care team. Tarragon contacts them directly.
        </p>
      </CardContent>
    </Card>
  );
}
