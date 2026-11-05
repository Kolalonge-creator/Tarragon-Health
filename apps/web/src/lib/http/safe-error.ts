/**
 * What an API route may tell a caller about a failed database, storage or RPC call (security audit 2026-11-05, L-2).
 *
 * Raw Postgres and storage messages name tables, columns, constraints and policies, which is a map for an attacker and
 * meaningless to a patient. Only a message a database function raised on purpose (`raise exception '...'`, SQLSTATE P0001,
 * written to be read) is passed through. Anything else is logged on the server and replaced by the caller's fallback.
 */
type ErrorLike = { message?: string | null; code?: string | null } | null | undefined;

export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export function safeErrorMessage(error: ErrorLike, context: string, fallback: string = GENERIC_ERROR_MESSAGE): string {
  if (error?.code === "P0001" && error.message) return error.message;
  if (error) console.error(`${context}: ${error.code ?? "no code"} ${error.message ?? ""}`.trim());
  return fallback;
}
