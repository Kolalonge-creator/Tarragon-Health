/**
 * What the HR pages may say about a refused database call. The HR functions raise plain sentences on purpose (SQLSTATE
 * P0001, or 42501 for "only an admin"); a table rule (23514, 23505) gets a fixed sentence; anything else is a raw database
 * message and is replaced, so no internal detail reaches the screen.
 */
export function safePeopleError(error: { message: string; code?: string }): string {
  if ((error.code === "P0001" || error.code === "42501") && error.message) return error.message;
  if (error.code === "23505") return "That name is already in use.";
  if (error.code === "23514") return "One of the values is not allowed. Check the dates, the note and the phone or ID number format.";
  console.error("people: unexpected database error", error.code ?? "no code", error.message);
  return "Something went wrong. Please try again.";
}
