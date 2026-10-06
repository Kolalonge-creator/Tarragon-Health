/**
 * Every rota form posts a hidden `returnTo`. It is honoured only when it is one of the three rota pages, so a form
 * cannot be turned into an open redirect. The outcome travels back as ?ok= or ?error= and the page shows it.
 */
export const ROTA_PAGES = ["/clinician/rota", "/admin/rota", "/clinician/team-rota"] as const;

export function safeRotaReturnTo(raw: FormDataEntryValue | null, fallback: (typeof ROTA_PAGES)[number]): string {
  if (typeof raw !== "string") return fallback;
  if (raw.includes("\\") || raw.includes("://") || raw.includes("..") || raw.includes("%") || raw.startsWith("//")) return fallback;
  const path = raw.split("?")[0] ?? "";
  return (ROTA_PAGES as readonly string[]).includes(path) ? path : fallback;
}

export function withOutcome(path: string, outcome: { ok: string } | { error: string }): string {
  const key = "ok" in outcome ? "ok" : "error";
  const value = "ok" in outcome ? outcome.ok : outcome.error;
  return `${path}?${key}=${encodeURIComponent(value)}`;
}
