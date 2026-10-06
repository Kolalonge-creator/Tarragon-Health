import { cookies } from "next/headers";
import { z } from "zod";

/**
 * One-shot notice after a go-live action (S37). The text is carried in a short-lived, httpOnly, same-site cookie set by the server
 * action itself, never in the address. A link cannot put words into the green or red banner on a page where people decide whether
 * to switch a clinical feature on or sign off a value: only the action that actually ran can set it. Host-only (no domain).
 */
export const FLASH_COOKIE = "golive_flash";
const MAX_AGE_SECONDS = 20;

const flashSchema = z.object({
  notice: z.string().regex(/^golive\.(done|error)\.[a-z_]+$/),
  detail: z.string().max(400).optional(),
  ok: z.boolean(),
});
export type Flash = z.infer<typeof flashSchema>;

export async function setFlash(flash: Flash): Promise<void> {
  (await cookies()).set(FLASH_COOKIE, JSON.stringify(flash), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function readFlash(): Promise<Flash | null> {
  const raw = (await cookies()).get(FLASH_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = flashSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
