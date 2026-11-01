import { formatNumber, formatPercent } from "./format";
import { clinicalFigures, riskFigures, type OverviewInputs } from "./overview-summary";

/**
 * What stands out on the analytics Overview, worked out apart from React.
 *
 * Only facts the page already holds are used, and no target is invented: an
 * open risk item, a licence that is not verified, revenue lower than the month
 * before, a facility with no activity. Order is most serious first.
 *
 * The rule is the same as the tiles: a source that did not load is not a source
 * that said "fine". If any source failed, the view never says "clear"; it says
 * it could not check, or (when something did stand out) that the list may be
 * incomplete. A source still loading is just slow and is waited for.
 */

export interface StandoutItem {
  key: "risk" | "licences" | "revenue" | "facilities";
  href: string;
  text: string;
}

export type StandoutView =
  | { kind: "loading" }
  | { kind: "unknown" }
  | { kind: "clear" }
  | { kind: "items"; top: StandoutItem; rest: StandoutItem[]; incomplete: boolean };

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export function standoutView(
  inputs: Pick<OverviewInputs, "governance" | "investor" | "facilities">
): StandoutView {
  const { governance, investor, facilities } = inputs;
  const items: StandoutItem[] = [];

  const risk = riskFigures(governance);
  if (risk !== null && risk.open > 0) {
    items.push({
      key: "risk",
      href: "/analytics/governance",
      text: `${plural(risk.open, "open risk item needs", "open risk items need")} review`,
    });
  }

  const clinical = clinicalFigures(governance);
  if (clinical !== null && clinical.total > 0 && clinical.verified < clinical.total) {
    items.push({
      key: "licences",
      href: "/analytics/governance",
      text: `${plural(clinical.total - clinical.verified, "clinician licence is", "clinician licences are")} not verified (${formatPercent(clinical.pct)} verified)`,
    });
  }

  const mom = investor.data?.mom_growth_pct;
  if (mom !== undefined && mom < 0) {
    items.push({
      key: "revenue",
      href: "/analytics/investor",
      text: `Revenue is down ${formatPercent(Math.abs(mom))} month over month`,
    });
  }

  const f = facilities.data;
  if (f && f.total_facilities > 0 && f.facilities_with_usage < f.total_facilities) {
    items.push({
      key: "facilities",
      href: "/analytics/facilities",
      text: `${plural(f.total_facilities - f.facilities_with_usage, "facility has", "facilities have")} no activity`,
    });
  }

  const sources = [
    { known: clinical !== null, pending: governance.isLoading },
    { known: investor.data !== undefined, pending: investor.isLoading },
    { known: f !== undefined, pending: facilities.isLoading },
  ];
  const failed = sources.some((s) => !s.known && !s.pending);
  const waiting = sources.some((s) => !s.known && s.pending);

  if (items.length > 0) {
    const [top, ...rest] = items;
    return { kind: "items", top, rest, incomplete: failed };
  }
  if (failed) return { kind: "unknown" };
  if (waiting) return { kind: "loading" };
  return { kind: "clear" };
}
