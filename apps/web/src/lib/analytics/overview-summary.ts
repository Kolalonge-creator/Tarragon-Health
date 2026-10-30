import { statTileValue, type StatTileValueProps } from "@/components/ui/stat-tile-value";
import { formatMinor, formatNumber, formatPercent } from "./format";
import type {
  BusinessSummary,
  ClinicalOutcomes,
  FacilityEngagement,
  FinancialSummary,
  GovernanceSummary,
  InvestorSummary,
} from "./schemas";

/**
 * What the analytics Overview shows, worked out apart from React so the rules
 * can be tested without rendering anything.
 *
 * The one rule behind all of it: a figure that is not known never renders as
 * zero. Before this module the Overview wrote `data?.x ?? 0` for every tile,
 * so a query that was still loading, had failed, or had been refused (the
 * governance RPC returns `{}` to a caller who is not an analyst, and the
 * schema fills that with zeros) was shown to the CEO as a real reading. The
 * worst case was the compliance tile, which read "No open risk items" with a
 * green up arrow whenever the risk figures simply were not there.
 *
 * It also stops the Overview describing revenue growth as "MRR". The
 * platform has no MRR (it charges per piece of work, see the investor page's
 * own note), so the number is revenue growth and now says so.
 */

/** The slice of a react-query result this module needs. */
export type QuerySlice<T> = { data: T | undefined; isPending: boolean };

export type TileDelta = { text: string; direction: "up" | "down" | "flat" };
export type OverviewTile = StatTileValueProps & { delta?: TileDelta };

export interface OverviewInputs {
  business: QuerySlice<BusinessSummary>;
  financial: QuerySlice<FinancialSummary>;
  investor: QuerySlice<InvestorSummary>;
  governance: QuerySlice<GovernanceSummary>;
  facilities: QuerySlice<FacilityEngagement>;
  outcomes: QuerySlice<ClinicalOutcomes>;
}

export interface OverviewSummary {
  banner: string;
  tiles: {
    revenue: OverviewTile;
    patients: OverviewTile;
    revenue12m: OverviewTile;
    verification: OverviewTile;
    facilities: OverviewTile;
    bpControl: OverviewTile;
  };
}

/** The muted line shown in a tile's place when its figure is not known. */
function unknownHint(q: { isPending: boolean }): string {
  return q.isPending ? "Loading" : "Could not load";
}

function unknownTile(q: { isPending: boolean }): OverviewTile {
  return statTileValue(null, unknownHint(q));
}

/**
 * The governance RPC answers `{}` to a caller who is not an analyst or admin,
 * and `governanceSummarySchema` turns `{}` into a full set of zeros. A real
 * answer always carries `clinical.staff_total`, so its absence means "not
 * answered", whatever the zeros say. Stale data from an earlier successful
 * fetch still counts: a failed refresh should not blank a real number.
 */
function clinicalFigures(q: QuerySlice<GovernanceSummary>) {
  const c = q.data?.clinical;
  if (typeof c?.staff_total !== "number") return null;
  return {
    total: c.staff_total,
    verified: c.staff_verified ?? 0,
    pct: c.verification_pct ?? 0,
  };
}

/** Open and total risk-register rows, or null when governance was not answered. */
function riskFigures(q: QuerySlice<GovernanceSummary>) {
  if (clinicalFigures(q) === null) return null;
  const r = q.data?.risk;
  const total = (r?.by_status ?? []).reduce((sum, s) => sum + s.count, 0);
  return { open: r?.open ?? 0, total };
}

function verificationTile(q: QuerySlice<GovernanceSummary>): OverviewTile {
  const f = clinicalFigures(q);
  if (f === null) return unknownTile(q);
  if (f.total === 0) return statTileValue(null, "No clinicians on file");
  return {
    value: formatPercent(f.pct),
    delta: {
      text: `${formatNumber(f.verified)} of ${formatNumber(f.total)} licences verified`,
      direction: f.verified >= f.total ? "up" : "down",
    },
  };
}

function facilitiesTile(q: QuerySlice<FacilityEngagement>): OverviewTile {
  if (!q.data) return unknownTile(q);
  const total = q.data.total_facilities;
  const used = q.data.facilities_with_usage;
  if (total === 0) return statTileValue(null, "No facilities yet");
  return {
    value: formatPercent((used / total) * 100),
    delta: { text: `${formatNumber(used)} of ${formatNumber(total)} with activity`, direction: "flat" },
  };
}

function bpControlTile(q: QuerySlice<ClinicalOutcomes>): OverviewTile {
  if (!q.data) return unknownTile(q);
  const { total, controlled, pct } = q.data.bp_control;
  if (total === 0) return statTileValue(null, "No readings yet");
  return {
    value: formatPercent(pct),
    delta: { text: `${formatNumber(controlled)} of ${formatNumber(total)} controlled`, direction: "flat" },
  };
}

function revenueTile(q: QuerySlice<FinancialSummary>): OverviewTile {
  if (!q.data) return unknownTile(q);
  const byCurrency = q.data.revenue_by_currency;
  // Prefer naira, but if it is the only currency on file print it in its own
  // symbol rather than passing pence or cents off as naira.
  const row = byCurrency.find((r) => r.currency === "NGN") ?? byCurrency[0];
  return {
    value: formatMinor(row?.total_minor ?? 0, row?.currency ?? "NGN"),
    delta: { text: `${formatMinor(q.data.receivables_kobo, "NGN")} receivable`, direction: "flat" },
  };
}

function patientsTile(q: QuerySlice<BusinessSummary>): OverviewTile {
  if (!q.data) return unknownTile(q);
  return {
    value: formatNumber(q.data.total_patients),
    delta: { text: `${formatNumber(q.data.active_patients)} active`, direction: "flat" },
  };
}

function revenue12mTile(q: QuerySlice<InvestorSummary>): OverviewTile {
  if (!q.data) return unknownTile(q);
  const mom = q.data.mom_growth_pct;
  // The RPC reports 0 both for "no change" and for "the prior 30 days had no
  // revenue to compare against", so 0 is shown as neutral, never as growth.
  // The sign is written out because the direction must not rest on colour
  // alone.
  const sign = mom > 0 ? "+" : mom < 0 ? "-" : "";
  const direction = mom > 0 ? "up" : mom < 0 ? "down" : "flat";
  return {
    value: formatMinor(q.data.revenue_12m_minor, "NGN"),
    delta: { text: `${sign}${formatPercent(Math.abs(mom))} MoM`, direction },
  };
}

/** The sentence about the risk register, or "" when there is nothing to say. */
function riskSentence(q: QuerySlice<GovernanceSummary>): string {
  const risk = riskFigures(q);
  if (risk === null) {
    // Only a settled failure is worth a sentence; a pending query is just slow.
    return q.isPending ? "" : "Governance figures could not be loaded.";
  }
  // An empty register means nobody has logged anything, which is not the same
  // as nothing being wrong, so it is said in those words.
  if (risk.total === 0) return "No risks have been logged in the risk register yet.";
  if (risk.open > 0) {
    return `${formatNumber(risk.open)} open risk item${risk.open === 1 ? "" : "s"} still need${risk.open === 1 ? "s" : ""} review.`;
  }
  return "";
}

function bannerCopy({ business, investor, governance }: OverviewInputs): string {
  const parts: string[] = [];
  const mom = investor.data?.mom_growth_pct;
  if (mom !== undefined && mom !== 0) {
    parts.push(`Revenue is ${mom >= 0 ? "up" : "down"} ${formatPercent(Math.abs(mom))} month over month`);
  }
  if (business.data) {
    parts.push(`${formatNumber(business.data.total_patients)} patients on the platform`);
  }
  const clinical = clinicalFigures(governance);
  if (clinical !== null && clinical.total > 0) {
    parts.push(`${formatPercent(clinical.pct)} of clinician licences are verified`);
  }

  const risk = riskSentence(governance);
  if (parts.length === 0) {
    if (risk) return risk;
    // Nothing to say yet. Only call it loading if something still is.
    return [business, investor, governance].some((q) => q.isPending)
      ? "Your latest figures are loading."
      : "Some figures could not be loaded.";
  }
  return `${parts.join(", ")}.${risk ? ` ${risk}` : ""}`;
}

export function buildOverviewSummary(inputs: OverviewInputs): OverviewSummary {
  return {
    banner: bannerCopy(inputs),
    tiles: {
      revenue: revenueTile(inputs.financial),
      patients: patientsTile(inputs.business),
      revenue12m: revenue12mTile(inputs.investor),
      verification: verificationTile(inputs.governance),
      facilities: facilitiesTile(inputs.facilities),
      bpControl: bpControlTile(inputs.outcomes),
    },
  };
}
