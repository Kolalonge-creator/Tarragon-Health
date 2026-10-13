-- A governed configuration version can never be activated while an OLDER number
-- than one already signed.
--
-- Why: every sign_* function activates whatever id it is given and deactivates the
-- rest, and several of these tables hold old unsigned drafts that a later version
-- superseded (escalation_slas v1-v6 beside live v8, alert_rules v1-v4 beside live
-- v6). Signing one of those would silently put the platform back on an older
-- configuration: an SLA, an alert taxonomy or a triage protocol reverting with a
-- signature on file that reads as routine sign-off. The app now refuses it in the
-- sign actions and hides the button, but a rule that matters belongs where every
-- caller meets it: a direct RPC call, a future action, anything. Ten functions
-- activate versions today (including the older sign_triage_protocol), so the guard
-- is one trigger on the tables rather than ten edited function bodies.
--
-- Mechanics: BEFORE UPDATE OF is_active, only when a row goes inactive -> active.
-- The sign functions deactivate the live row first, so the live version cannot be
-- read at that moment; the rule therefore compares with the highest version that
-- has ever been SIGNED (approved_at is not null) in the same partition, which for a
-- table with one live row is the same thing. Partition columns differ: cv_risk_config
-- is per organisation, risk_questionnaire_configs per organisation and code, the rest
-- are global. Inserts (the seed rows, which go live unsigned by design) are not
-- affected, and neither is re-saving an already-active row.
--
-- Deliberately stricter than "newer than live": a genuine roll-back is a NEW version
-- carrying the old values, which is how this ledger is meant to change (append-only).
-- Revert path if one is ever needed in anger: drop the trigger on that one table.
create or replace function private.refuse_activating_superseded_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pred text := '';
  v_col text;
  v_max integer;
begin
  -- TG_ARGV holds the partition columns, if any (compared via jsonb so the column
  -- types do not matter here). It is NULL, not empty, when the trigger has no arguments.
  foreach v_col in array coalesce(tg_argv, '{}'::text[]) loop
    v_pred := v_pred || format(' and (to_jsonb(t) -> %L) is not distinct from ($2 -> %L)', v_col, v_col);
  end loop;

  execute format(
    'select max(t.version) from %I.%I t where t.id <> $1 and t.approved_at is not null%s',
    tg_table_schema, tg_table_name, v_pred
  ) into v_max using new.id, to_jsonb(new);

  if v_max is not null and new.version < v_max then
    raise exception
      'Version % of % is older than signed version %. Activating it would put the platform back on an older configuration. Draft a new version instead.',
      new.version, tg_table_name, v_max
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.refuse_activating_superseded_version() from public, anon;

create trigger refuse_superseded_activation before update of is_active on public.alert_rules
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();
create trigger refuse_superseded_activation before update of is_active on public.escalation_slas
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();
create trigger refuse_superseded_activation before update of is_active on public.triage_protocols
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();
create trigger refuse_superseded_activation before update of is_active on public.mental_health_screening_cadences
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();
create trigger refuse_superseded_activation before update of is_active on public.provider_quality_policy
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();
create trigger refuse_superseded_activation before update of is_active on public.vaccination_schedule_signoffs
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();
create trigger refuse_superseded_activation before update of is_active on public.result_release_policies
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();
-- Partitioned: one live row per organisation (and per code for the questionnaire).
create trigger refuse_superseded_activation before update of is_active on public.cv_risk_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version('organisation_id');
create trigger refuse_superseded_activation before update of is_active on public.risk_questionnaire_configs
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version('organisation_id', 'code');

do $$
declare
  v_n integer;
begin
  select count(*) into v_n from pg_trigger
   where tgname = 'refuse_superseded_activation' and not tgisinternal;
  if v_n <> 9 then
    raise exception 'FAIL: expected 9 refuse_superseded_activation triggers, found %', v_n;
  end if;
  if has_function_privilege('anon', 'private.refuse_activating_superseded_version()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.refuse_activating_superseded_version';
  end if;
end $$;
