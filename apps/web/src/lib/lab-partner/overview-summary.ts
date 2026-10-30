import { formatNumber } from "@/lib/analytics/format";
import { statTileValue, type StatTileValueProps } from "@/components/ui/stat-tile-value";

/**
 * What the lab partner overview shows, worked out apart from the page so the
 * rules can be tested without a database.
 *
 * The page used to read `lab_partner_orders` as `data ?? []`. A failed read
 * then showed "Orders routed to you: 0" and "Awaiting your action: 0, All
 * caught up", which a lab cannot tell from an empty day, so nobody goes to look
 * for the specimens and results waiting on them. Here a figure that did not
 * load is "unknown", and unknown is never shown as zero or as good news.
 *
 * Two counting rules also changed. A sample the lab rejected is finished, as
 * the worklist below already treats it, so it is not "awaiting your action".
 * And "resulted today" compares real instants, not the text of two timestamps.
 */

export interface LabPartnerOrderRow {
  status: string;
  resulted_at: string | null;
}

/** Statuses with nothing left for the lab to do. Matches the worklist's own `done` set. */
const FINISHED_STATUSES = new Set(["resulted", "cancelled", "sample_rejected"]);

const NOT_LOADED = "Could not be loaded";

function tile(value: number | null): StatTileValueProps {
  return statTileValue(value === null ? null : formatNumber(value), NOT_LOADED);
}

function atOrAfter(iso: string | null, since: Date): boolean {
  if (iso === null) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= since.getTime();
}

export interface LabPartnerOverview {
  /** The orders read failed or came back in an unexpected shape. */
  failed: boolean;
  tiles: {
    routed: StatTileValueProps;
    awaiting: {
      tile: StatTileValueProps;
      /** Amber only when there really is something waiting. */
      needsAttention: boolean;
      delta: { text: string; direction: "up" | "down" | "flat" } | undefined;
    };
    resultedToday: StatTileValueProps;
    resultedThisWeek: StatTileValueProps;
  };
}

export function buildLabPartnerOverview(
  reply: { data: unknown; error: unknown },
  todayStart: Date,
  weekStart: Date,
): LabPartnerOverview {
  const rows = !reply.error && Array.isArray(reply.data) ? (reply.data as LabPartnerOrderRow[]) : null;

  if (rows === null) {
    return {
      failed: true,
      tiles: {
        routed: tile(null),
        awaiting: { tile: tile(null), needsAttention: false, delta: undefined },
        resultedToday: tile(null),
        resultedThisWeek: tile(null),
      },
    };
  }

  const awaiting = rows.filter((o) => !FINISHED_STATUSES.has(o.status)).length;
  return {
    failed: false,
    tiles: {
      routed: tile(rows.length),
      awaiting: {
        tile: tile(awaiting),
        needsAttention: awaiting > 0,
        delta:
          awaiting > 0
            ? { text: "Needs a result uploaded", direction: "down" }
            : { text: "All caught up", direction: "up" },
      },
      resultedToday: tile(rows.filter((o) => atOrAfter(o.resulted_at, todayStart)).length),
      resultedThisWeek: tile(rows.filter((o) => atOrAfter(o.resulted_at, weekStart)).length),
    },
  };
}
