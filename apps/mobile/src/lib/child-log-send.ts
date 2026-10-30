import { lifecycleRules } from "@tarragon/shared";
import { supabase } from "./supabase";
import { getCardPhotoStore, type CardPhotoStore } from "./card-photo-store";
import type { CardPhotoPayload, ChildEventPayload, FeedLogPayload, GrowthPayload, LifecyclePayload } from "./child-log-payloads";
import type { FailureInfo } from "./outbox-rules";

/**
 * Senders for the S68b outbox kinds. Kept out of outbox.ts so that file does not grow another 150 lines. Each returns the same shape as the
 * outbox's own sender: ok, or a failure the outbox classifies (network, auth, retry, rejected, duplicate).
 *
 * Idempotency, kind by kind:
 *   child_event, feed_log, growth   a unique (patient_id, client_id): a replay is 23505, which the outbox counts as sent.
 *   card_photo                      the file path contains the client id (an upload that already exists counts as done) and so does the record.
 *   lifecycle                       the function moves a stage only from the right stage, so a replay says "not available from this stage";
 *                                   if the person is in fact already at the stage this event leads to, that is success, not a rejection.
 *
 * The new tables and columns are not in the generated client types yet (the types are spliced from the live project, which holds other
 * branches' schema, see CLAUDE.md), so the writes go through narrow shapes instead of `any`.
 */
type SendOutcome = { ok: true } | ({ ok: false } & FailureInfo);
interface DbError { code?: string; message?: string; status?: number }
interface UntypedDb {
  from(table: string): { insert(row: Record<string, unknown>): PromiseLike<{ error: DbError | null }> };
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError | null }>;
  storage: {
    from(bucket: string): {
      upload(path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }): PromiseLike<{ error: (DbError & { statusCode?: string | number }) | null }>;
    };
  };
}

function failure(error: DbError): SendOutcome {
  return { ok: false, code: error.code, message: error.message, status: error.status };
}

const db = (): UntypedDb => supabase as unknown as UntypedDb;

export async function sendChildEvent(subjectId: string, clientId: string, recordedAt: string, p: ChildEventPayload): Promise<SendOutcome> {
  const { error } = await db().from("child_daily_events").insert({
    organisation_id: p.organisation_id,
    patient_id: subjectId,
    client_id: clientId,
    kind: p.kind,
    feed_type: p.feed_type,
    occurred_at: p.occurred_at,
    client_recorded_at: recordedAt,
    logged_by_label: p.logged_by_label,
  });
  return error ? failure(error) : { ok: true };
}

export async function sendFeedLog(subjectId: string, clientId: string, p: FeedLogPayload): Promise<SendOutcome> {
  const { error } = await db().from("breastfeeding_feed_log").insert({
    organisation_id: p.organisation_id,
    patient_id: subjectId,
    client_id: clientId,
    feed_type: p.feed_type,
    duration_minutes: p.duration_minutes,
    amount_ml: p.amount_ml,
    fed_at: p.fed_at,
    child_profile_id: p.child_profile_id,
    logged_by_label: p.logged_by_label,
  });
  return error ? failure(error) : { ok: true };
}

export async function sendGrowth(subjectId: string, clientId: string, p: GrowthPayload): Promise<SendOutcome> {
  const { error } = await db().from("child_growth_measurements").insert({
    organisation_id: p.organisation_id,
    patient_id: subjectId,
    client_id: clientId,
    measured_at: p.measured_at,
    weight_kg: p.weight_kg,
    height_cm: p.height_cm,
    head_circumference_cm: p.head_circumference_cm,
    muac_mm: p.muac_mm,
    measure_position: p.measure_position,
    bilateral_oedema: p.bilateral_oedema,
    logged_by_label: p.logged_by_label,
  });
  return error ? failure(error) : { ok: true };
}

export async function sendLifecycle(p: LifecyclePayload): Promise<SendOutcome> {
  const { error } = await db().rpc("record_lifecycle_event", { p_kind: p.kind, p_occurred_on: p.occurred_on });
  if (!error) return { ok: true };
  if (error.code === "22023") {
    // A replay after a lost reply: the stage has already moved. If the person is where this event leads, it is done.
    const target = lifecycleRules().rules.transitions[p.kind]?.to;
    const { data, error: readError } = await db().rpc("my_lifecycle");
    const row = Array.isArray(data) ? data[0] : data;
    const stage = row && typeof row === "object" ? (row as { stage?: unknown }).stage : undefined;
    if (!readError && target && stage === target) return { ok: true };
  }
  return failure(error);
}

export function cardPhotoPath(ownerUserId: string, childId: string, clientId: string): string {
  return `${ownerUserId}/${childId}/${clientId}.jpg`;
}

export async function sendCardPhoto(
  ownerUserId: string,
  subjectId: string,
  clientId: string,
  p: CardPhotoPayload,
  store: CardPhotoStore = getCardPhotoStore(),
): Promise<SendOutcome> {
  const bytes = await store.load(p.file_uri);
  // The file is gone (cleared by the phone): this entry can never succeed. 22023 is a refusal the outbox shows as rejected, not a silent drop.
  if (!bytes) return { ok: false, code: "22023", message: "The photo is no longer on this phone" };
  const path = cardPhotoPath(ownerUserId, subjectId, clientId);
  // ROW FIRST, FILE SECOND. The first version uploaded and then inserted, so a failed insert left a file in the private bucket that no row points at.
  // Now the row (file_state 'pending_upload') comes first; an upload that fails leaves a row that says the file is not there yet, never an orphan file,
  // and the outbox retries the whole entry: the insert is a duplicate (23505, fine), the upload runs again, then the server confirms the file exists.
  const { error } = await db().from("child_card_photos").insert({
    organisation_id: p.organisation_id,
    patient_id: subjectId,
    client_id: clientId,
    storage_path: path,
    size_bytes: bytes.length,
    logged_by_label: p.logged_by_label,
  });
  if (error && error.code !== "23505") return failure(error);
  const up = await db().storage.from("child-card-photos").upload(path, bytes, { contentType: "image/jpeg", upsert: false });
  if (up.error) {
    const exists = /already exists|duplicate/i.test(up.error.message ?? "") || String(up.error.statusCode) === "409";
    if (!exists) return failure({ code: undefined, message: up.error.message, status: Number.isFinite(Number(up.error.statusCode)) ? Number(up.error.statusCode) : undefined });
  }
  // The server checks the object is really there before it marks the row uploaded (55000 = not yet: the outbox retries).
  const confirmed = await db().rpc("confirm_child_card_photo_uploaded", { p_child: subjectId, p_client_id: clientId });
  if (confirmed.error) return failure(confirmed.error);
  await store.remove(p.file_uri);
  return { ok: true };
}
