import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables } from "@tarragon/shared";
import type { LifecycleKind, LifecycleStage } from "@tarragon/shared";

/**
 * S68 (Module 16, postnatal and child) on the phone: the feed log, the confirmed life-stage events and the delete-what-you-entered request.
 * Mirrors apps/web/src/lib/queries/maternal-child.ts. Every call is a plain RLS-scoped table call or a SECURITY DEFINER function that
 * decides for itself (record_lifecycle_event, request/complete_tracker_deletion). No service role, no new access shape.
 * A caregiver can not use any of it for someone else: the database refuses, and the caller passes only the signed-in person's own id.
 * Seam for S66: when the reusable PrivateSection lock lands, wrap the cards that call these functions with it. No PIN is built here.
 */
export type FeedLogRow = Tables<"breastfeeding_feed_log">;
export interface MyLifecycle { stage: LifecycleStage; stage_since: string | null; content_set: string; bp_rule_set: string | null; baby_content_hidden: boolean }

export function errorKind(code: string | undefined): "not_open" | "unavailable" | "failed" {
  if (code === "55000") return "not_open";
  if (code === "22023") return "unavailable";
  return "failed";
}

export async function loadMyLifecycle(): Promise<MyLifecycle | null> {
  const { data, error } = await supabase.rpc("my_lifecycle");
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as MyLifecycle | null;
}

export async function confirmLifecycleEvent(kind: LifecycleKind, occurredOn: string): Promise<QueryResult<null>> {
  const { error } = await supabase.rpc("record_lifecycle_event", { p_kind: kind, p_occurred_on: occurredOn });
  if (error) return { ok: false, error: errorKind(error.code) };
  return { ok: true, data: null };
}

export async function loadFeedLog(patientId: string): Promise<FeedLogRow[]> {
  const { data } = await supabase.from("breastfeeding_feed_log").select("*").eq("patient_id", patientId).order("fed_at", { ascending: false }).limit(20);
  return data ?? [];
}

export async function logFeed(
  patientId: string,
  organisationId: string,
  input: { feed_type: FeedLogRow["feed_type"]; duration_minutes: number | null; amount_ml: number | null },
): Promise<QueryResult<null>> {
  const { error } = await supabase.from("breastfeeding_feed_log").insert({ patient_id: patientId, organisation_id: organisationId, ...input });
  if (error) return { ok: false, error: errorKind(error.code) };
  return { ok: true, data: null };
}

export async function requestTrackerDeletion(scope: "feed_log" | "baby_checks" | "pregnancy_loss"): Promise<QueryResult<null>> {
  const { error } = await supabase.rpc("request_tracker_deletion", { p_scope: scope });
  if (error) return { ok: false, error: errorKind(error.code) };
  return { ok: true, data: null };
}
