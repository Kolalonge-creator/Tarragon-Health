-- S78b: versioned response-time targets and the breach path (spec 23.16, CMO decision S-9).
--
-- Decision S-9: do NOT publish numbers yet. So this builds the configuration, the breach record and the escalation, and nothing that
-- shows a number to a patient. The patient screen carries a plain-language promise and the emergency guidance (apps/web), and a patient
-- whose reply or appointment is running late gets one plain notice. Turning numbers on later needs a signed config version, not code.
--
--   * response_time_config: versioned, PROPOSED, owner CMO, mirrored as response_time.targets in packages/shared. Version 1 is seeded
--     INACTIVE and unsigned: until the CMO signs and activates a version, the sweep below does nothing at all and reads no number.
--   * response_time_breaches: one row per (kind, subject), written only by the sweep. Staff read (CMO and admin); never a patient.
--   * private.sweep_response_time_breaches() (cron, every 5 minutes): reads ONLY the active config. For written questions, amber
--     reviews and appointment starts that passed their target it records the breach, tells the clinical lead (neutral wording, one notice
--     per sweep per organisation), keeps one open ops incident per kind (sev3), and sends the patient one plain in-app notice (not more than
--     one per patient per cooldown). Rows with is_test are excluded (INV-13).
--   * notification template: response_slower_notice (patient, neutral, INV-07). The lead is told through the existing credential_notice path.
--
-- No existing function is redefined. No row exists before this migration, so no count is needed.

create table public.response_time_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  note           text,
  created_at     timestamptz not null default now()
);
create unique index response_time_config_one_active on public.response_time_config (is_active) where is_active;

-- every key is required and a positive whole number: a missing key would make a comparison null and the sweep silently flag nothing
create function private.response_time_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare k text;
begin
  if jsonb_typeof(r) <> 'object' then return false; end if;
  foreach k in array array['written_question_minutes', 'amber_review_minutes', 'appointment_start_late_minutes', 'lookback_days', 'patient_notice_cooldown_hours'] loop
    if (r ->> k) is null or (r ->> k) !~ '^[0-9]+$' or (r ->> k)::integer < 1 then return false; end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;
revoke all on function private.response_time_rules_valid(jsonb) from public, anon, authenticated;
alter table public.response_time_config add constraint response_time_config_rules_valid check (private.response_time_rules_valid(rules));

-- response-time-rules-begin
insert into public.response_time_config (version, is_active, effective_from, rules, note) values (1, false, '2026-10-07', $json$
{
  "written_question_minutes": 1440,
  "amber_review_minutes": 1440,
  "appointment_start_late_minutes": 15,
  "lookback_days": 7,
  "patient_notice_cooldown_hours": 12
}
$json$::jsonb, 'S78b PROPOSED, unsigned and inactive (CMO decision S-9: no numbers are published yet). Spec 23.16 ranges are written questions 1 to 24 hours by type, live consultations within 5 to 60 minutes of the booked time, amber reviews within 24 hours; these are the upper ends, for the CMO to set.');
-- response-time-rules-end

alter table public.response_time_config enable row level security;
revoke all on public.response_time_config from public, anon, authenticated;
grant select on public.response_time_config to authenticated;
create policy response_time_config_read on public.response_time_config for select to authenticated using (private.task_staff_reader());

create function private.response_time_setting(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules -> p_key from public.response_time_config where is_active; $$;
revoke all on function private.response_time_setting(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Breach record
-- ---------------------------------------------------------------------------
create table public.response_time_breaches (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  kind            text not null check (kind in ('written_question', 'amber_review', 'appointment_start')),
  subject_id      uuid not null,
  patient_id      uuid references public.profiles (id) on delete set null,
  target_minutes  integer not null check (target_minutes > 0),
  config_version  integer not null,
  breached_at     timestamptz not null default now(),
  patient_notified boolean not null default false,
  is_test         boolean not null default false,
  unique (kind, subject_id)
);
create index response_time_breaches_org_idx on public.response_time_breaches (organisation_id, breached_at desc);
alter table public.response_time_breaches enable row level security;
revoke all on public.response_time_breaches from public, anon, authenticated;
grant select on public.response_time_breaches to authenticated;
-- staff aggregate reads only; a patient never reads a breach row
create policy response_time_breaches_read on public.response_time_breaches for select to authenticated
  using (private.task_staff_reader() and organisation_id = private.caller_org());

-- ---------------------------------------------------------------------------
-- Templates (neutral, in-app only, never SMS: D-12)
-- ---------------------------------------------------------------------------
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('response_slower_notice', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'scheduled', 'We are slower than usual; if this is urgent use emergency care.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('response_slower_notice', 'en', 'in_app', 'We are slower than usual', 'We are taking longer than usual to get back to you. If this is urgent, please use emergency care now.')
on conflict (template_key, locale, channel) do nothing;

-- ---------------------------------------------------------------------------
-- The sweep: reads only the ACTIVE config
-- ---------------------------------------------------------------------------
create function private.sweep_response_time_breaches() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ver integer;
  v_wq integer; v_amber integer; v_appt integer; v_look integer; v_cool integer;
  r record;
  v_new integer := 0;
  v_notified integer := 0;
  v_errors integer := 0;
  v_orgs uuid[] := '{}';
  v_org uuid;
  v_ref text;
begin
  select version into v_ver from public.response_time_config where is_active;
  if v_ver is null then return jsonb_build_object('active', false, 'new', 0); end if;     -- no signed targets: nothing is read, nothing is flagged
  v_wq := (private.response_time_setting('written_question_minutes') #>> '{}')::integer;
  v_amber := (private.response_time_setting('amber_review_minutes') #>> '{}')::integer;
  v_appt := (private.response_time_setting('appointment_start_late_minutes') #>> '{}')::integer;
  v_look := (private.response_time_setting('lookback_days') #>> '{}')::integer;
  v_cool := (private.response_time_setting('patient_notice_cooldown_hours') #>> '{}')::integer;

  for r in
    -- written questions still waiting for an answer
    select 'written_question'::text as kind, c.id as subject_id, c.organisation_id, c.patient_id, v_wq as target
      from public.async_consults c
     where not c.is_test and c.status in ('submitted', 'in_review') and c.answered_at is null
       and c.created_at > now() - make_interval(days => v_look) and c.created_at + make_interval(mins => v_wq) <= now()
    union all
    -- amber reviews not completed
    select 'amber_review', t.id, t.organisation_id, t.patient_id, v_amber
      from public.clinical_tasks t
     where not t.is_test and t.type = 'amber_bp_review' and t.state not in ('completed', 'cancelled')
       and t.created_at > now() - make_interval(days => v_look) and t.created_at + make_interval(mins => v_amber) <= now()
    union all
    -- appointments whose start is late: still not started this long after the booked time
    select 'appointment_start', a.id, a.organisation_id, a.patient_id, v_appt
      from public.appointments a join public.profiles p on p.id = a.patient_id
     where not p.is_test and a.status in ('booked', 'confirmed', 'checked_in')
       and a.scheduled_for > now() - make_interval(days => v_look) and a.scheduled_for + make_interval(mins => v_appt) <= now()
  loop
    begin
      insert into public.response_time_breaches (organisation_id, kind, subject_id, patient_id, target_minutes, config_version)
      values (r.organisation_id, r.kind, r.subject_id, r.patient_id, r.target, v_ver)
      on conflict (kind, subject_id) do nothing;
      if found then
        v_new := v_new + 1;
        if not (r.organisation_id = any (v_orgs)) then v_orgs := v_orgs || r.organisation_id; end if;
        v_ref := 'response_time_breach:' || r.kind || ':' || r.organisation_id;
        if exists (select 1 from public.ops_incidents where external_reference = v_ref and status not in ('resolved', 'closed')) then
          update public.ops_incidents set summary = 'Replies or visits are running later than the target. See the response-time breach record.' where external_reference = v_ref and status not in ('resolved', 'closed');
        else
          insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
          values (r.organisation_id, 'operational', 'sev3', 'A response target was missed',
                  'Replies or visits are running later than the target. See the response-time breach record.', v_ref, now() + interval '1 day', now() + interval '3 days');
        end if;
        -- one plain notice to the patient, never naming a condition, a number or a person; at most one per cooldown
        if r.patient_id is not null and not exists (
             select 1 from public.notifications n where n.recipient_id = r.patient_id and n.template = 'response_slower_notice'
                and n.created_at > now() - make_interval(hours => v_cool)) then
          perform private.written_care_notify(r.patient_id, r.organisation_id, 'response_slower_notice', '{}'::jsonb);
          update public.response_time_breaches set patient_notified = true where kind = r.kind and subject_id = r.subject_id;
          v_notified := v_notified + 1;
        end if;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (r.organisation_id, 'response_time_sweep.error', r.kind, r.subject_id, jsonb_build_object('error', sqlerrm));
    end;
  end loop;

  -- the clinical lead hears once per organisation per sweep that found something new, in neutral words
  foreach v_org in array v_orgs loop
    perform private.notify_clinical_leads(v_org, false, 'A response target was missed',
      'Some replies or visits are running later than the target. Open the quality page to see where.', '{}'::jsonb);
  end loop;
  return jsonb_build_object('active', true, 'config_version', v_ver, 'new', v_new, 'patients_notified', v_notified, 'errors', v_errors);
end;
$$;
revoke all on function private.sweep_response_time_breaches() from public, anon, authenticated;

select cron.schedule('sweep-response-time-breaches', '*/5 * * * *', $$ select private.sweep_response_time_breaches(); $$);

-- A lead's read of the recent breaches: counts by kind, no patient reference.
create function public.response_time_breach_summary(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := private.caller_org();
begin
  if (select auth.uid()) is null or v_org is null or not private.task_staff_reader() then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_days is null or p_days < 1 or p_days > 366 then raise exception 'bad arguments' using errcode = '22023'; end if;
  return jsonb_build_object('days', p_days, 'targets_active', exists (select 1 from public.response_time_config where is_active),
    'by_kind', coalesce((select jsonb_object_agg(k.kind, k.n) from (select b.kind, count(*) as n from public.response_time_breaches b
        where b.organisation_id = v_org and not b.is_test and b.breached_at > now() - make_interval(days => p_days) group by b.kind) k), '{}'::jsonb));
end;
$$;
revoke all on function public.response_time_breach_summary(integer) from public, anon, authenticated;
grant execute on function public.response_time_breach_summary(integer) to authenticated;

do $$
begin
  if exists (select 1 from public.response_time_config where is_active) then raise exception 'S78b: no response-time config may be active (CMO decision S-9: unsigned)'; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('response_time_config', 'response_time_breaches')
             and (grantee in ('anon', 'PUBLIC') or (grantee = 'authenticated' and privilege_type <> 'SELECT'))) then
    raise exception 'S78b: wrong table privileges on a response-time table';
  end if;
  if has_function_privilege('anon', 'private.sweep_response_time_breaches()', 'EXECUTE') or has_function_privilege('anon', 'public.response_time_breach_summary(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.sweep_response_time_breaches()', 'EXECUTE') then
    raise exception 'S78b: a response-time function is callable by the wrong role';
  end if;
  if not exists (select 1 from cron.job where jobname = 'sweep-response-time-breaches') then raise exception 'S78b: sweep not scheduled'; end if;
end $$;
