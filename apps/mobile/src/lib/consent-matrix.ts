import {
  consentErrorMessage,
  parseConsentMatrix,
  type ConsentDataType,
  type ConsentMatrix,
  type ConsentPurpose,
} from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { supabase } from "./supabase";
import type { QueryResult } from "./medications";

/**
 * Consent matrix on the phone (v5 1.13, S42). Every call is the patient's own RLS-scoped session through the same RPCs the
 * web uses; the database decides what is allowed (a needed-for-care cell cannot be turned off by anyone, trigger
 * `enforce_consent_matrix_event`), this file only turns a refusal into a sentence.
 */
export async function loadConsentMatrix(): Promise<QueryResult<ConsentMatrix>> {
  const { data, error } = await supabase.rpc("my_consent_matrix");
  if (error) return { ok: false, error: t("consent.matrix.load_error") };
  const parsed = parseConsentMatrix(data);
  if (!parsed) return { ok: false, error: t("consent.matrix.load_error") };
  return { ok: true, data: parsed };
}

export interface ConsentHistoryRow {
  dataType: ConsentDataType;
  purpose: ConsentPurpose;
  action: "granted" | "withdrawn";
  at: string;
}

export async function loadConsentMatrixHistory(limit = 30): Promise<ConsentHistoryRow[]> {
  const { data, error } = await supabase.rpc("my_consent_matrix_history", { p_limit: limit });
  if (error || !Array.isArray(data)) return [];
  return (data as unknown as Array<{ data_type: ConsentDataType; purpose: ConsentPurpose; action: string; at: string }>).map((h) => ({
    dataType: h.data_type,
    purpose: h.purpose,
    action: h.action === "granted" ? "granted" : "withdrawn",
    at: h.at,
  }));
}

function failure(message: string | undefined): QueryResult<null> {
  return { ok: false, error: consentErrorMessage(message) === "required" ? t("consent.matrix.error.required") : t("consent.matrix.error.generic") };
}

export async function setConsentCell(dataType: ConsentDataType, purpose: ConsentPurpose, granted: boolean): Promise<QueryResult<null>> {
  const { error } = await supabase.rpc("set_consent_cell", { p_data_type: dataType, p_purpose: purpose, p_granted: granted });
  return error ? failure(error.message) : { ok: true, data: null };
}

export async function applyConsentBundle(code: string): Promise<QueryResult<null>> {
  const { error } = await supabase.rpc("apply_consent_bundle", { p_bundle: code });
  return error ? failure(error.message) : { ok: true, data: null };
}

export async function withdrawAllOptionalConsents(): Promise<QueryResult<null>> {
  const { error } = await supabase.rpc("withdraw_all_optional_consents");
  return error ? failure(error.message) : { ok: true, data: null };
}
