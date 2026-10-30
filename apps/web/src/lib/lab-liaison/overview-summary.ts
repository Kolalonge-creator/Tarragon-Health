import { formatNumber } from "@/lib/analytics/format";
import { statTileValue, type StatTileValueProps } from "@/components/ui/stat-tile-value";

/**
 * What the lab liaison overview shows, worked out apart from the page so the
 * rules can be tested without a database.
 *
 * Why it exists. The page used to read every count as `count ?? 0` and every
 * list as `data ?? []`. Supabase answers a failed query with `{ data: null,
 * error }`, so a dropped connection or a policy error turned into zeros, an
 * empty feed and, worst of all, an "Awaiting clinician review" tile reading
 * "All caught up" while results sat unreviewed. A liaison cannot tell that
 * from a genuinely quiet day, so nobody goes looking. Here a figure that did
 * not load is "unknown", and unknown is never shown as zero or as good news.
 */

/** The part of a Supabase `count: "exact"` response this needs. */
export interface CountResult {
  count: number | null;
  error: unknown;
}

/** The part of a Supabase list response this needs. */
export interface ListResult {
  error: unknown;
}

/** A count we can trust, or null when the query failed or returned no count. */
export function readCount(result: CountResult): number | null {
  if (result.error) return null;
  return typeof result.count === "number" ? result.count : null;
}

const NOT_LOADED = "Could not be loaded";

function countTile(count: number | null): StatTileValueProps {
  return statTileValue(count === null ? null : formatNumber(count), NOT_LOADED);
}

export interface LiaisonSummaryInputs {
  patientCount: CountResult;
  uploadedToday: CountResult;
  uploadedThisWeek: CountResult;
  awaitingReview: CountResult;
  patientList: ListResult;
  recentFeed: ListResult;
  /** True when the held-uploads RPC errored or returned rows that did not parse. */
  heldFailed: boolean;
}

export interface LiaisonSummary {
  tiles: {
    patients: StatTileValueProps;
    today: StatTileValueProps;
    thisWeek: StatTileValueProps;
    awaiting: {
      tile: StatTileValueProps;
      /** Amber only when there really is something waiting. */
      needsAttention: boolean;
      delta: { text: string; direction: "up" | "down" | "flat" } | undefined;
    };
  };
  /** The patient picker could not be read, so "no patients yet" would be untrue. */
  patientListFailed: boolean;
  recentFeedFailed: boolean;
  heldFailed: boolean;
  /** At least one tile could not be filled in. */
  anyCountFailed: boolean;
}

export function buildLiaisonSummary(inputs: LiaisonSummaryInputs): LiaisonSummary {
  const patients = readCount(inputs.patientCount);
  const today = readCount(inputs.uploadedToday);
  const thisWeek = readCount(inputs.uploadedThisWeek);
  const awaiting = readCount(inputs.awaitingReview);

  let awaitingDelta: LiaisonSummary["tiles"]["awaiting"]["delta"];
  if (awaiting === null) awaitingDelta = undefined;
  else if (awaiting > 0) awaitingDelta = { text: "Across your organisation", direction: "down" };
  else awaitingDelta = { text: "All caught up", direction: "up" };

  return {
    tiles: {
      patients: countTile(patients),
      today: countTile(today),
      thisWeek: countTile(thisWeek),
      awaiting: {
        tile: countTile(awaiting),
        needsAttention: awaiting !== null && awaiting > 0,
        delta: awaitingDelta,
      },
    },
    patientListFailed: Boolean(inputs.patientList.error),
    recentFeedFailed: Boolean(inputs.recentFeed.error),
    heldFailed: inputs.heldFailed,
    anyCountFailed: [patients, today, thisWeek, awaiting].some((n) => n === null),
  };
}
