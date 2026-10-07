"use server";

import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { mapDbError, queryOk, reasonOk, recordSchema, searchRowsSchema, type OpenResult, type SearchResult } from "./model";

/**
 * S36a server actions. They run with the signed-in admin's own session, never the service role, so the database functions
 * (admin_patient_search, admin_open_patient_record) see the real caller, re-check the admin role and write the audit rows
 * (INV-10). The query and the reason go in the request body, never the address (a typed name is personal data).
 */
export async function searchPatientsAction(query: string): Promise<SearchResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "denied" };
  if (!queryOk(query)) return { ok: false, error: "query" };

  const { data, error } = await loose(await createClient()).rpc("admin_patient_search", { p_query: query.trim() });
  if (error) return { ok: false, error: mapDbError(error.code, "search") as "query" | "denied" | "failed" };
  const parsed = searchRowsSchema.safeParse(data ?? []);
  return parsed.success ? { ok: true, rows: parsed.data } : { ok: false, error: "failed" };
}

const idSchema = z.string().uuid();

export async function openPatientRecordAction(patientId: string, reason: string): Promise<OpenResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "denied" };
  if (!idSchema.safeParse(patientId).success) return { ok: false, error: "not_found" };
  if (!reasonOk(reason)) return { ok: false, error: "reason" };

  const { data, error } = await loose(await createClient()).rpc("admin_open_patient_record", {
    p_patient_id: patientId,
    p_reason: reason.trim(),
  });
  if (error) return { ok: false, error: mapDbError(error.code, "open") as "reason" | "not_found" | "denied" | "failed" };
  const parsed = recordSchema.safeParse(data);
  return parsed.success ? { ok: true, record: parsed.data } : { ok: false, error: "failed" };
}
