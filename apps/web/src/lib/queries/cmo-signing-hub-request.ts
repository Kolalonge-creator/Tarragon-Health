import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { readCmoSigningHub } from "@/lib/queries/cmo-signing-hub";

/**
 * The hub list, read once per request. The dashboard layout needs it for the
 * banner on every page and the sign-off hub page needs it again for the list;
 * `cache()` makes the second caller reuse the first's result instead of running
 * about fourteen queries twice. (It takes no arguments on purpose: `cache`
 * keys on argument identity, and each caller would otherwise pass its own
 * Supabase client.)
 */
export const getCmoSigningHubForRequest = cache(async () => readCmoSigningHub(await createClient()));
