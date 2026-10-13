/**
 * The patient's own complete export (S39f, OQ-285). `public.export_my_data()` returns every registered patient table for the signed-in patient,
 * and only while an admin has fulfilled one of their export requests within the review period. A refusal is reported as `not_approved`, never as an empty export.
 */
interface RpcClient {
  rpc(fn: "export_my_data"): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export type MyExportResult =
  | { status: "ok"; payload: Record<string, unknown> }
  | { status: "not_approved" }
  | { status: "failed"; message: string };

export async function fetchMyExport(supabase: unknown): Promise<MyExportResult> {
  const { data, error } = await (supabase as RpcClient).rpc("export_my_data");
  if (error) {
    if (error.code === "42501") return { status: "not_approved" };
    return { status: "failed", message: error.message };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { status: "failed", message: "unexpected export response" };
  return { status: "ok", payload: data as Record<string, unknown> };
}
