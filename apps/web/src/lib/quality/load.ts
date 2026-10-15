import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import {
  auditDetailSchema,
  auditRowsSchema,
  caseFileSchema,
  handbackRowsSchema,
  mySummarySchema,
  staffOptionsSchema,
  tier1Schema,
  type AuditDetail,
  type AuditRow,
  type CaseFile,
  type HandbackRow,
  type MyQualitySummary,
  type StaffOption,
  type Tier1Progress,
} from "./model";

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

/**
 * Opening a case file is an audited clinical read (INV-10): this runs when the lead opens one audit page, once per page view, and the
 * database records who opened it and when. Submitting is refused until the same person has opened it.
 */
export async function loadCaseFile(auditId: string): Promise<Loaded<CaseFile>> {
  const { data, error } = await loose(await createClient()).rpc("audit_case_file", { p_audit: auditId });
  if (error) return fail(error);
  const parsed = caseFileSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

/** The scores, comments, replies and follow-up history of one audit (lead only). Not a clinical read: no patient content. */
export async function loadAuditDetail(auditId: string): Promise<Loaded<AuditDetail>> {
  const { data, error } = await loose(await createClient()).rpc("audit_detail", { p_audit: auditId });
  if (error) return fail(error);
  const parsed = auditDetailSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

/** Tier 1 progress for one level 1 clinician (lead), or the signed-in clinician's own when no id is given. */
export async function loadTier1Progress(staffId: string | null): Promise<Loaded<Tier1Progress>> {
  const { data, error } = await loose(await createClient()).rpc("tier1_audit_progress", staffId ? { p_staff: staffId } : {});
  if (error) return fail(error);
  const parsed = tier1Schema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

/** Active clinical staff (the lead's table policy shows them), for reassigning a reviewer and for the level 1 list. */
export async function loadStaffOptions(): Promise<Loaded<StaffOption[]>> {
  const { data, error } = await loose(await createClient()).from("clinical_staff").select("id, profile_id, full_name, doctor_tier, credentialing_level").eq("active", "true");
  if (error) return fail(error);
  const parsed = staffOptionsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

/** The signed-in clinician's own finished audits, tier 1 count and advisory reliability score. */
export async function loadMyQuality(): Promise<Loaded<MyQualitySummary>> {
  const { data, error } = await loose(await createClient()).rpc("my_quality_summary", {});
  if (error) return fail(error);
  const parsed = mySummarySchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}
