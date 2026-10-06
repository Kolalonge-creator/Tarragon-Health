/**
 * Every rota and paging form posts a hidden `returnTo`. It is honoured only when it is one of the rota or on-call pages, so a form
 * cannot be turned into an open redirect. The outcome travels back as ?ok= or ?error= and the page shows it.
 */
export const ROTA_PAGES = ["/clinician/rota", "/admin/rota", "/clinician/team-rota", "/clinician/on-call"] as const;

const PATIENT_PAGE = /^\/clinician\/patients\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function safeRotaReturnTo(raw: FormDataEntryValue | null, fallback: (typeof ROTA_PAGES)[number]): string {
  if (typeof raw !== "string") return fallback;
  if (raw.includes("\\") || raw.includes("://") || raw.includes("..") || raw.includes("%") || raw.startsWith("//")) return fallback;
  const path = raw.split("?")[0] ?? "";
  if ((ROTA_PAGES as readonly string[]).includes(path)) return path;
  // a clinician declaring a conflict from a patient's page goes back to that page (a uuid, nothing else)
  return PATIENT_PAGE.test(path) ? path : fallback;
}

export function withOutcome(path: string, outcome: { ok: string } | { error: string }): string {
  const key = "ok" in outcome ? "ok" : "error";
  const value = "ok" in outcome ? outcome.ok : outcome.error;
  return `${path}?${key}=${encodeURIComponent(value)}`;
}
