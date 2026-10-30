import type { ChildEventKind, ChildFeedType, LifecycleKind } from "@tarragon/shared";

/**
 * Payloads the offline outbox sends for the daily child log and for the S68 writes that used to be online-only (S68b). Plain data, no I/O.
 * Every one is idempotent by the outbox client id (a unique key on the table, or a state check for the life-stage change), so a replay after
 * a lost reply is a duplicate, never a second record.
 */

/** One tap on the daily log: a feed, sleep start or stop, a wet or dirty nappy. Written to child_daily_events for the CHILD (subject). */
export interface ChildEventPayload {
  kind: ChildEventKind;
  feed_type: ChildFeedType | null;
  /** When it happened, ISO. */
  occurred_at: string;
  /** A name tag for the family ("Mum", "Aunty"). Not an account. */
  logged_by_label: string | null;
  organisation_id: string;
}

/** The mother's own feed log (breastfeeding_feed_log), written for her (subject = herself). */
export interface FeedLogPayload {
  feed_type: "breast_left" | "breast_right" | "both_breasts" | "expressed_milk" | "formula" | "other";
  duration_minutes: number | null;
  amount_ml: number | null;
  fed_at: string;
  child_profile_id: string | null;
  logged_by_label: string | null;
  organisation_id: string;
}

/** A weight and/or height for the CHILD (subject). The z-scores are computed by the database from the versioned WHO reference, never by the phone. */
export interface GrowthPayload {
  measured_at: string;
  weight_kg: number | null;
  height_cm: number | null;
  head_circumference_cm: number | null;
  muac_mm: number | null;
  measure_position: "recumbent" | "standing" | null;
  bilateral_oedema: boolean;
  logged_by_label: string | null;
  organisation_id: string;
}

/**
 * A confirmed life-stage event dated on the day the person confirmed it. A pregnancy LOSS is never queued: it is the most sensitive thing in this
 * module and must not sit in a queue on a shared phone, so it stays an online-only action (the type below cannot hold it).
 */
export type QueueableLifecycleKind = Exclude<LifecycleKind, "pregnancy_loss_recorded">;
export interface LifecyclePayload {
  kind: QueueableLifecycleKind;
  occurred_on: string;
}

/** The compressed card photo is a file in the app's own folder; only its location and size are in the queue. */
export interface CardPhotoPayload {
  file_uri: string;
  size_bytes: number;
  logged_by_label: string | null;
  organisation_id: string;
}

export const LOSS_KIND: LifecycleKind = "pregnancy_loss_recorded";
export function isQueueableLifecycleKind(kind: LifecycleKind): kind is QueueableLifecycleKind {
  return kind !== LOSS_KIND;
}
