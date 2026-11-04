import { z } from "zod";
import { marketingAnonClient } from "./anon-client";

/**
 * The founding member offer (founder decision 2026-11-04): a share off the first year of Membership and Membership Plus, for a fixed
 * number of places, open until they run out. Its terms live on ONE discount code an admin creates with the founding member badge;
 * `public.founding_offer_status()` reads that code and counts the places taken (a place is taken only by a paid order).
 *
 * This module is the only reader. It types no number: the percent, the places and the code all come from the database, and a read
 * that fails, is closed, or does not look exactly right gives `null`, so a page renders nothing rather than a stale or invented figure.
 * Pure (no auth, no platform module), so the marketing tree and the patient app share it.
 */
export interface FoundingOffer {
  readonly placesTotal: number;
  readonly placesLeft: number;
  readonly code: string;
  readonly percent: number;
}

const OPEN = z
  .object({
    open: z.literal(true),
    places_total: z.number().int().positive(),
    places_left: z.number().int().positive(),
    code: z.string().regex(/^[A-Z0-9]{4,24}$/),
    percent: z.number().int().min(1).max(100),
  })
  .strict()
  .refine((v) => v.places_left <= v.places_total);

/** The offer when it is open and well formed; otherwise null. */
export function parseFoundingOffer(data: unknown): FoundingOffer | null {
  const r = OPEN.safeParse(data);
  if (!r.success) return null;
  return { placesTotal: r.data.places_total, placesLeft: r.data.places_left, code: r.data.code, percent: r.data.percent };
}

/** How long the public pages keep a reading of the places left before asking again (seconds). */
export const FOUNDING_OFFER_REVALIDATE_SECONDS = 300;

/**
 * The live offer for the public site, read as anon with a short cache, never throwing. Null when there is no offer, it is full, the
 * database is not configured, or the read fails.
 */
export async function loadFoundingOffer(): Promise<FoundingOffer | null> {
  try {
    const supabase = marketingAnonClient({ revalidateSeconds: FOUNDING_OFFER_REVALIDATE_SECONDS });
    if (!supabase) return null;
    const { data, error } = await supabase.rpc("founding_offer_status");
    if (error) return null;
    return parseFoundingOffer(data);
  } catch {
    return null;
  }
}
