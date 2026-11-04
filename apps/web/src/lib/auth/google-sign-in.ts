import "server-only";
import { z } from "zod";

/**
 * Is "Continue with Google" usable right now? Read from Supabase Auth's own public settings (GET /auth/v1/settings, the same
 * document the Supabase client reads), so the button appears exactly when the Google provider is switched on in Supabase and
 * disappears when it is switched off. No platform switch of our own: the provider setting IS the gate (docs/design/GATE-MODEL.md,
 * "one gate per feature"). Never throws; any failure hides the button, and email and phone sign-in are unaffected.
 */
const settingsSchema = z.object({ external: z.object({ google: z.boolean().optional() }).partial().optional() });

export async function googleSignInAvailable(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;
  try {
    const res = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: anonKey },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const parsed = settingsSchema.safeParse(await res.json());
    return parsed.success && parsed.data.external?.google === true;
  } catch {
    return false;
  }
}

/** Messages for a Google sign-in that came back without a session (shown on /login via ?error=google). */
export const GOOGLE_SIGN_IN_FAILED =
  "Google sign-in did not finish. If you are new to Tarragon and sign-up is by invitation at the moment, you need an invitation first. Otherwise, try again or sign in another way.";
