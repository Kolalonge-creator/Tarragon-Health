import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchTestPatientIds } from "@/lib/queries/real-patients";

/**
 * The test-patient id list, read once per request (INV-13). A server page
 * that applies the exclusion to several reads (the clinician home does it to
 * four) shares one `profiles` query through React.cache instead of running
 * it per read. Takes no arguments on purpose, for the same reason as
 * getCmoSigningHubForRequest: `cache` keys on argument identity, and each
 * caller would otherwise pass its own Supabase client.
 */
export const getTestPatientIdsForRequest = cache(async () => fetchTestPatientIds(await createClient()));
