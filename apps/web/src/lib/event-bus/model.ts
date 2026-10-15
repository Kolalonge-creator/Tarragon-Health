import { t, type Locale } from "@tarragon/i18n";

/** Pure helpers for the event bus operations screens (S10x). No database, no React. */

export const DELIVERY_STATUSES = ["pending", "processing", "done", "dead"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface BusFilters {
  status: DeliveryStatus | null;
  subscriber: string | null;
  eventType: string | null;
  /** Keyset cursor: show deliveries created before this instant. */
  before: string | null;
  /** Second half of the cursor: deliveries from one fan-out share a timestamp, so the id breaks the tie. */
  beforeId: string | null;
}

const KEY = /^[a-z][a-z0-9_.]{0,119}$/;

/** Reads the address query. Anything that is not exactly a known shape is dropped, never passed on to the database. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseFilters(raw: { status?: string; subscriber?: string; type?: string; before?: string; beforeId?: string }): BusFilters {
  const status = (DELIVERY_STATUSES as readonly string[]).includes(raw.status ?? "") ? (raw.status as DeliveryStatus) : null;
  const subscriber = raw.subscriber && KEY.test(raw.subscriber) ? raw.subscriber : null;
  const eventType = raw.type && KEY.test(raw.type) ? raw.type : null;
  // Kept as the database wrote it (microseconds): rounding to milliseconds would skip rows in the same millisecond.
  const before = raw.before && TIMESTAMP.test(raw.before) && !Number.isNaN(new Date(raw.before).getTime()) ? raw.before : null;
  const beforeId = before && raw.beforeId && UUID.test(raw.beforeId) ? raw.beforeId : null;
  return { status, subscriber, eventType, before, beforeId };
}

export function filtersToQuery(f: Partial<BusFilters>): string {
  const q = new URLSearchParams();
  if (f.status) q.set("status", f.status);
  if (f.subscriber) q.set("subscriber", f.subscriber);
  if (f.eventType) q.set("type", f.eventType);
  if (f.before) q.set("before", f.before);
  if (f.before && f.beforeId) q.set("beforeId", f.beforeId);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function formatAge(seconds: number, locale: Locale): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return t("busops.age.seconds", locale, { n: s });
  if (s < 5400) return t("busops.age.minutes", locale, { n: Math.round(s / 60) });
  if (s < 129600) return t("busops.age.hours", locale, { n: Math.round(s / 3600) });
  return t("busops.age.days", locale, { n: Math.round(s / 86400) });
}

export interface SubscriberRow {
  subscriber_key: string;
  is_active: boolean;
  pending: number;
  processing: number;
  dead: number;
  lag_incident_open: boolean;
}

export interface BusSummary {
  waiting: number;
  dead: number;
  lagging: number;
}

/** Only active subscribers count: a switched-off subscriber's backlog is deliberate. */
export function summarise(rows: readonly SubscriberRow[]): BusSummary {
  let waiting = 0;
  let dead = 0;
  let lagging = 0;
  for (const r of rows) {
    dead += Number(r.dead);
    if (!r.is_active) continue;
    waiting += Number(r.pending) + Number(r.processing);
    if (r.lag_incident_open) lagging += 1;
  }
  return { waiting, dead, lagging };
}

export type Tone = "green" | "amber" | "red";

export function summaryTone(s: BusSummary): Tone {
  if (s.dead > 0 || s.lagging > 0) return "red";
  if (s.waiting > 0) return "amber";
  return "green";
}

/** Ids only: the database already filtered the payload; this just makes it readable. */
export function formatIds(ids: unknown): string {
  if (!ids || typeof ids !== "object") return "";
  return Object.entries(ids as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(", ");
}
