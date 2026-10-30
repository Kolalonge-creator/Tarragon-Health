import { CHILD_EVENT_KINDS, pairSleep, withoutCorrected, type ChildEvent, type ChildEventKind } from "./daily-events";
import { childLogSettings } from "./settings";

/**
 * The per-child timeline (S68b): newest first, ONE LINE per event, built from the child's own records only. It is the screen a second caregiver
 * and a shared phone can see, so it has a closed list of what may appear in it (SHARED_TIMELINE_KINDS). The mother's mood checks, her loss notes,
 * her cycle and pregnancy records, and any message are not in the list and are dropped even if a caller passes them.
 */
export const SHARED_TIMELINE_KINDS = [...CHILD_EVENT_KINDS, "growth", "vaccine"] as const;
export type SharedTimelineKind = (typeof SHARED_TIMELINE_KINDS)[number];

export interface TimelineGrowthInput {
  readonly id: string;
  readonly measuredAt: string;
  readonly weightKg: number | null;
  readonly heightCm: number | null;
}

export interface TimelineVaccineInput {
  readonly id: string;
  readonly name: string;
  readonly doseNumber: number;
  /** YYYY-MM-DD. */
  readonly dateAdministered: string;
  /** A real review record or nothing. Both must be present for the line to say a care team member checked the dose. */
  readonly verifiedBy: string | null;
  readonly verifiedAt: string | null;
}

export interface TimelineItem {
  readonly id: string;
  readonly kind: SharedTimelineKind;
  readonly at: string;
  readonly loggedBy: string | null;
  readonly pendingOnPhone: boolean;
  /** Only for kinds that have a number to show. kg and cm; whole minutes for a finished sleep. */
  readonly weightKg?: number | null;
  readonly heightCm?: number | null;
  readonly feedType?: ChildEvent["feedType"];
  readonly sleepMinutes?: number | null;
  readonly vaccineName?: string;
  readonly doseNumber?: number;
  /** Set ONLY when verified_by and verified_at both exist on the record. The screen then shows the attribution line; otherwise it shows nothing. */
  readonly reviewedAt?: string;
}

/** Null-gated, like ReviewedByDoctor: no reviewer and a review time together means no attribution at all. Never a default. */
export function reviewedAttribution(verifiedBy: string | null, verifiedAt: string | null): { reviewedAt: string } | null {
  return verifiedBy && verifiedAt ? { reviewedAt: verifiedAt } : null;
}

export function isSharedKind(kind: string): kind is SharedTimelineKind {
  return (SHARED_TIMELINE_KINDS as readonly string[]).includes(kind);
}

export function buildChildTimeline(input: {
  readonly events: readonly ChildEvent[];
  readonly growth: readonly TimelineGrowthInput[];
  readonly vaccines: readonly TimelineVaccineInput[];
  readonly limit?: number;
}): TimelineItem[] {
  const live = withoutCorrected(input.events).filter((e) => isSharedKind(e.kind));
  const spans = new Map(pairSleep(live).map((s) => [s.startId, s.minutes]));
  const items: TimelineItem[] = [
    ...live.map(
      (e): TimelineItem => ({
        id: e.id,
        kind: e.kind as ChildEventKind,
        at: e.occurredAt,
        loggedBy: e.loggedBy,
        pendingOnPhone: e.pendingOnPhone,
        feedType: e.feedType,
        sleepMinutes: e.kind === "sleep_start" ? (spans.get(e.id) ?? null) : null,
      }),
    ),
    ...input.growth.map(
      (g): TimelineItem => ({ id: g.id, kind: "growth", at: g.measuredAt, loggedBy: null, pendingOnPhone: false, weightKg: g.weightKg, heightCm: g.heightCm }),
    ),
    ...input.vaccines.map((v): TimelineItem => {
      const review = reviewedAttribution(v.verifiedBy, v.verifiedAt);
      return {
        id: v.id,
        kind: "vaccine",
        at: `${v.dateAdministered.slice(0, 10)}T12:00:00.000Z`,
        loggedBy: null,
        pendingOnPhone: false,
        vaccineName: v.name,
        doseNumber: v.doseNumber,
        ...(review ?? {}),
      };
    }),
  ];
  const limit = input.limit ?? childLogSettings().settings.timeline_limit;
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id)).slice(0, limit);
}
