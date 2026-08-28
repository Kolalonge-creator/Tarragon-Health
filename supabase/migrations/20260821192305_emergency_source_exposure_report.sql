-- 'exposure_report' as an emergency source, in its own migration because
-- ALTER TYPE ... ADD VALUE cannot be used in the transaction that adds it.
--
-- A patient reporting a possible bloodborne exposure within the
-- post-exposure-prophylaxis window is a genuine time-critical event, not a
-- scheduling matter: HIV PEP is effective for about 72 hours and hepatitis B
-- immunoglobulin sooner than that. Routing it through emergency_events reuses
-- the safety net that already exists — acknowledge-gated guidance, the
-- clinician alert, the follow-up check-in — rather than building a second,
-- weaker one beside it.
do $$ begin
  alter type public.emergency_source add value if not exists 'exposure_report';
exception when duplicate_object then null; end $$;