-- Tarragon Health — feature_flags: deduplicate against a concurrent build
--
-- The previous migration in this PR (20260829205354_feature_flags_cohort_targeting_and_eval.
-- sql) added target_states/target_provider_ids/target_patient_ids/include_internal_staff and
-- private.is_feature_flag_enabled() without knowing that another session had, earlier the same
-- day (09:32-11:15), already built a materially better version of the same idea directly on
-- this table: public.feature_flag_rules (kind: profile/state/account_role/organisation, effect:
-- allow/deny — a normalized, deny-capable, org-aware targeting model) plus private.
-- is_feature_enabled(text, uuid) and public.my_feature_flags(). Discovered only after applying,
-- via live schema introspection — no git record of that work exists on any fetched branch, the
-- same "applied but uncommitted, no local trace" drift pattern flagged elsewhere in this
-- project's history. Rather than leave two competing eval functions and two competing
-- targeting models on the same table, this migration removes the redundant half of what the
-- previous migration in this PR added and keeps only what neither build already covered.
--
-- Kept (genuinely additive, not covered by feature_flag_rules): updated_by + its stamping
-- trigger, and audit_row_change_trg (feature_flag_rules has no update tracking, only inserts
-- of point-in-time rules — the base feature_flags row itself, e.g. its status/rollout_percent,
-- still had no change history or updated_by before this PR).
--
-- Removed: target_states/target_provider_ids/target_patient_ids/include_internal_staff
-- (superseded by feature_flag_rules, which already covers profile/state/account_role/
-- organisation targeting with allow AND deny, a strict superset), and private.
-- is_feature_flag_enabled (superseded by private.is_feature_enabled, which additionally
-- respects deny rules). Any code written against the removed function must call private.
-- is_feature_enabled(flag_key, profile_id) instead.

drop function if exists private.is_feature_flag_enabled(text, uuid, uuid);

alter table public.feature_flags
  drop column if exists target_states,
  drop column if exists target_provider_ids,
  drop column if exists target_patient_ids,
  drop column if exists include_internal_staff;

-- ---------------------------------------------------------------------------
-- feature_flag_rules.value can hold a raw profile UUID (kind = 'profile') and is currently
-- broadly authenticated-readable (qual = true) — the same patient-ID-enumeration exposure the
-- previous migration in this PR closed on feature_flags itself. Closing it here too, for the
-- same reason: ordinary evaluation never needs a direct table read, it goes through private.
-- is_feature_enabled()/public.my_feature_flags() (both SECURITY DEFINER).
-- ---------------------------------------------------------------------------

drop policy if exists feature_flag_rules_select on public.feature_flag_rules;
create policy feature_flag_rules_select on public.feature_flag_rules
  for select to authenticated
  using (private.is_admin() or private.has_permission('feature_flags.manage'));

do $$
begin
  if to_regprocedure('private.is_feature_flag_enabled(text, uuid, uuid)') is not null then
    raise exception 'private.is_feature_flag_enabled should have been dropped';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'feature_flags' and column_name = 'target_states'
  ) then
    raise exception 'feature_flags.target_states should have been dropped';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'feature_flag_rules' and cmd = 'SELECT'
      and 'authenticated' = any (roles) and qual = 'true'
  ) then
    raise exception 'feature_flag_rules select policy is unexpectedly unrestricted (using true)';
  end if;
end $$;
