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

/** The queue and availability functions (S17, S18) raise short keys; these are the sentences people read instead. */
const FRIENDLY: Record<string, string> = {
  availability_too_short: "Hours must be at least two hours long.",
  availability_needs_on_call_competency: "You do not have the on-call competency yet. Ask your care team lead.",
  availability_during_leave: "You are on leave for part of that time.",
  availability_overlap: "That overlaps hours you already declared.",
  availability_on_the_rota: "You are on the rota during these hours. Ask a colleague to cover instead of cancelling.",
  queue_bad_window: "Choose hours that start from now and no more than 31 days ahead.",
  queue_not_eligible: "Your credentials need attention before you can declare hours.",
  queue_no_block: "That block was not found.",
};

export function toRotaError(error: { message: string; code?: string }): RotaError {
  const key = error.message.split(":")[0]?.trim() ?? "";
  if (FRIENDLY[key]) return new RotaError(FRIENDLY[key], error.code);
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
