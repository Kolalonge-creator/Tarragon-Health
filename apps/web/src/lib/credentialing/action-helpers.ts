import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { errorMessage } from "./rpc";

/**
 * Shared plumbing for the credentialing server actions (S15). Every form posts a hidden `returnTo`; it is only
 * honoured when it sits under one of the credentialing pages, so a form cannot be turned into an open redirect.
 * The outcome travels back as ?ok= or ?error= and the page shows it, so a failure is never silent.
 */
const ALLOWED_PREFIXES = ["/account/clinician", "/admin/credentialing", "/clinician/credentialing", "/clinician/credentials"] as const;

export function safeReturnTo(raw: FormDataEntryValue | null, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || raw.includes("://") || raw.includes("..") || raw.includes("%")) {
    return fallback;
  }
  const path = raw.split("?")[0] ?? raw;
  return ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`)) ? raw.split("?")[0] ?? fallback : fallback;
}

type Outcome = { ok: string } | { error: string };

export function withOutcome(path: string, outcome: Outcome): string {
  const key = "ok" in outcome ? "ok" : "error";
  const value = "ok" in outcome ? outcome.ok : outcome.error;
  return `${path}?${key}=${encodeURIComponent(value)}`;
}

/** Runs `work`, then sends the person back with the outcome. Never swallows a failure. */
export async function run(back: string, work: () => Promise<string>, alsoRevalidate: readonly string[] = []): Promise<never> {
  let outcome: Outcome;
  try {
    outcome = { ok: await work() };
  } catch (e) {
    outcome = { error: errorMessage(e) };
  }
  revalidatePath(back);
  for (const p of alsoRevalidate) revalidatePath(p);
  return redirect(withOutcome(back, outcome));
}

export function text(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export const uuid = z.uuid();

export function csv(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 20);
}

/** A date typed as YYYY-MM-DD becomes the end of that day in Lagos, which is when a licence stops being valid. */
export function endOfLagosDay(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return `${date}T23:59:59+01:00`;
}
