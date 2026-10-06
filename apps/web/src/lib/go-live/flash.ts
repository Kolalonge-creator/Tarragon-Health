import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";

/**
 * One-shot notice after a go-live action (S37). The text is carried in a short-lived, httpOnly, same-site cookie set by the server
 * action itself, never in the address. A link cannot put words into the green or red banner on a page where people decide whether
 * to switch a clinical feature on or sign off a value: only the action that actually ran can set it. Host-only (no domain).
 */
export const FLASH_COOKIE = "golive_flash";
// A Server Component cannot delete the cookie after showing it, so the cookie carries a random id and the redirect carries the same id
// (?n=). The page shows the notice only when the two match; the address is then cleaned (flash-clean.tsx), so a reload shows nothing. A
// link cannot forge the pair: the cookie is set only by the action, in this browser.
const MAX_AGE_SECONDS = 120;

const flashSchema = z.object({
  id: z.string().uuid(),
  notice: z.string().regex(/^golive\.(done|error)\.[a-z_]+$/),
  detail: z.string().max(400).optional(),
  ok: z.boolean(),
});
export type Flash = z.infer<typeof flashSchema>;

export async function setFlash(flash: Omit<Flash, "id">): Promise<string> {
  const id = randomUUID();
  (await cookies()).set(FLASH_COOKIE, JSON.stringify({ ...flash, id }), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return id;
}

/** The notice for this visit: only when the address carries the id the action just put in the cookie. */
export async function readFlash(n: string | undefined): Promise<Flash | null> {
  const raw = (await cookies()).get(FLASH_COOKIE)?.value;
  if (!raw || !n) return null;
  try {
    const parsed = flashSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.id === n ? parsed.data : null;
  } catch {
    return null;
  }
}
