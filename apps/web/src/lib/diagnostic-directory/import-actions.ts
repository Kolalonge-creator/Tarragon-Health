"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { readImport } from "./import-csv";
import { importRowSchema, noticeForError, rejectImportRowSchema, stageImportSchema, type Notice } from "./model";

/**
 * Diagnostic directory Phase 7 import actions. Staging and applying are database functions (admin_dx_import_*) that check the
 * caller and every row; applying one row only ever creates DRAFT records. Nothing here lists, verifies or confirms anything.
 */
const BASE = "/admin/ops/diagnostic-directory/import";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES = 2 * 1024 * 1024;
const go = (n: Notice, batch?: string | null): never =>
  redirect(batch && UUID.test(batch) ? `${BASE}?batch=${batch}&n=${n}` : `${BASE}?n=${n}`);

async function call(fn: string, args: Record<string, unknown>) {
  return loose(await createClient()).rpc(fn, args);
}

export async function stageImportAction(formData: FormData): Promise<void> {
  const meta = stageImportSchema.safeParse({ source: formData.get("source") ?? "", note: formData.get("note") ?? "" });
  if (!meta.success) return go("invalid");
  const file = formData.get("file");
  if (!(file instanceof Blob) || file.size === 0 || file.size > MAX_BYTES) return go("import_bad_file");
  const read = readImport(await file.text());
  if (!read.ok) return go("import_bad_file");
  const { data, error } = await call("admin_dx_import_stage", { p_source: meta.data.source, p_note: meta.data.note ?? null, p_rows: read.rows });
  if (error || typeof data !== "string") return go(noticeForError(error?.code));
  return go("import_staged", data);
}

export async function applyImportRowAction(formData: FormData): Promise<void> {
  const p = importRowSchema.safeParse({ batch_id: formData.get("batch_id"), row_id: formData.get("row_id") });
  if (!p.success) return go("invalid");
  const { error } = await call("admin_dx_import_apply_row", { p_row_id: p.data.row_id });
  if (error) return go(error.code === "23505" ? "import_duplicate" : noticeForError(error.code, true), p.data.batch_id);
  return go("import_applied", p.data.batch_id);
}

export async function rejectImportRowAction(formData: FormData): Promise<void> {
  const p = rejectImportRowSchema.safeParse({ batch_id: formData.get("batch_id"), row_id: formData.get("row_id"), reason: formData.get("reason") });
  if (!p.success) return go("invalid", String(formData.get("batch_id") ?? ""));
  const { error } = await call("admin_dx_import_reject_row", { p_row_id: p.data.row_id, p_reason: p.data.reason });
  return go(error ? noticeForError(error.code) : "import_rejected", p.data.batch_id);
}
