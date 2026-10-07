/**
 * Vendor adapter interfaces and mocks (S14): payments (Paystack), video, speech to text and email (Resend). The code
 * lives in `supabase/functions/_shared/integrations` because an edge function cannot import a workspace package; this
 * file re-exports it so web code and the console use the same copy. See docs/design/S14.md.
 */
export * from "../../../supabase/functions/_shared/integrations/index.ts";
