/**
 * The automatic picture check hook (COM-24). OFF unless a provider is named in COMMUNITY_IMAGE_SCAN_PROVIDER AND registered below, and
 * no vendor is registered today. Even when one is, it can only add a flag for the moderator: every picture still waits for a person, and
 * nothing is ever approved, released or removed by this check. A provider that fails or is slow counts as "unavailable", never as a
 * verdict, and never delays or blocks a post.
 *
 * Turning a vendor on needs the Chief Medical Officer's safety sign-off (what leaves our systems, what the vendor keeps, and the false
 * alarm rate): see docs/COMMUNITY_SPEC.md section 17.
 */
export type ImageVerdict = "clear" | "flag" | "unavailable";

export interface ImageScanner {
  name: string;
  scan: (bytes: Uint8Array, mime: "image/jpeg" | "image/png") => Promise<"clear" | "flag">;
}

/** Providers by name. Empty on purpose: add one here only after the safety sign-off. */
const SCANNERS: Readonly<Record<string, ImageScanner>> = {};

const TIMEOUT_MS = 4000;

export function configuredScanner(env: Record<string, string | undefined> = process.env, registry: Readonly<Record<string, ImageScanner>> = SCANNERS): ImageScanner | null {
  const name = env.COMMUNITY_IMAGE_SCAN_PROVIDER?.trim();
  if (!name) return null;
  // An unknown name means off, never a guess at a provider.
  return Object.hasOwn(registry, name) ? (registry[name] ?? null) : null;
}

export async function scanPicture(
  bytes: Uint8Array,
  mime: "image/jpeg" | "image/png",
  scanner: ImageScanner | null = configuredScanner(),
): Promise<ImageVerdict> {
  if (!scanner) return "unavailable";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      scanner.scan(bytes, mime),
      new Promise<"unavailable">((resolve) => {
        timer = setTimeout(() => resolve("unavailable"), TIMEOUT_MS);
      }),
    ]);
    return result === "flag" ? "flag" : result === "clear" ? "clear" : "unavailable";
  } catch {
    return "unavailable";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
