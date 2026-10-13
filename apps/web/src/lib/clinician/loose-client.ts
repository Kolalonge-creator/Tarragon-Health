/**
 * The generated database types do not yet carry S16/S35 tables and functions (types are spliced in by hand, see
 * lib/rota/rpc.ts), so these screens talk to Supabase through a minimal structural type and parse every answer with Zod.
 * `error` is always checked by the caller: an error is shown as a load failure, never as an empty list.
 */
type Result = PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;

interface Filterable extends Result {
  eq: (column: string, value: string) => Filterable;
  in: (column: string, values: string[]) => Filterable;
  order: (column: string, options: { ascending: boolean }) => Filterable;
  maybeSingle: () => Result;
}

export interface LooseClient {
  rpc: (fn: string, args?: Record<string, unknown>) => Result;
  from: (table: string) => { select: (columns: string) => Filterable };
}

export function loose(client: unknown): LooseClient {
  return client as LooseClient;
}
