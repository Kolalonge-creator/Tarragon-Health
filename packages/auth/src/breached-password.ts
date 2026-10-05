/**
 * Breached-password check using the k-anonymity range API (the Pwned
 * Passwords model). Only the first five hex characters of the password's
 * SHA-1 leave this process; the password and the full hash never do, and
 * the match against the returned suffixes happens locally.
 *
 * Supabase's own leaked-password protection is Pro-plan only and this
 * project is not on Pro, so the check lives here.
 *
 * FAILURE POLICY (decided, documented in docs/design/S03.md): when the
 * range service is slow or down the result is "unknown" and callers ALLOW the
 * password. Blocking sign-up or recovery because a third party is down would
 * lock people out of their own care; the length rule, rate limits and
 * verified-channel recovery still apply. "unknown" is reported to the caller
 * so it can be counted, never silently treated as "clean".
 *
 * Never logs the password, the hash or the prefix.
 */

export type BreachCheckResult =
  | { status: "clean" }
  | { status: "breached"; count: number }
  | { status: "unknown" };

export interface BreachCheckOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  endpoint?: string;
  /** Inject for runtimes without Web Crypto (React Native: use expo-crypto). Must return UPPERCASE hex. */
  sha1Hex?: (input: string) => Promise<string>;
}

export const PWNED_RANGE_ENDPOINT = "https://api.pwnedpasswords.com/range/";
export const BREACH_CHECK_TIMEOUT_MS = 2000;

export async function sha1HexWebCrypto(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export async function checkBreachedPassword(
  password: string,
  options: BreachCheckOptions = {},
): Promise<BreachCheckResult> {
  const {
    fetchImpl = fetch,
    timeoutMs = BREACH_CHECK_TIMEOUT_MS,
    endpoint = PWNED_RANGE_ENDPOINT,
    sha1Hex = sha1HexWebCrypto,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const hash = (await sha1Hex(password)).toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const response = await fetchImpl(`${endpoint}${prefix}`, {
      method: "GET",
      // Padding hides the real result-set size from anyone watching the wire.
      headers: { "Add-Padding": "true" },
      signal: controller.signal,
    });
    if (!response.ok) return { status: "unknown" };

    const body = await response.text();
    for (const line of body.split(/\r?\n/)) {
      const [candidate, rawCount] = line.trim().split(":");
      if (candidate?.toUpperCase() !== suffix) continue;
      const count = Number.parseInt(rawCount ?? "0", 10);
      // Padded decoy rows carry a count of 0 and are not matches.
      return count > 0 ? { status: "breached", count } : { status: "clean" };
    }
    return { status: "clean" };
  } catch {
    return { status: "unknown" };
  } finally {
    clearTimeout(timer);
  }
}
