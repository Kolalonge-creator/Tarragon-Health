/**
 * EXPO_PUBLIC_* defaults, set before any module is required: supabase.ts
 * calls createClient() at import time and throws on a missing URL, so
 * anything that transitively imports it (api.ts, and therefore both offline
 * queues) is unimportable without these. Deliberately obvious placeholders —
 * no test in this package makes a real network call.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.EXPO_PUBLIC_PLATFORM_URL ??= "https://app.tarragonhealth.test";
