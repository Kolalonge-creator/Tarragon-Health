/**
 * Shared date/time display formatters. A bare `toLocaleDateString()` /
 * `toLocaleString()` (no locale argument) resolves to the server process's
 * locale during SSR and the browser's locale during CSR — those can disagree
 * and produce a React hydration mismatch (confirmed live: server rendered
 * "10/11/2026", client rendered "11/10/2026" for the same date), and even in
 * client-only renders it means two patients see different date formats
 * depending on their device locale. Always format dates through these.
 */

export function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
