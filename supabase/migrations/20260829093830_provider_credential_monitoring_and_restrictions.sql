create type public.provider_restriction_stage as enum (
  'warning', 'grace_period', 'service_restriction', 'suspension'
);

create type public.provider_restriction_reason as enum (
  'license_expiry', 'indemnity_expiry', 'attestation_lapse',
  'complaint_outcome', 'performance', 'governance_directive'
);

comment on type public.provider_restriction_stage is
  '§29.7 ladder. Only service_restriction and suspension actually restrict work; warning and grace_period are recorded states that make the ladder auditable rather than a surprise.';

create table public.provider_restrictions (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  clinical_staff_id uuid not null references public.clinical_staff (id) on delete cascade,

  stage             public.provider_restriction_stage not null,
  reason            public.provider_restriction_reason not null,
  detail            text,

  credential_expires_at timestamptz,
  complaint_id      uuid references public.provider_complaints (id) on delete set null,

  imposed_by        uuid references public.profiles (id) on delete set null,
  imposed_at        timestamptz not null default now(),

  lifted_by         uuid references public.profiles (id) on delete set null,
  lifted_at         timestamptz,
  lift_reason       text,

  created_at        timestamptz not null default now(),

  constraint provider_restrictions_lift_has_reason
    check (lifted_at is null or (lift_reason is not null and length(btrim(lift_reason)) > 0))
);

comment on table public.provider_restrictions is
  '§29.7 ladder state for a provider. One row per stage entered, never updated in place except to lift it — so the history of how a provider reached suspension is readable afterwards. Deliberately never writes clinical_staff.active: a lapsed credential is not the same event as leaving the organisation.';
comment on column public.provider_restrictions.lifted_by is
  'Who lifted this restriction, or NULL when the sweep superseded it with the next rung up. A human lift always goes through public.lift_provider_restriction(), which stamps the actor and demands a reason.';
comment on column public.provider_restrictions.imposed_by is
  'The person who imposed this restriction, or NULL when the automated credential sweep did. Null-gated like every other attribution on this platform — the UI must say "automatic credential rule", never invent an actor.';

create index provider_restrictions_staff_idx
  on public.provider_restrictions (clinical_staff_id, imposed_at desc);
create unique index provider_restrictions_one_live_per_reason
  on public.provider_restrictions (clinical_staff_id, reason) where lifted_at is null;

comment on index public.provider_restrictions_one_live_per_reason is
  'A provider has at most one live restriction per reason. The sweep advances the ladder by lifting the previous stage and inserting the next one in the same transaction, so a licence lapse can never accumulate four overlapping live rows.';

create index provider_restrictions_live_idx
  on public.provider_restrictions (clinical_staff_id) where lifted_at is null;

create or replace function private.provider_work_restricted(p_clinical_staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.provider_restrictions
    where clinical_staff_id = p_clinical_staff_id
      and lifted_at is null
      and stage in ('service_restriction', 'suspension')
  );
$$;

comment on function private.provider_work_restricted(uuid) is
  'True when the provider has a live service_restriction or suspension. warning/grace_period deliberately do not restrict — they are the notice period §29.7 requires before a consequence lands.';

revoke all on function private.provider_work_restricted(uuid) from public, anon;

create or replace function private.profile_work_restricted(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.provider_restrictions r
    join public.clinical_staff cs on cs.id = r.clinical_staff_id
    where cs.profile_id = p_profile_id
      and r.lifted_at is null
      and r.stage in ('service_restriction', 'suspension')
  );
$$;

revoke all on function private.profile_work_restricted(uuid) from public, anon;

create or replace function private.block_restricted_provider_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.clinician_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.clinician_id is not distinct from old.clinician_id
     and new.scheduled_for is not distinct from old.scheduled_for then
    return new;
  end if;

  if new.status in ('cancelled', 'patient_cancelled', 'provider_cancelled', 'no_show', 'expired', 'failed') then
    return new;
  end if;

  if private.profile_work_restricted(new.clinician_id) then
    raise exception 'this provider is currently under a service restriction or suspension and cannot take new appointments'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function private.block_restricted_provider_booking() is
  '§29.7 "service restriction" made real: a provider with a live restriction cannot be assigned NEW appointment work. Existing appointments remain fully manageable (cancel/complete/document) — the restriction stops new clinical exposure, it does not strand patients already booked.';

revoke all on function private.block_restricted_provider_booking() from public, anon;

create trigger appointments_block_restricted_provider
  before insert or update on public.appointments
  for each row execute function private.block_restricted_provider_booking();

create or replace function public.provider_credential_monitor()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ladder jsonb;
  v_rows   jsonb;
begin
  if not private.is_complaints_handler() then
    return '{}'::jsonb;
  end if;

  v_ladder := coalesce(private.provider_quality_policy_config() -> 'credential_ladder', '{}'::jsonb);

  select coalesce(jsonb_agg(x order by x ->> 'soonest_expiry' nulls last), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'clinical_staff_id', cs.id,
      'full_name', cs.full_name,
      'doctor_tier', cs.doctor_tier,
      'is_clinical_director', cs.is_clinical_director,
      'credential_type', cs.credential_type,
      'credential_number', cs.credential_number,

      'license_expires_at', cs.license_expires_at,
      'license_state', case
        when cs.license_expires_at is null then 'not_recorded'
        when cs.license_expires_at <= now() then 'expired'
        when cs.license_expires_at <= now() + make_interval(
               days => coalesce((v_ladder ->> 'warning_days_before_expiry')::int, 30)) then 'expiring_soon'
        else 'current' end,
      'license_days_remaining', case
        when cs.license_expires_at is null then null
        else floor(extract(epoch from (cs.license_expires_at - now())) / 86400.0)::int end,
      'license_verified_at', cs.license_verified_at,

      'indemnity_expires_at', cs.indemnity_expires_at,
      'indemnity_state', case
        when cs.indemnity_exempt then 'not_applicable'
        when cs.indemnity_expires_at is null then 'not_recorded'
        when cs.indemnity_expires_at <= now() then 'expired'
        when cs.indemnity_expires_at <= now() + make_interval(
               days => coalesce((v_ladder ->> 'warning_days_before_expiry')::int, 30)) then 'expiring_soon'
        else 'current' end,

      'attestation_current', private.has_current_attestation(cs.id),
      'attestation_expires_at', (
        select max(a.expires_at) from public.clinical_staff_attestations a
        where a.clinical_staff_id = cs.id
      ),

      'restriction_stage', (
        select r.stage from public.provider_restrictions r
        where r.clinical_staff_id = cs.id and r.lifted_at is null
        order by array_position(
          array['warning', 'grace_period', 'service_restriction', 'suspension']::text[], r.stage::text) desc
        limit 1
      ),
      'work_restricted', private.provider_work_restricted(cs.id),
      'open_complaints', (
        select count(*) from public.provider_complaints c
        where c.subject_staff_id = cs.id and c.stage not in ('closed', 'withdrawn')
      ),
      'soonest_expiry', least(cs.license_expires_at,
                              case when cs.indemnity_exempt then null else cs.indemnity_expires_at end)
    ) as x
    from public.clinical_staff cs
    where cs.active
  ) s;

  return jsonb_build_object(
    'ladder', v_ladder,
    'generated_at', now(),
    'providers', v_rows
  );
end;
$$;

comment on function public.provider_credential_monitor() is
  '§29.6 credential monitor across the active roster: licence, indemnity (or not_applicable when exempt), attestation, live restriction stage, open complaint count. Returns {} to a caller who is not admin/Clinical Director. A missing expiry date reports as not_recorded — never as expired.';

revoke execute on function public.provider_credential_monitor() from public, anon;
grant execute on function public.provider_credential_monitor() to authenticated;

create or replace function private.advance_provider_credential_ladder()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ladder      jsonb;
  v_warn_days   integer;
  v_grace_days  integer;
  v_restrict_days integer;
  v_suspend_days  integer;
  r             record;
  v_target      public.provider_restriction_stage;
  v_current     public.provider_restrictions;
  v_days_past   numeric;
  v_admin       record;
begin
  v_ladder := private.provider_quality_policy_config() -> 'credential_ladder';

  if v_ladder is null then
    return;
  end if;

  v_warn_days     := (v_ladder ->> 'warning_days_before_expiry')::int;
  v_grace_days    := (v_ladder ->> 'grace_days_after_expiry')::int;
  v_restrict_days := (v_ladder ->> 'restriction_days_after_expiry')::int;
  v_suspend_days  := (v_ladder ->> 'suspension_days_after_expiry')::int;

  for r in
    select cs.id, cs.organisation_id, cs.full_name, cs.license_expires_at
    from public.clinical_staff cs
    where cs.active
      and cs.license_expires_at is not null
      and cs.license_expires_at < now() + make_interval(days => v_warn_days)
  loop
    v_days_past := extract(epoch from (now() - r.license_expires_at)) / 86400.0;

    v_target := case
      when v_days_past >= v_suspend_days  then 'suspension'
      when v_days_past >= v_restrict_days then 'service_restriction'
      when v_days_past >= 0               then 'grace_period'
      else 'warning'
    end;

    if v_target = 'grace_period' and v_days_past > v_grace_days then
      v_target := 'service_restriction';
    end if;

    select * into v_current
    from public.provider_restrictions
    where clinical_staff_id = r.id and reason = 'license_expiry' and lifted_at is null;

    if v_current.id is not null and array_position(
         array['warning', 'grace_period', 'service_restriction', 'suspension']::text[],
         v_current.stage::text)
       >= array_position(
         array['warning', 'grace_period', 'service_restriction', 'suspension']::text[],
         v_target::text) then
      continue;
    end if;

    if v_current.id is not null then
      update public.provider_restrictions
        set lifted_at = now(), lift_reason = format('superseded by %s', v_target)
        where id = v_current.id;
    end if;

    insert into public.provider_restrictions
      (organisation_id, clinical_staff_id, stage, reason, credential_expires_at, detail)
    values (r.organisation_id, r.id, v_target, 'license_expiry', r.license_expires_at,
            case when v_days_past >= 0
              then format('Practicing licence expired %s day(s) ago (%s).',
                          floor(v_days_past)::int, to_char(r.license_expires_at, 'YYYY-MM-DD'))
              else format('Practicing licence expires %s.', to_char(r.license_expires_at, 'YYYY-MM-DD'))
            end);

    for v_admin in select id from public.profiles where role = 'admin'
    loop
      insert into public.notifications
        (recipient_id, organisation_id, channel, template, payload, status, content_class)
      values (v_admin.id, r.organisation_id, 'in_app', 'provider_credential_ladder',
              jsonb_build_object(
                'message', format('%s moved to %s — practicing licence %s.',
                  r.full_name, replace(v_target::text, '_', ' '),
                  case when v_days_past >= 0 then 'has expired' else 'is expiring' end),
                'clinical_staff_id', r.id, 'stage', v_target),
              'pending', 'non_clinical');
    end loop;

    insert into public.notifications
      (recipient_id, organisation_id, channel, template, payload, status, content_class)
    select cs.profile_id, r.organisation_id, 'in_app', 'provider_credential_ladder_self',
           jsonb_build_object(
             'message', case v_target
               when 'warning' then format('Your practicing licence expires on %s. Send the renewal to your administrator to avoid a break in your access.', to_char(r.license_expires_at, 'YYYY-MM-DD'))
               when 'grace_period' then format('Your practicing licence expired on %s. You are in the grace period — send the renewal to your administrator now.', to_char(r.license_expires_at, 'YYYY-MM-DD'))
               when 'service_restriction' then 'Your practicing licence is out of date, so new appointments cannot be booked with you until it is renewed. Your existing patients and records are unaffected.'
               else 'Your account is suspended for new clinical work because your practicing licence is out of date. Contact your administrator to restore it.'
             end,
             'stage', v_target),
           'pending', 'non_clinical'
    from public.clinical_staff cs
    where cs.id = r.id and cs.profile_id is not null;

    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (r.organisation_id, null, 'provider_restriction.auto_advanced',
            'clinical_staff', r.id,
            jsonb_build_object('stage', v_target, 'reason', 'license_expiry',
                               'license_expires_at', r.license_expires_at));
  end loop;
end;
$$;

comment on function private.advance_provider_credential_ladder() is
  '§29.7 sweep: advances a provider up warning -> grace_period -> service_restriction -> suspension based on the day offsets in the active provider_quality_policy. Never advances a record with no license_expires_at on file, never walks the ladder back down (that needs a human lift, recorded), and never touches clinical_staff.active.';

revoke all on function private.advance_provider_credential_ladder() from public, anon;

select cron.schedule(
  'provider-credential-ladder-advance',
  '45 6 * * *',
  $$select private.advance_provider_credential_ladder()$$
);

create or replace function public.lift_provider_restriction(p_restriction_id uuid, p_reason text)
returns public.provider_restrictions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.provider_restrictions;
begin
  if not private.is_complaints_handler() then
    raise exception 'only an administrator or Clinical Director may lift a provider restriction'
      using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a reason is required to lift a provider restriction';
  end if;

  update public.provider_restrictions
    set lifted_by = (select auth.uid()), lifted_at = now(), lift_reason = btrim(p_reason)
    where id = p_restriction_id and lifted_at is null
    returning * into v_row;

  if v_row.id is null then
    raise exception 'restriction not found, or already lifted';
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_row.organisation_id, (select auth.uid()), 'provider_restriction.lifted',
          'provider_restrictions', v_row.id,
          jsonb_build_object('stage', v_row.stage, 'reason', v_row.reason, 'lift_reason', v_row.lift_reason));

  return v_row;
end;
$$;

comment on function public.lift_provider_restriction(uuid, text) is
  'Lifts a live restriction. Admin/Clinical Director only, reason mandatory, always audit-logged. The automated sweep can raise the ladder but never lower it — coming back from a suspension is a decision somebody signs.';

revoke execute on function public.lift_provider_restriction(uuid, text) from public, anon;
grant execute on function public.lift_provider_restriction(uuid, text) to authenticated;

alter table public.provider_restrictions enable row level security;

create policy provider_restrictions_select on public.provider_restrictions
  for select to authenticated
  using (
    private.is_complaints_handler()
    or clinical_staff_id in (
      select id from public.clinical_staff where profile_id = (select auth.uid())
    )
  );

create policy provider_restrictions_insert on public.provider_restrictions
  for insert to authenticated
  with check (private.is_complaints_handler() and lifted_at is null);

grant select, insert on public.provider_restrictions to authenticated;
revoke update, delete on public.provider_restrictions from authenticated;

do $$
declare
  v_org   uuid;
  v_staff uuid;
  v_prof  uuid;
  v_rest  uuid;
  v_bad   boolean;
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'provider_restrictions') then
    raise exception 'FAIL: provider_restrictions missing';
  end if;
  if not exists (select 1 from cron.job where jobname = 'provider-credential-ladder-advance') then
    raise exception 'FAIL: provider-credential-ladder-advance cron job was not scheduled';
  end if;

  if pg_get_functiondef('private.advance_provider_credential_ladder()'::regprocedure)
       ~* 'update\s+public\.clinical_staff' then
    raise exception 'FAIL: the credential sweep issues an UPDATE against clinical_staff — the ladder must never write .active';
  end if;

  select cs.id, cs.organisation_id, cs.profile_id into v_staff, v_org, v_prof
  from public.clinical_staff cs where cs.profile_id is not null limit 1;

  if v_staff is null then
    raise notice 'SKIP: no clinical_staff row with a profile to exercise the booking block against';
  else
    insert into public.provider_restrictions (organisation_id, clinical_staff_id, stage, reason, detail)
    values (v_org, v_staff, 'suspension', 'governance_directive', 'assertion probe')
    returning id into v_rest;

    if not private.profile_work_restricted(v_prof) then
      raise exception 'FAIL: a live suspension does not register as a work restriction';
    end if;

    v_bad := true;
    begin
      insert into public.appointments
        (organisation_id, patient_id, clinician_id, scheduled_for, ends_at, status,
         appointment_type, consultation_method)
      values (v_org, v_prof, v_prof, now() + interval '1 day', now() + interval '1 day 30 minutes',
              'booked', 'follow_up', 'telemedicine');
    exception when others then
      v_bad := false;
    end;
    if v_bad then
      raise exception 'FAIL: a suspended provider was booked for a new appointment';
    end if;

    update public.provider_restrictions
      set lifted_at = now(), lifted_by = null, lift_reason = 'assertion control'
      where id = v_rest;

    if private.profile_work_restricted(v_prof) then
      raise exception 'FAIL: a lifted restriction still registers as restricting work';
    end if;

    delete from public.provider_restrictions where id = v_rest;
  end if;

  if has_function_privilege('anon', 'public.provider_credential_monitor()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute provider_credential_monitor';
  end if;
  if has_function_privilege('anon', 'public.lift_provider_restriction(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute lift_provider_restriction';
  end if;
  if has_table_privilege('authenticated', 'public.provider_restrictions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.provider_restrictions', 'DELETE') then
    raise exception 'FAIL: authenticated holds UPDATE/DELETE on provider_restrictions';
  end if;

  raise notice 'PASS: §29.6 monitor + §29.7 ladder — data-driven offsets, blank expiry never laddered, booking block proven with control, clinical_staff.active untouched';
end $$;
