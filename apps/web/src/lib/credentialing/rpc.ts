import { z } from "zod";

/**
 * Thin wrapper over supabase.rpc for the credentialing functions (S15). The generated database types do not yet
 * carry these functions (CLAUDE.md: types are spliced in by hand from the branch's own migrations), so every call
 * goes through here with its result parsed by a Zod schema: nothing is trusted just because it came from the
 * database. The functions raise human-written messages; those reach the screen, anything else is made generic.
 */
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
type LooseClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> };

export class CredentialingError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "CredentialingError";
  }
}

/** Postgres error classes whose messages the functions wrote for people. */
const PEOPLE_CODES = new Set(["23514", "23505", "42501", "P0002"]);

function toError(error: { message: string; code?: string }): CredentialingError {
  if (error.code && PEOPLE_CODES.has(error.code)) return new CredentialingError(error.message, error.code);
  return new CredentialingError("Something went wrong. Please try again, and tell us if it keeps happening.", error.code);
}

export async function rpcParsed<T>(client: object, fn: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const { data, error } = await (client as LooseClient).rpc(fn, args);
  if (error) throw toError(error);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new CredentialingError("The answer from the server was not what we expected.", undefined);
  return parsed.data;
}

export async function rpcVoid(client: object, fn: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await (client as LooseClient).rpc(fn, args);
  if (error) throw toError(error);
}

export function errorMessage(e: unknown): string {
  if (e instanceof CredentialingError) return e.message;
  return "Something went wrong. Please try again.";
}
