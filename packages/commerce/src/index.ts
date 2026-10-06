/**
 * Catalogue checkout core (S25): fee display, the order payment flow shared by the webhook, the return page and the
 * sweeper, and the checkout starter. The code lives in `supabase/functions/_shared/commerce` because an edge function
 * cannot import a workspace package; this file re-exports it so web code and the console use the same copy.
 */
export * from "../../../supabase/functions/_shared/commerce/index.ts";
