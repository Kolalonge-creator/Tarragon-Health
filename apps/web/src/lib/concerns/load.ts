import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import {
  inboxRowsSchema,
  myConcernsSchema,
  readerRowsSchema,
  retaliationRowsSchema,
  staffRowsSchema,
  type InboxRow,
  type MyConcern,
  type ReaderRow,
  type RetaliationRow,
  type StaffRow,
} from "./model";

export type Loaded<T> = { ok: true; data: T } | { ok: false; denied: boolean };
const fail = (error: { code?: string }): { ok: false; denied: boolean } => ({ ok: false, denied: error.code === "42501" });

/**
 * A failed read is a load failure and the screen says so; it is never shown as "no concerns". Nothing is logged here:
 * a thrown or returned error carries no concern text and none is written anywhere (INV-07).
 */
export async function loadInbox(): Promise<Loaded<InboxRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("safety_concern_inbox", {});
  if (error) return fail(error);
  const parsed = inboxRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

export async function loadMyConcerns(): Promise<Loaded<MyConcern[]>> {
  const { data, error } = await loose(await createClient()).rpc("my_safety_concerns", {});
  if (error) return fail(error);
  const parsed = myConcernsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

export async function loadRetaliationReviews(): Promise<Loaded<RetaliationRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("retaliation_review_queue", {});
  if (error) return fail(error);
  const parsed = retaliationRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

/** Named backup readers (the table's own select policy shows them to the lead only). */
export async function loadReaders(): Promise<Loaded<ReaderRow[]>> {
  const { data, error } = await loose(await createClient()).from("safety_concern_readers").select("profile_id, note, created_at").eq("active", "true");
  if (error) return fail(error);
  const parsed = readerRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

/** Active clinical staff, for naming a reader and for showing a reader's name. */
export async function loadStaffNames(): Promise<Loaded<StaffRow[]>> {
  const { data, error } = await loose(await createClient()).from("clinical_staff").select("profile_id, full_name").eq("active", "true");
  if (error) return fail(error);
  const parsed = staffRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}
