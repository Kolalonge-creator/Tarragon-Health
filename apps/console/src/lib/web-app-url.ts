/**
 * Origin of the main TarragonHealth app (apps/web's `app.` host), used to
 * point a non-staff or not-yet-migrated login back where it belongs.
 *
 * Read at runtime from `WEB_APP_URL`. Returns null when unset, and callers
 * must then show plain text rather than a link: guessing a host here would
 * send a staff member to somebody else's page.
 */
export function webAppUrl(): string | null {
  const raw = process.env.WEB_APP_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}
