-- Local/CI-only fix-forward, NOT a functional migration -- same rationale
-- family as supabase/roles.sql's stub fixes (see that file's header), but
-- for a seed-data gap rather than a grant gap.
--
-- 20260802212103_screening_ladder_core_advanced_comprehensive.sql's own
-- lab_tests insert cross-joins against 4 hardcoded lab_providers UUIDs
-- (413fa046-..., bf4b3d30-..., c625d509-..., d8d35107-...). Those are real
-- values that exist on the live project (koiplnmbgnqnbywhpjlf) -- almost
-- certainly copied from a live query at the time that migration was
-- written -- but 20260730222039_restore_clinical_catalogue.sql, which
-- creates these same 4 providers (Synlab Nigeria, Cerba Lancet,
-- Healthtracka, Afriglobal Medicare) by name, lets `id` default to
-- gen_random_uuid(). A fresh replay therefore gives them different random
-- ids than the hardcoded ones, so 20260802212103's join matches zero rows
-- and its own "expected 36 new lab_tests rows" assertion fails (confirmed
-- via CI: found 0).
--
-- Not fixed by editing either historical migration (would touch
-- already-applied migration content -- see CLAUDE.md's standing lesson on
-- committed-vs-applied drift). Instead, this migration does the same insert
-- 20260802212103 intends, looked up by provider NAME instead of a hardcoded
-- id, so it works on any environment regardless of what random id these
-- providers got. It's a genuine no-op on the live project: those 36 rows
-- already exist there (real 20260802212103 already ran against the matching
-- real ids), so the NOT EXISTS guard skips every row. On a fresh replay it
-- creates the 36 rows correctly before 20260802212103 runs; that migration's
-- own insert then correctly matches nothing (its hardcoded ids don't exist)
-- and is a harmless no-op, letting its assertion pass.
insert into public.lab_tests (provider_id, code, name, price_kobo, turnaround_hours, is_active)
select p.id, t.code, t.name, t.price_kobo, 48, true
from public.lab_providers p
cross join (values
  ('fbc',         'Full Blood Count',      400000),
  ('lft',         'Liver Function Test',   600000),
  ('kft',         'Kidney Function Test',  600000),
  ('tft',         'Thyroid Function Test', 1000000),
  ('urinalysis',  'Urinalysis',            250000),
  ('urine_acr',   'Urine ACR',             500000),
  ('ecg_resting', 'Resting ECG',           600000),
  ('syphilis',    'Syphilis Screening (VDRL/TPHA)', 600000),
  ('ogtt_fpg',    'OGTT / Fasting Plasma Glucose', 400000)
) as t(code, name, price_kobo)
where p.name in ('Synlab Nigeria', 'Cerba Lancet', 'Healthtracka', 'Afriglobal Medicare')
  and p.is_active
  and not exists (
    select 1 from public.lab_tests lt where lt.provider_id = p.id and lt.code = t.code
  );
