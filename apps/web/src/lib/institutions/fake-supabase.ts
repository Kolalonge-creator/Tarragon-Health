import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

type Reply = { data: unknown; error: { message: string } | null; count?: number | null };

/**
 * Test double for the institution loaders: every query on a table resolves to
 * that table's canned reply, whatever filters are chained on it. A table
 * missing from the map replies with an empty success, so a test names only the
 * reads it cares about.
 */
export function fakeSupabase(replies: Record<string, Reply>): SupabaseClient<Database> {
  const chain = (reply: Reply): unknown => {
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === "then") return (resolve: (v: Reply) => unknown) => resolve(reply);
        return () => proxy;
      },
    };
    const proxy: unknown = new Proxy({}, handler);
    return proxy;
  };
  return {
    from: (table: string) => chain(replies[table] ?? { data: [], error: null }),
    rpc: () => chain({ data: null, error: null }),
  } as unknown as SupabaseClient<Database>;
}

export const ok = (data: unknown): Reply => ({ data, error: null });
export const fails = (message = "boom"): Reply => ({ data: null, error: { message } });
