-- Local/CI-only fix-forward, NOT a functional migration -- same rationale
-- family as supabase/roles.sql's stubs and the other backdated fix-forward
-- migrations in this history (screening_ladder provider lookup,
-- complete_usd price-lock seed, lab_result_extractions grant): a later
-- migration's own assertion depends on state that, on the live project,
-- has existed for a long time as real production data, but that a fresh
-- replay starts with none of.
--
-- 20260803141522_care_voucher_constraints_allow_subscription_sku.sql's own
-- negative self-tests insert a probe row via
--   organisations o JOIN profiles p ON p.organisation_id = o.id AND p.role = 'patient'
-- expecting a CHECK violation. On a genuinely fresh database this join
-- matches zero rows (no migration anywhere in this history has ever
-- inserted a patient profile -- confirmed by exhaustive grep), so the probe
-- INSERT silently affects nothing, no violation is ever raised, and the
-- test's own unconditional `raise exception` fires regardless of whether
-- the underlying constraints are actually correct -- a false failure, not a
-- real one.
--
-- profiles.id references auth.users(id) on delete cascade (core_auth_
-- multitenancy.sql), so a synthetic profile needs a synthetic auth.users
-- row first. Minimal-column auth.users insert pattern below is the same one
-- already proven to work in this exact Postgres bootstrap by
-- packages/db/tests/provenance_fk_hardening.sql.
--
-- Placed right after 20260706084837 (the migration that seeds the
-- well-known "Tarragon Health Direct" direct-consumer organisation and
-- updates handle_new_user() to default new users onto it) so the
-- on_auth_user_created trigger auto-provisions the matching profiles row
-- with zero extra insert logic here: empty app/user metadata -> role
-- defaults to 'patient', organisation_id defaults to the direct-consumer
-- org. Earliest safe point, so any later test sharing this same
-- "assumes a patient profile exists" pattern can reuse it too.
--
-- Guarded to be a genuine no-op on the live project: live has millions of
-- real organisation+patient pairs, so the `not exists` below is always
-- false there and this block never runs. It only fires on a database that
-- has no patient profile of any kind yet -- true on a fresh replay, never
-- true on live.
do $$
begin
  if not exists (
    select 1
    from public.organisations o
    join public.profiles p on p.organisation_id = o.id and p.role = 'patient'
  ) then
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (
      '00000000-0000-0000-0000-0000000000f2',
      'ci-fixture-patient@example.invalid',
      'x',
      now(),
      '{}',
      '{}'
    )
    on conflict (id) do nothing;
  end if;
end $$;
