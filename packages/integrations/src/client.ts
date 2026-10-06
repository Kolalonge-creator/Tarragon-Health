/**
 * The browser-safe slice of the integrations package (S21 follow-up). The full entry point re-exports every vendor adapter, the
 * payment and email clients and the crypto helpers, none of which belong in a page's bundle. A client component imports only what it
 * needs from here: the fallback ladder and the pure mapping from the call SDK's signals to ladder inputs.
 */
export * from "../../../supabase/functions/_shared/integrations/consultation-ladder.ts";
export * from "../../../supabase/functions/_shared/integrations/consultation-call.ts";
export type { ConnectionQuality, QualitySample, AudioFallbackPolicy, AudioFallbackState } from "../../../supabase/functions/_shared/integrations/video.ts";
export { INITIAL_AUDIO_FALLBACK } from "../../../supabase/functions/_shared/integrations/video.ts";
