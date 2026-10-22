import AsyncStorage from "@react-native-async-storage/async-storage";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import {
  childChoices,
  childEventsFromRows,
  childLogSettings,
  cleanCaregiverLabel,
  mayLog,
  mergePending,
  type ChildChoice,
  type ChildEventKind,
  type ChildEventRow,
  type ChildFeedType,
  type LifecycleKind,
  type ScheduleCatalogRow,
  type ScheduleRecordRow,
} from "@tarragon/shared";
import { enqueue, flushOutbox, listOutbox, removePendingRow } from "./outbox";
import { supabase } from "./supabase";
import { defaultCardPhotoStore, type CardPhotoStore } from "./card-photo-store";
import { preparePhoto } from "./written-questions/photo-prepare";
import { resizeTarget } from "./written-questions/photo-resize";
import {
  isQueueableLifecycleKind,
  type CardPhotoPayload,
  type ChildEventPayload,
  type FeedLogPayload,
  type GrowthPayload,
  type LifecyclePayload,
} from "./child-log-payloads";
import type { QueryResult } from "./medications";

/**
 * The daily child log on the phone (S68b). Everything a person TAPS is written to the one offline outbox first (durable on the phone before any
 * network call), then a flush is tried at once. The screen says one of four things about that: sent, saved on this phone, not open yet, or failed.
 * Entries are append-only; nothing here edits or deletes a record. A caregiver LABEL is a name tag on the entry, not an account.
 *
 * Shared phones: the child picker's answer is kept in memory only, so it is asked again every time the app starts. The last label typed is
 * remembered on the device as a convenience and can be cleared.
 */
export interface ChildDetail extends ChildChoice {
  dateOfBirth: string | null;
  sex: "male" | "female" | null;
  organisationId: string | null;
}

export type TapOutcome = "sent" | "on_phone" | "not_open" | "failed" | "view_only";

// ---- who the phone is looking after ---------------------------------------------------------------------------------------------

/** The children this account looks after. A failed read is NULL, never an empty list: "could not load" must not read as "no children". */
export async function loadChildren(userId: string): Promise<ChildDetail[] | null> {
  const { data, error } = await supabase
    .from("profile_access")
    .select("permission_level, profile:profiles!profile_access_profile_id_fkey(id, full_name, is_dependent_account, dependent_kind, organisation_id, date_of_birth, sex)")
    .eq("grantee_user_id", userId);
  if (error || !data) return null;
  const rows = data.flatMap((row) => (row.profile ? [{ level: row.permission_level, p: row.profile }] : []));
  const choices = childChoices(
    rows.map(({ level, p }) => ({ profileId: p.id, fullName: p.full_name, permissionLevel: level, isDependentAccount: p.is_dependent_account === true, dependentKind: p.dependent_kind })),
  );
  return choices.map((c) => {
    const p = rows.find((r) => r.p.id === c.profileId)?.p;
    const sex = p?.sex === "male" || p?.sex === "female" ? p.sex : null;
    return { ...c, dateOfBirth: p?.date_of_birth ?? null, sex, organisationId: p?.organisation_id ?? null };
  });
}

let chosenThisSession: string | null = null;
export const getSessionChild = (): string | null => chosenThisSession;
export const setSessionChild = (id: string | null): void => {
  chosenThisSession = id;
};

/** Keyed per signed-in account: on a shared phone one person's name tag is never offered to the next. */
const labelKey = (userId: string) => `tarragon.childlog.label.v1.${userId}`;
export async function loadLastLabel(userId: string): Promise<string> {
  try {
    return (await AsyncStorage.getItem(labelKey(userId))) ?? "";
  } catch {
    return "";
  }
}
export async function saveLastLabel(userId: string, label: string): Promise<void> {
  try {
    const clean = cleanCaregiverLabel(label);
    if (clean) await AsyncStorage.setItem(labelKey(userId), clean);
    else await AsyncStorage.removeItem(labelKey(userId));
  } catch {
    /* a convenience only */
  }
}

// ---- writing: outbox first, then a flush ----------------------------------------------------------------------------------------

/** After a flush: is the entry gone (sent), still on the phone, or refused because the feature is not open? A not-open entry is withdrawn, not queued forever. */
async function settle(clientId: string): Promise<TapOutcome> {
  try {
    await flushOutbox();
  } catch {
    /* the entry is durable either way */
  }
  const left = (await listOutbox()).find((i) => i.clientId === clientId);
  if (!left) return "sent";
  if (left.lastError && /not open yet/i.test(left.lastError)) {
    await removePendingRow(clientId);
    return "not_open";
  }
  return "on_phone";
}

/** Anything that throws (not signed in, a full disk) is "failed": the person is told and nothing is shown as saved. */
async function safely(run: () => Promise<TapOutcome>): Promise<TapOutcome> {
  try {
    return await run();
  } catch {
    return "failed";
  }
}

export function tapChildEvent(child: ChildDetail, kind: ChildEventKind, feedType: ChildFeedType | null, labelRaw: string, nowMs: number = Date.now()): Promise<TapOutcome> {
  return safely(async () => {
    if (!mayLog(child)) return "view_only";
    if (!child.organisationId) return "failed";
    const payload: ChildEventPayload = {
      kind,
      feed_type: kind === "feed" ? (feedType ?? "other") : null,
      occurred_at: new Date(nowMs).toISOString(),
      logged_by_label: cleanCaregiverLabel(labelRaw),
      organisation_id: child.organisationId,
    };
    const item = await enqueue({ kind: "child_event", subjectId: child.profileId, payload, recordedAt: payload.occurred_at });
    return settle(item.clientId);
  });
}

export interface GrowthInput {
  weightKg: number | null;
  heightCm: number | null;
  headCircumferenceCm?: number | null;
  muacMm?: number | null;
  measurePosition?: "recumbent" | "standing" | null;
  bilateralOedema?: boolean;
}

export function logChildGrowth(child: ChildDetail, input: GrowthInput, labelRaw: string, nowMs: number = Date.now()): Promise<TapOutcome> {
  return safely(async () => {
    if (!mayLog(child)) return "view_only";
    if (!child.organisationId) return "failed";
    if (input.weightKg === null && input.heightCm === null && !input.muacMm && !input.headCircumferenceCm) return "failed";
    const payload: GrowthPayload = {
      measured_at: new Date(nowMs).toISOString(),
      weight_kg: input.weightKg,
      height_cm: input.heightCm,
      head_circumference_cm: input.headCircumferenceCm ?? null,
      muac_mm: input.muacMm ?? null,
      measure_position: input.measurePosition ?? null,
      bilateral_oedema: input.bilateralOedema === true,
      logged_by_label: cleanCaregiverLabel(labelRaw),
      organisation_id: child.organisationId,
    };
    const item = await enqueue({ kind: "growth", subjectId: child.profileId, payload, recordedAt: payload.measured_at });
    return settle(item.clientId);
  });
}

/** The mother's own feed log. Queued like every other write; her own id is the subject. */
export function queueMotherFeed(motherId: string, organisationId: string, input: { feed_type: FeedLogPayload["feed_type"]; duration_minutes: number | null; amount_ml: number | null }, nowMs: number = Date.now()): Promise<TapOutcome> {
  return safely(async () => {
    const payload: FeedLogPayload = { ...input, fed_at: new Date(nowMs).toISOString(), child_profile_id: null, logged_by_label: null, organisation_id: organisationId };
    const item = await enqueue({ kind: "feed_log", subjectId: motherId, payload, recordedAt: payload.fed_at });
    return settle(item.clientId);
  });
}

/** A confirmed life-stage event. A pregnancy loss is never queued: it stays an online-only action (see child-log-payloads.ts). */
export function queueLifecycle(motherId: string, kind: LifecycleKind, occurredOn: string): Promise<TapOutcome> {
  return safely(async () => {
    if (!isQueueableLifecycleKind(kind)) return "failed";
    const payload: LifecyclePayload = { kind, occurred_on: occurredOn };
    const item = await enqueue({ kind: "lifecycle", subjectId: motherId, payload });
    return settle(item.clientId);
  });
}

// ---- the paper card photo ------------------------------------------------------------------------------------------------------

export interface CapturedPhoto {
  uri: string;
  width: number | null;
  height: number | null;
}
export interface CardPhotoDeps {
  capture(): Promise<CapturedPhoto | null>;
  /** Resizes and re-encodes as JPEG at the configured size and quality; returns the new file's uri. */
  resize(uri: string, width: number | null, height: number | null): Promise<string>;
  read(uri: string): Promise<Uint8Array>;
  store: CardPhotoStore;
}

async function resizeForCard(uri: string, width: number | null, height: number | null): Promise<string> {
  const { settings } = childLogSettings();
  const context = ImageManipulator.manipulate(uri);
  try {
    const target = resizeTarget(width, height, settings.card_photo_max_edge_px);
    if (target) context.resize(target);
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: settings.card_photo_jpeg_quality });
    return saved.uri;
  } finally {
    context.release();
  }
}

const defaultCardDeps: CardPhotoDeps = {
  async capture() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return null;
    const picked = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], allowsEditing: false, exif: false, quality: 1 });
    if (picked.canceled || !picked.assets[0]) return null;
    const a = picked.assets[0];
    return { uri: a.uri, width: a.width ?? null, height: a.height ?? null };
  },
  resize: resizeForCard,
  read: async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer()),
  store: defaultCardPhotoStore,
};

export type CardPhotoOutcome = TapOutcome | "cancelled" | "unusable";

/**
 * Take a photo of the paper card, make it small on the device (longest side and JPEG quality from `child_log.settings`, location data stripped),
 * keep the file in the app's own folder and queue it. No QR code and no reading of the picture: a care team member looks at it.
 */
export async function takeCardPhoto(child: ChildDetail, labelRaw: string, deps: CardPhotoDeps = defaultCardDeps): Promise<CardPhotoOutcome> {
  try {
    if (!mayLog(child)) return "view_only";
    if (!child.organisationId) return "failed";
    const shot = await deps.capture();
    if (!shot) return "cancelled";
    const { settings } = childLogSettings();
    const bytes = await preparePhoto(shot.uri, shot.width, shot.height, settings.card_photo_max_bytes, { resize: deps.resize, read: deps.read });
    if (!bytes) return "unusable";
    const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.jpg`;
    const uri = await deps.store.save(name, bytes);
    const payload: CardPhotoPayload = { file_uri: uri, size_bytes: bytes.length, logged_by_label: cleanCaregiverLabel(labelRaw), organisation_id: child.organisationId };
    try {
      const item = await enqueue({ kind: "card_photo", subjectId: child.profileId, payload });
      const outcome = await settle(item.clientId);
      // The entry was withdrawn ("not open yet"): its file must not stay on the phone.
      if (outcome === "not_open") await deps.store.remove(uri);
      return outcome;
    } catch (error) {
      await deps.store.remove(uri);
      throw error;
    }
  } catch {
    return "failed";
  }
}

// ---- reading -------------------------------------------------------------------------------------------------------------------

interface UntypedRead {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): { order(column: string, o: { ascending: boolean }): { limit(n: number): PromiseLike<{ data: unknown; error: { message?: string } | null }> } };
    };
  };
}

/** The child's log from the server, merged with taps still waiting on this phone (marked so the screen can badge them). */
export async function loadChildEvents(childId: string): Promise<QueryResult<ChildEventRow[]>> {
  const { settings } = childLogSettings();
  const { data, error } = await (supabase as unknown as UntypedRead)
    .from("child_daily_events")
    .select("id, kind, feed_type, occurred_at, logged_by_label, corrects_id, client_id")
    .eq("patient_id", childId)
    .order("occurred_at", { ascending: false })
    .limit(settings.timeline_limit);
  const pending = await pendingChildEvents(childId);
  if (error) return pending.length > 0 ? { ok: true, data: pending } : { ok: false, error: "failed" };
  return { ok: true, data: mergePending(childEventsFromRows(data), pending) };
}

export async function pendingChildEvents(childId: string): Promise<ChildEventRow[]> {
  const items = await listOutbox("child_event");
  return items
    .filter((i) => i.subjectId === childId && i.state === "pending")
    .map((i) => {
      const p = i.payload as ChildEventPayload;
      return { id: i.clientId, kind: p.kind, occurredAt: p.occurred_at, feedType: p.feed_type, loggedBy: p.logged_by_label, correctsId: null, pendingOnPhone: true, clientId: i.clientId };
    });
}

export async function countPendingForChild(childId: string): Promise<number> {
  const items = await listOutbox();
  return items.filter((i) => i.subjectId === childId && (i.kind === "child_event" || i.kind === "growth" || i.kind === "card_photo")).length;
}

export interface GrowthRow {
  id: string;
  measuredAt: string;
  weightKg: number | null;
  heightCm: number | null;
  weightForAgeZ: number | null;
  heightForAgeZ: number | null;
  weightForHeightZ: number | null;
  nutritionClass: "severe_acute" | "moderate_acute" | "none" | null;
  implausible: boolean;
  referenceVersion: string | null;
}

export async function loadChildGrowth(childId: string): Promise<QueryResult<GrowthRow[]>> {
  const { data, error } = await supabase
    .from("child_growth_measurements")
    .select("id, measured_at, weight_kg, height_cm, weight_for_age_z, height_for_age_z, weight_for_height_z, nutrition_class, plausibility_flags, reference_version")
    .eq("patient_id", childId)
    .order("measured_at", { ascending: true });
  if (error || !data) return { ok: false, error: "failed" };
  return {
    ok: true,
    data: data.map((r) => ({
      id: r.id,
      measuredAt: r.measured_at,
      weightKg: r.weight_kg,
      heightCm: r.height_cm,
      weightForAgeZ: r.weight_for_age_z,
      heightForAgeZ: r.height_for_age_z,
      weightForHeightZ: r.weight_for_height_z,
      nutritionClass: r.nutrition_class === "severe_acute" || r.nutrition_class === "moderate_acute" || r.nutrition_class === "none" ? r.nutrition_class : null,
      implausible: Array.isArray(r.plausibility_flags) && r.plausibility_flags.length > 0,
      referenceVersion: r.reference_version,
    })),
  };
}

export interface ChildVaccineData {
  catalog: ScheduleCatalogRow[];
  records: (ScheduleRecordRow & { id: string; verifiedBy: string | null; verifiedAt: string | null })[];
}

export async function loadChildVaccines(childId: string): Promise<QueryResult<ChildVaccineData>> {
  const [catalog, records] = await Promise.all([
    supabase.from("vaccination_catalog").select("id, code, name, recommended_age").eq("is_active", true).like("code", "child_%"),
    supabase.from("vaccination_records").select("id, vaccination_catalog_id, dose_number, date_administered, verification_status, verified_by, verified_at").eq("profile_id", childId),
  ]);
  if (catalog.error || records.error || !catalog.data || !records.data) return { ok: false, error: "failed" };
  return {
    ok: true,
    data: {
      catalog: catalog.data,
      records: records.data.map((r) => ({
        id: r.id,
        vaccination_catalog_id: r.vaccination_catalog_id,
        dose_number: r.dose_number,
        date_administered: r.date_administered,
        verification_status: r.verification_status,
        verifiedBy: r.verified_by,
        verifiedAt: r.verified_at,
      })),
    },
  };
}
