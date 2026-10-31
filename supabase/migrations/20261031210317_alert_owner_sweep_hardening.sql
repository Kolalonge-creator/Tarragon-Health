-- Tarragon Health: narrow the reassignment-guard exemption, and tidy the owner sweep (2026-10-31)
--
-- Follow-up to 20261031002624 after /code-review high:
--  * The guard exemption let EVERY caller with no signed-in user reassign an alert (service role, any other scheduled job), which
--    before that migration raised 42501. It is now narrowed back: a no-user caller is let through only while private.assign_unowned_
--    clinician_alerts() has marked its own transaction. A signed-in user is never exempt, marker or not, and any other no-user caller
--    is refused exactly as it was before.
--  * private.pick_alert_owner() was STABLE, so a multi-row insert counted the same open-alert load for every row and sent them all to
--    one doctor. It is VOLATILE now.
--  * The sweep skips suppressed alerts (duplicates already suppressed by protocol), which should not add to a doctor's load.
--
-- Redefined from the LIVE bodies (20261031002624 is applied).

create or replace function private.pick_alert_owner(
  p_org uuid, p_owner_tier public.doctor_tier, p_backup_tier public.doctor_tier, p_senior_tier public.doctor_tier
) returns uuid
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_tier public.doctor_tier;
  v_id uuid;
begin
  foreach v_tier in array array[p_owner_tier, p_backup_tier, p_senior_tier, 'chief_medical_officer'::public.doctor_tier] loop
    continue when v_tier is null;
    select cs.id into v_id
    from public.clinical_staff cs
    left join public.clinician_alerts ca
      on ca.responsible_clinician_id = cs.id and ca.status in ('open', 'acknowledged')
    where cs.organisation_id = p_org
      and cs.active
      and cs.doctor_tier = v_tier
    group by cs.id, cs.created_at
    order by count(ca.id) asc, cs.created_at asc
    limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end loop;
  return null;
end;
$function$;

create or replace function private.enforce_clinician_alert_reassignment_authority()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  -- Not a person: the owner sweep marks its own transaction (see private.assign_unowned_clinician_alerts). Needs BOTH no signed-in
  -- user and the marker, so a signed-in user cannot use it and any other no-user caller is still refused.
  if (select auth.uid()) is null and coalesce(current_setting('tarragon.alert_owner_sweep', true), '') = 'on' then
    return new;
  end if;
  if (
       new.responsible_clinician_id is distinct from old.responsible_clinician_id
       and new.responsible_clinician_id is not null
       and new.responsible_clinician_id not in (
         select id from public.clinical_staff where profile_id = (select auth.uid())
       )
     )
     or (
       new.backup_clinician_id is distinct from old.backup_clinician_id
       and new.backup_clinician_id is not null
       and new.backup_clinician_id not in (
         select id from public.clinical_staff where profile_id = (select auth.uid())
       )
     )
  then
    if not exists (
      select 1 from public.clinical_staff
      where profile_id = (select auth.uid())
        and organisation_id = new.organisation_id
        and active
        and doctor_tier = 'chief_medical_officer'
    ) then
      raise exception 'Only the Chief Medical Officer / Clinical Director can assign this alert to someone else. Claim it for yourself instead.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function private.assign_unowned_clinician_alerts()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r record;
  v_rule jsonb;
  v_owner uuid;
  v_n integer := 0;
begin
  perform set_config('tarragon.alert_owner_sweep', 'on', true);
  for r in
    select ca.id, ca.organisation_id, ca.type_code
    from public.clinician_alerts ca
    where ca.status = 'open'
      and ca.responsible_clinician_id is null
      and not ca.suppressed
  loop
    v_rule := private.alert_rule_config(r.type_code);
    continue when v_rule is null or nullif(v_rule->>'owner_tier', '') is null;

    v_owner := private.pick_alert_owner(
      r.organisation_id,
      nullif(v_rule->>'owner_tier', '')::public.doctor_tier,
      nullif(v_rule->>'backup_tier', '')::public.doctor_tier,
      nullif(v_rule->>'senior_tier', '')::public.doctor_tier);
    continue when v_owner is null;

    update public.clinician_alerts
       set responsible_clinician_id = v_owner, assigned_at = now()
     where id = r.id and status = 'open' and responsible_clinician_id is null;
    if found then
      v_n := v_n + 1;
    end if;
  end loop;
  perform set_config('tarragon.alert_owner_sweep', 'off', true);
  return v_n;
end;
$function$;

do $$
begin
  if pg_get_functiondef('private.pick_alert_owner(uuid, public.doctor_tier, public.doctor_tier, public.doctor_tier)'::regprocedure) ~* 'stable' then
    raise exception 'pick_alert_owner is still STABLE';
  end if;
  if pg_get_functiondef('private.enforce_clinician_alert_reassignment_authority()'::regprocedure) not like '%tarragon.alert_owner_sweep%' then
    raise exception 'the reassignment guard does not check the sweep marker';
  end if;
  if has_function_privilege('anon', 'private.assign_unowned_clinician_alerts()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.assign_unowned_clinician_alerts()', 'EXECUTE') then
    raise exception 'the owner sweep became executable by anon or authenticated';
  end if;
end $$;
