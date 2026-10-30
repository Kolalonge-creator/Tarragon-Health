import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The MDCN folio of clinicians, for the few screens entitled to it: the clinician themself, the Chief Medical Officer and
 * credentialing staff (private.can_credential_review()). CMO decision OQ-358: colleagues, patients and other staff never read it.
 *
 * After step 2 of the base-table lock, `authenticated` cannot select clinical_staff.credential_number at all; the only reader is
 * public.clinical_staff_folio(), which returns a row only for those entitled callers. DEPLOY-WINDOW FALLBACK: this code ships
 * before the schema step, so while that function does not exist yet (PostgREST PGRST202 / Postgres 42883) the lookup reads the
 * column directly, exactly as the old app did. Once the function exists it is always used. Any other failure, including a
 * permission refusal, yields no folio: a screen then shows no number, it never crashes and never invents one.
 */
export type StaffFolioMap = Map<string, string | null>;

type FolioRow = { clinical_staff_id: string; credential_number: string | null };
type Err = { code?: string; message?: string } | null;
type Client = {
  rpc: (fn: "clinical_staff_folio", args: { p_staff_ids: string[] }) => PromiseLike<{ data: FolioRow[] | null; error: Err }>;
  from: (table: "clinical_staff") => {
    select: (cols: "id, credential_number") => {
      in: (col: "id", ids: string[]) => PromiseLike<{ data: { id: string; credential_number: string | null }[] | null; error: Err }>;
    };
  };
};

/**
 * True only when the error means "public.clinical_staff_folio itself is not in the database (yet)". A missing function that
 * clinical_staff_folio CALLS (42883 naming something else) is a real failure and must not trigger the table fallback.
 */
export function isMissingFunctionError(error: Err): boolean {
  if (!error) return false;
  if (error.code === "PGRST202") return true;
  return error.code === "42883" && /clinical_staff_folio/.test(error.message ?? "");
}

export async function fetchStaffFolios(
  supabase: Pick<SupabaseClient, "rpc" | "from">,
  staffIds: readonly (string | null | undefined)[],
): Promise<StaffFolioMap> {
  const out: StaffFolioMap = new Map();
  const ids = [...new Set(staffIds.filter((i): i is string => typeof i === "string" && i.length > 0))];
  if (ids.length === 0) return out;
  const client = supabase as unknown as Client;

  const viaFunction = await client.rpc("clinical_staff_folio", { p_staff_ids: ids });
  if (!viaFunction.error) {
    for (const row of viaFunction.data ?? []) out.set(row.clinical_staff_id, row.credential_number);
    return out;
  }
  if (!isMissingFunctionError(viaFunction.error)) {
    // refused or failed: no folio shown, but never silently (a broken grant would otherwise look like "this clinician has no folio")
    console.error("clinical_staff_folio lookup failed", viaFunction.error.code);
    return out;
  }

  // Deploy-window fallback (REMOVE once the folio lock migration is applied everywhere): the schema step has not landed, so the
  // column is still readable. It fires only when the function itself is absent, and it says so.
  console.warn("clinical_staff_folio is not in the database yet: reading the column directly (deploy window)");
  const viaTable = await client.from("clinical_staff").select("id, credential_number").in("id", ids);
  if (viaTable.error) {
    console.error("clinical_staff folio fallback read failed", viaTable.error.code);
    return out;
  }
  for (const row of viaTable.data ?? []) out.set(row.id, row.credential_number);
  return out;
}

/**
 * Ids of clinicians whose folio contains the term, for the admin / Chief Medical Officer search box only. The database returns
 * nothing to anyone else and nothing for a term under two characters. A failure (including the function not being deployed yet)
 * yields no ids: the box then simply does not match on the folio, and says so in the log; it never reads the column.
 */
export async function searchStaffIdsByFolio(supabase: Pick<SupabaseClient, "rpc">, term: string): Promise<string[]> {
  const client = supabase as unknown as {
    rpc: (fn: "search_clinical_staff_by_folio", args: { p_term: string }) => PromiseLike<{ data: { clinical_staff_id: string }[] | null; error: Err }>;
  };
  const res = await client.rpc("search_clinical_staff_by_folio", { p_term: term });
  if (res.error) {
    console.error("search_clinical_staff_by_folio failed", res.error.code);
    return [];
  }
  return (res.data ?? []).map((r) => r.clinical_staff_id);
}

/** Fills `credential_number` on rows that no longer carry it (selected without the folio), for screens entitled to show it. */
export async function withStaffFolios<T extends { id: string }>(
  supabase: Pick<SupabaseClient, "rpc" | "from">,
  rows: readonly T[],
): Promise<(T & { credential_number: string | null })[]> {
  const folios = await fetchStaffFolios(supabase, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, credential_number: folios.get(r.id) ?? null }));
}
