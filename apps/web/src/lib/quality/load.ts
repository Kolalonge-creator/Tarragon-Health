import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { auditRowsSchema, caseFileSchema, handbackRowsSchema, type AuditRow, type CaseFile, type HandbackRow } from "./model";

export type Loaded<T> = { ok: true; data: T } | { ok: false; denied: boolean };

const fail = (error: { code?: string }): { ok: false; denied: boolean } => ({ ok: false, denied: error.code === "42501" });

/** A failed read is a load failure the screen says so, never an empty queue. */
export async function loadAuditQueue(): Promise<Loaded<AuditRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("clinical_audit_queue", {});
  if (error) return fail(error);
  const parsed = auditRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

export async function loadHandbackQueue(): Promise<Loaded<HandbackRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("handback_review_queue", {});
  if (error) return fail(error);
  const parsed = handbackRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

/** Opening a case file is a logged clinical read (INV-10): this runs when the lead opens one audit page, once per page view. */
export async function loadCaseFile(auditId: string): Promise<Loaded<CaseFile>> {
  const { data, error } = await loose(await createClient()).rpc("audit_case_file", { p_audit: auditId });
  if (error) return fail(error);
  const parsed = caseFileSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}
