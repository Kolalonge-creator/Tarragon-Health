-- OQ-451 and OQ-452. Two things in one migration because the app change ships with both.
--
-- 1. OQ-451: the CMO sign-off hub gets a signing function for queue_task_layer_config (sign a version) and an activation function for
--    paging_delivery_config (activate v2) that REFUSES until the pre-sign checklist in docs/plans/S16-S20-cmo-signoff-pack.md section 3
--    step 5 is met: every on-call clinician has a working push subscription, a verified email and a test page acknowledged within the
--    window of the version being activated. Both tables get approval columns, a freeze guard (a signed or superseded version is
--    never edited or deleted; a change is a NEW version) and the "never activate an older version than one already signed" trigger.
-- 2. OQ-452: public.platform_deep_health(), service role only, the heartbeat facts /api/health/deep needs beyond platform_health_snapshot().
--
-- NOTHING IS SIGNED OR ACTIVATED HERE. State before (2026-10-16): queue_task_layer_config v1 active, unsigned; paging_delivery_config v1
-- active, v2 inactive, both unsigned. This migration leaves every row exactly as it is (the self-check at the end asserts it).
-- No existing function is restated; every function below is new, so there is no live body to copy.
-- No begin/commit here: the auto-apply workflow wraps this file.

-- ---------------------------------------------------------------------------
-- 1. Approval columns, freeze guard, superseded-activation guard
-- ---------------------------------------------------------------------------
alter table public.queue_task_layer_config
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles (id) on delete set null;
alter table public.paging_delivery_config
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles (id) on delete set null;
create index if not exists queue_task_layer_config_approved_by_idx on public.queue_task_layer_config (approved_by) where approved_by is not null;
create index if not exists paging_delivery_config_approved_by_idx on public.paging_delivery_config (approved_by) where approved_by is not null;

-- A version is frozen once it is signed, or sits below a version that is in force or signed (superseded). The signature is the freeze point,
-- as with quality_config: an unsigned version in force may still be corrected by the database owner (the existing proofs tune it in place
-- inside rolled-back transactions); once the CMO signs it, or a newer version takes over, it is fixed and a change is a NEW version. The sign/activate functions change only is_active, approved_at and approved_by.
create function private.frozen_config_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_top integer;
  v_frozen boolean;
begin
  -- nothing is ever inserted already signed: a signature comes only from the sign/activate functions
  if tg_op = 'INSERT' then
    if new.approved_at is not null or new.approved_by is not null then
      raise exception '% cannot be inserted already signed; sign it with the signing function', tg_table_name using errcode = '23514';
    end if;
    return new;
  end if;
  execute format('select max(t.version) from %I.%I t where t.id <> $1 and (t.is_active or t.approved_at is not null)', tg_table_schema, tg_table_name)
    into v_top using old.id;
  v_frozen := old.approved_at is not null or (v_top is not null and old.version < v_top);
  if tg_op = 'DELETE' then
    if v_frozen then
      raise exception '% version % is signed or superseded and cannot be deleted; draft a new version', tg_table_name, old.version using errcode = '23514';
    end if;
    return old;
  end if;
  if v_frozen and (new.version is distinct from old.version or new.rules is distinct from old.rules or new.effective_from is distinct from old.effective_from) then
    raise exception '% version % is signed or superseded and cannot be edited; draft a new version', tg_table_name, old.version using errcode = '23514';
  end if;
  -- approved_by may go to null (the foreign key action when the signer's profile is deleted); it may never change to someone else
  if old.approved_at is not null and (new.approved_at is distinct from old.approved_at or (new.approved_by is distinct from old.approved_by and new.approved_by is not null)) then
    raise exception 'a signed % keeps its signature', tg_table_name using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.frozen_config_guard() from public, anon, authenticated;

create trigger frozen_config_guard before insert or update or delete on public.queue_task_layer_config
  for each row execute function private.frozen_config_guard();
create trigger frozen_config_guard before insert or update or delete on public.paging_delivery_config
  for each row execute function private.frozen_config_guard();
create trigger refuse_superseded_activation before update of is_active on public.queue_task_layer_config
  for each row when (new.is_active and not old.is_active) execute function private.refuse_activating_superseded_version();
create trigger refuse_superseded_activation before update of is_active on public.paging_delivery_config
  for each row when (new.is_active and not old.is_active) execute function private.refuse_activating_superseded_version();

-- ---------------------------------------------------------------------------
-- 2. sign_queue_task_layer_config
-- ---------------------------------------------------------------------------
-- The task layer reads these keys on every task; a draft missing one would break task creation the moment it went live. Every test is
-- wrapped in coalesce(..., false): jsonb_typeof of a missing key is NULL, and a NULL result would read as "not invalid" at the caller.
create function private.task_layer_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
begin
  return coalesce(jsonb_typeof(r) = 'object'
    and jsonb_typeof(r -> 'lead_window_cap_fraction') = 'number'
    and (r ->> 'lead_window_cap_fraction')::numeric > 0 and (r ->> 'lead_window_cap_fraction')::numeric <= 1
    and jsonb_typeof(r -> 'escalated_non_red_any_eligible') = 'boolean'
    and jsonb_typeof(r -> 'handback_also_excludes_task_for') = 'array'
    and jsonb_typeof(r -> 'escalation_alert') = 'object'
    and jsonb_typeof(r #> '{escalation_alert,immediate_max_class}') = 'number'
    and jsonb_typeof(r #> '{escalation_alert,immediate_channels}') = 'array'
    and jsonb_typeof(r #> '{escalation_alert,notice_channels}') = 'array'
    and jsonb_typeof(r #> '{completion,contact_attempts,min_attempts}') = 'number'
    and jsonb_typeof(r #> '{completion,note_max_chars}') = 'number'
    and jsonb_typeof(r #> '{completion,legacy_kind_types}') = 'array'
    and jsonb_typeof(r #> '{watchdog,job_max_age_minutes,sweep-clinical-tasks}') = 'number'
    and jsonb_typeof(r #> '{watchdog,job_max_age_minutes,expire-task-claims}') = 'number'
    and jsonb_typeof(r #> '{completion,default_codes}') = 'array'
    and jsonb_typeof(r #> '{completion,codes_by_type}') = 'object'
    and jsonb_typeof(r #> '{watchdog,job_max_age_minutes}') = 'object'
    and jsonb_typeof(r #> '{watchdog,class_warning_minutes}') = 'object', false);
exception when others then
  return false;
end;
$$;
revoke all on function private.task_layer_rules_valid(jsonb) from public, anon, authenticated;

-- Signing the version already in force records the CMO's acceptance and changes no behaviour. Signing a NEWER draft also makes it the
-- version in force and retires the old one (which stays on record). An older version is never made live again.
create function public.sign_queue_task_layer_config(p_version integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.queue_task_layer_config%rowtype; v_live integer;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can sign the task layer configuration' using errcode = '42501'; end if;
  select * into c from public.queue_task_layer_config where version = p_version for update;
  if not found then raise exception 'no such task layer configuration version' using errcode = 'P0002'; end if;
  if c.approved_at is not null then raise exception 'that version is already signed' using errcode = '23514'; end if;
  if not private.task_layer_rules_valid(c.rules) then
    raise exception 'that version is missing a setting the task layer needs, so it cannot be signed; ask for a corrected new version' using errcode = '23514';
  end if;
  if not c.is_active then
    select max(version) into v_live from public.queue_task_layer_config where is_active;
    if v_live is not null and p_version < v_live then
      raise exception 'that version is older than the version in force; draft a new version instead' using errcode = '23514';
    end if;
    update public.queue_task_layer_config set is_active = false where is_active and version <> p_version;
  end if;
  update public.queue_task_layer_config set approved_at = now(), approved_by = (select auth.uid()), is_active = true where version = p_version;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values ((select organisation_id from public.profiles where id = (select auth.uid())), (select auth.uid()), 'queue_task_layer_config.signed', 'queue_task_layer_config', c.id,
            jsonb_build_object('version', p_version, 'was_active', c.is_active));
end;
$$;
revoke all on function public.sign_queue_task_layer_config(integer) from public, anon, authenticated;
grant execute on function public.sign_queue_task_layer_config(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. paging_delivery_config activation with the pre-sign checklist
-- ---------------------------------------------------------------------------
-- Who is still not ready, using the test-page window of the version being activated (not of the version in force). Same three
-- objective gaps as private.on_call_objective_gaps. Test clinicians (profiles.is_test) are not counted. Reads the CMO's organisation.
create function private.paging_activation_gaps(p_window_days integer) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('clinician_id', g.profile_id, 'name', g.full_name, 'gaps', to_jsonb(g.gaps)) order by g.full_name), '[]'::jsonb)
  from (
    select cs.profile_id, cs.full_name,
           array_remove(array[
             case when not exists (select 1 from public.push_subscriptions s where s.profile_id = cs.profile_id and s.disabled_at is null) then 'push_subscription' end,
             case when not exists (select 1 from auth.users u where u.id = cs.profile_id and u.email is not null and u.email_confirmed_at is not null) then 'verified_email' end,
             case when not exists (select 1 from public.page_tests t where t.clinician_id = cs.profile_id and t.acknowledged_at is not null
                                     and t.acknowledged_at > now() - make_interval(days => p_window_days)) then 'test_page' end
           ], null) as gaps
      from public.clinical_staff cs
      join public.profiles p on p.id = cs.profile_id
     where cs.organisation_id = (select pr.organisation_id from public.profiles pr where pr.id = (select auth.uid()))
       and cs.active and cs.status = 'active' and cs.profile_id is not null and not p.is_test and not cs.is_test
       and private.has_competency(cs.profile_id, 'on_call')
  ) g
  where array_length(g.gaps, 1) > 0
$$;
revoke all on function private.paging_activation_gaps(integer) from public, anon, authenticated;

create function private.paging_on_call_clinician_count() returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::integer
    from public.clinical_staff cs join public.profiles p on p.id = cs.profile_id
   where cs.organisation_id = (select pr.organisation_id from public.profiles pr where pr.id = (select auth.uid()))
     and cs.active and cs.status = 'active' and cs.profile_id is not null and not p.is_test and not cs.is_test
     and private.has_competency(cs.profile_id, 'on_call')
$$;
revoke all on function private.paging_on_call_clinician_count() from public, anon, authenticated;

-- The checklist as a read, for the hub panel: {version, ready, reasons[{code, clinician_id?, name?, gaps?}], on_call_count, window_days}.
create function public.paging_delivery_activation_check(p_version integer) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  c public.paging_delivery_config%rowtype;
  v_days integer;
  v_gaps jsonb;
  v_count integer;
  v_reasons jsonb := '[]'::jsonb;
  g jsonb;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can check the paging configuration' using errcode = '42501'; end if;
  select * into c from public.paging_delivery_config where version = p_version;
  if not found then raise exception 'no such paging delivery configuration version' using errcode = 'P0002'; end if;
  if c.approved_at is not null then v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code', 'already_signed')); end if;
  if c.is_active then v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code', 'already_in_force')); end if;
  v_days := coalesce((c.rules ->> 'readiness_test_page_days')::integer, 7);
  v_count := private.paging_on_call_clinician_count();
  if v_count = 0 then v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code', 'no_on_call_clinicians')); end if;
  v_gaps := private.paging_activation_gaps(v_days);
  for g in select * from jsonb_array_elements(v_gaps) loop
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code', 'clinician_not_ready', 'clinician_id', g -> 'clinician_id', 'name', g -> 'name', 'gaps', g -> 'gaps'));
  end loop;
  return jsonb_build_object('version', p_version, 'ready', jsonb_array_length(v_reasons) = 0, 'reasons', v_reasons, 'on_call_count', v_count, 'window_days', v_days);
end;
$$;
revoke all on function public.paging_delivery_activation_check(integer) from public, anon, authenticated;
grant execute on function public.paging_delivery_activation_check(integer) to authenticated;

-- Activates a newer, unsigned version ONLY when the checklist is met. Returns {activated, reasons}. When not met nothing changes.
create function public.activate_paging_delivery_config(p_version integer) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare c public.paging_delivery_config%rowtype; v_check jsonb; v_live integer;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can activate the paging delivery configuration' using errcode = '42501'; end if;
  select * into c from public.paging_delivery_config where version = p_version for update;
  if not found then raise exception 'no such paging delivery configuration version' using errcode = 'P0002'; end if;
  if c.approved_at is not null then raise exception 'that version is already signed' using errcode = '23514'; end if;
  if c.is_active then raise exception 'that version is already in force' using errcode = '23514'; end if;
  select max(version) into v_live from public.paging_delivery_config where is_active;
  if v_live is not null and p_version < v_live then
    raise exception 'that version is older than the version in force; draft a new version instead' using errcode = '23514';
  end if;
  v_check := public.paging_delivery_activation_check(p_version);
  if not (v_check ->> 'ready')::boolean then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
      values ((select organisation_id from public.profiles where id = (select auth.uid())), (select auth.uid()), 'paging_delivery_config.activation_refused', 'paging_delivery_config', c.id,
              jsonb_build_object('version', p_version, 'reason_count', jsonb_array_length(v_check -> 'reasons')));
    return jsonb_build_object('activated', false, 'reasons', v_check -> 'reasons');
  end if;
  update public.paging_delivery_config set is_active = false where is_active and version <> p_version;
  update public.paging_delivery_config set approved_at = now(), approved_by = (select auth.uid()), is_active = true where version = p_version;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values ((select organisation_id from public.profiles where id = (select auth.uid())), (select auth.uid()), 'paging_delivery_config.activated', 'paging_delivery_config', c.id,
            jsonb_build_object('version', p_version, 'on_call_count', v_check -> 'on_call_count'));
  return jsonb_build_object('activated', true, 'reasons', '[]'::jsonb);
end;
$$;
revoke all on function public.activate_paging_delivery_config(integer) from public, anon, authenticated;
grant execute on function public.activate_paging_delivery_config(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. OQ-452: heartbeat facts for /api/health/deep (service role only)
-- ---------------------------------------------------------------------------
-- Raw ages and limits only; the route decides. No names of people, no patient data. A job or component with no heartbeat row at all is
-- reported with a null age so the route can treat it as failing (the rows are seeded when the task layer applied; a missing one is a fault).
create function public.platform_deep_health() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_stale integer := coalesce(private.paging_delivery_rule('engine_heartbeat_stale_seconds'), 120);
  v_jobs jsonb := coalesce(private.task_layer_setting('watchdog') -> 'job_max_age_minutes', '{}'::jsonb);
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'queue_jobs', (
      select coalesce(jsonb_agg(jsonb_build_object('job', j.job, 'age_seconds', floor(extract(epoch from (now() - h.last_run_at)))::integer, 'max_age_seconds', j.max_seconds) order by j.job), '[]'::jsonb)
        from (select key as job, ((value #>> '{}')::integer * 60) as max_seconds from jsonb_each(v_jobs)
              union all select 'queue-watchdog', 25 * 60) j
        left join public.queue_job_heartbeats h on h.job_name = j.job),
    'paging', (
      select coalesce(jsonb_agg(jsonb_build_object('component', c.component, 'age_seconds', floor(extract(epoch from (now() - h.last_seen_at)))::integer, 'max_age_seconds', v_stale) order by c.component), '[]'::jsonb)
        from (values ('sweep_pages'), ('process_events'), ('reconciler')) c(component)
        left join public.paging_heartbeats h on h.component = c.component),
    'open_sev1', (select count(*) from public.ops_incidents where severity = 'sev1' and status in ('open', 'investigating', 'mitigated')));
end;
$$;
revoke all on function public.platform_deep_health() from public, anon, authenticated;
grant execute on function public.platform_deep_health() to service_role;

-- ---------------------------------------------------------------------------
-- 5. Self-check
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public.sign_queue_task_layer_config(integer)', 'public.paging_delivery_activation_check(integer)', 'public.activate_paging_delivery_config(integer)',
                           'public.platform_deep_health()', 'private.paging_activation_gaps(integer)', 'private.paging_on_call_clinician_count()',
                           'private.task_layer_rules_valid(jsonb)', 'private.frozen_config_guard()'] loop
    if has_function_privilege('anon', f::regprocedure, 'EXECUTE') then raise exception 'OQ-451/452: % is executable by anon', f; end if;
  end loop;
  if has_function_privilege('authenticated', 'public.platform_deep_health()'::regprocedure, 'EXECUTE') then raise exception 'OQ-452: platform_deep_health is callable by authenticated'; end if;
  if not has_function_privilege('authenticated', 'public.sign_queue_task_layer_config(integer)'::regprocedure, 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.activate_paging_delivery_config(integer)'::regprocedure, 'EXECUTE')
     or not has_function_privilege('service_role', 'public.platform_deep_health()'::regprocedure, 'EXECUTE') then
    raise exception 'OQ-451/452: an expected grant is missing';
  end if;
  if exists (select 1 from public.queue_task_layer_config where approved_at is not null) or exists (select 1 from public.paging_delivery_config where approved_at is not null) then
    raise exception 'OQ-451: this migration must not sign anything';
  end if;
  if exists (select 1 from public.queue_task_layer_config where not private.task_layer_rules_valid(rules)) then
    raise exception 'OQ-451: an existing task layer version fails the validity check';
  end if;
end $$;
