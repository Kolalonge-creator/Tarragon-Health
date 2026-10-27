import { rpcLoose } from "./rpc";

export type Called<T> = { state: "ok"; data: T } | { state: "off" } | { state: "refused" } | { state: "error" };

/**
 * Calls one S79 database function on the signed-in user's own session. "off" means the institution_console switch is not on yet (the page then
 * says so instead of showing an error); "refused" means the caller is not sponsor staff for this organisation.
 */
export async function callInstitution<T>(fn: string, args: Record<string, unknown>, parse: (d: unknown) => T | null): Promise<Called<T>> {
  const { data, error } = await rpcLoose(fn, args);
  if (error) {
    if (error.message.includes("not yet activated")) return { state: "off" };
    if (error.message.includes("sponsor_not_authorised") || error.message.includes("Not authorised")) return { state: "refused" };
    return { state: "error" };
  }
  const parsed = parse(data);
  return parsed === null ? { state: "error" } : { state: "ok", data: parsed };
}

export function notice(state: "off" | "refused" | "error"): string {
  if (state === "off") return "This part of the console is not switched on yet. Tarragon will tell you when it is ready.";
  if (state === "refused") return "Your login is not set up for this organisation. Ask Tarragon to check it.";
  return "This could not be loaded. Please refresh, and tell Tarragon if it keeps happening.";
}
