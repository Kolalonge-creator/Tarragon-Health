/**
 * Reads one platform feature flag (public.feature_flags) with a service-role client. A flag that cannot be read is OFF: every
 * provider-layer flag defaults off and a lookup failure must never switch new behaviour on. Only status 'on' counts; 'rollout'
 * is a cohort mechanism for patient features and is not used for money paths.
 */
export interface FlagReader {
  from(table: string): {
    select(columns: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> } };
  };
}

export async function featureFlagOn(client: FlagReader, key: string): Promise<boolean> {
  try {
    const { data, error } = await client.from("feature_flags").select("status").eq("key", key).maybeSingle();
    if (error || typeof data !== "object" || data === null) return false;
    return (data as { status?: unknown }).status === "on";
  } catch {
    return false;
  }
}
