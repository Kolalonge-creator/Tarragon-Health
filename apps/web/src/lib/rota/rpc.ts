import { z } from "zod";

/**
 * Thin wrapper over supabase.rpc for the S18 functions (availability, rota, conflicts, lead assignment). The generated
 * database types do not carry them yet (types are spliced in by hand), so every read is parsed with Zod. These functions
 * raise messages written for people (22023, 23P01, 23514, 42501, P0002); those reach the screen, anything else is made generic.
 */
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
type LooseClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> };

export class RotaError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "RotaError";
  }
}

const PEOPLE_CODES = new Set(["22023", "23P01", "23514", "42501", "P0002"]);
const GENERIC = "Something went wrong. Please try again, and tell your care team lead if it keeps happening.";

export function toRotaError(error: { message: string; code?: string }): RotaError {
  if (error.code && PEOPLE_CODES.has(error.code)) return new RotaError(error.message, error.code);
  return new RotaError(GENERIC, error.code);
}

export async function rpcParsed<T>(client: object, fn: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const { data, error } = await (client as LooseClient).rpc(fn, args);
  if (error) throw toRotaError(error);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new RotaError("The answer from the server was not what we expected.", undefined);
  return parsed.data;
}

export async function rpcVoid(client: object, fn: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await (client as LooseClient).rpc(fn, args);
  if (error) throw toRotaError(error);
}

export function rotaErrorMessage(e: unknown): string {
  return e instanceof RotaError ? e.message : GENERIC;
}
