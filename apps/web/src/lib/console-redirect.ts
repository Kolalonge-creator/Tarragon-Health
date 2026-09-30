import { isConsolePath } from "@tarragon/auth/console-areas";

/**
 * Where the extracted staff console lives (apps/console), read at RUNTIME from
 * `CONSOLE_BASE_URL`. Returns null when unset or unusable, and the caller then
 * does nothing: the redirect is opt-in per environment, so deploying this code
 * before the console exists cannot send anyone to a dead host.
 *
 * Only an https origin is accepted (plain http only for localhost, so local
 * development works). A path, query or credentials in the variable are
 * dropped: the target is always `origin + the original path`.
 */
export function consoleBaseUrl(): string | null {
  const raw = process.env.CONSOLE_BASE_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const isLocal = url.hostname === "localhost" || url.hostname.endsWith(".localhost");
    if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The console URL an old apps/web staff path should redirect to, or null when
 * the path was never extracted or no console is configured. Path and query are
 * carried over untouched, so a deep link in an existing email or notification
 * row (they hold `app.` paths) still lands on the same page.
 */
export function consoleRedirectTarget(
  pathname: string,
  search: string,
  base: string | null
): string | null {
  if (!base || !isConsolePath(pathname)) return null;
  return `${base}${pathname}${search}`;
}
