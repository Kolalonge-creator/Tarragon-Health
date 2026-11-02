import { createHash, randomBytes } from "node:crypto";

/** HTTP-level helpers for the public chat routes: where a request may come from, who is calling, and the conversation secret. */

/** The conversation secret is 32 random bytes; only its SHA-256 is ever stored, so a database reader cannot continue anyone's chat. */
export function newConversationSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * A browser always sends Origin on a cross-site or same-site POST. It must match this site's own host or an origin listed in
 * WIDGET_ALLOWED_ORIGINS. A request with no Origin is refused: the widget is the only legitimate caller, and a script posting from a server is not.
 */
export function isAllowedOrigin(origin: string | null, host: string | null, allowedList: string | undefined): boolean {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && !url.hostname.endsWith(".localhost")) return false;
  if (host && url.host === host) return true;
  return (allowedList ?? "").split(",").map((o) => o.trim()).filter(Boolean).some((o) => {
    try {
      return new URL(o).origin === url.origin;
    } catch {
      return false;
    }
  });
}

/** Vercel's own header first (a client cannot set it there), then the standard proxy headers. */
export function clientIp(headers: Headers): string {
  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]!.trim();
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}

export const isJson = (headers: Headers): boolean => (headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
