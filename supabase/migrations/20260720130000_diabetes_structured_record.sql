-- ===========================================================================
-- Diabetes Clinical Pathway — Sprint B: the structured self-monitoring record
-- ---------------------------------------------------------------------------
-- §10.1: "diabetes generates far more numeric data than hypertension (multiple
-- daily glucose readings, insulin doses, foot checks, ketones), which belongs
-- in a structured record — not a chat thread." Glucose + ketones already live
-- in vitals_readings; this adds the three remaining structured surfaces the
-- pathway logs: insulin doses, the daily foot self-check, and the sick-day log.
-- All patient-authored, org-scoped, RLS-gated like every other patient table;
-- a flagged foot problem raises a clinician_alert (foot red flag, §18.1).
-- ===========================================================================

-- --- G6: insulin dose logging (§10.1, §13.4, §19) --------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'insulin_type') then
    create type public.insulin_type as enum ('soluble', 'nph', 'premixed', 'analogue_rapid', 'analogue_long');
  end if;
end $$;

create table if not exists public.insulin_logs (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  insulin_type    public.insulin_type not null,
  units           numeric(5, 1) not null check (units > 0 and units <= 300),
  injected_at     timestamptz not null default now(),
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists insulin_logs_patient_idx on public.insulin_logs (patient_id, injected_at desc);
create index if not exists insulin_logs_org_idx on public.insulin_logs (organisation_id);

-- --- G8: daily foot self-check (§10.1, §18.1) ------------------------------
create table if not exists public.foot_self_checks (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  checked_at      timestamptz not null default now(),
  any_problem     boolean not null default false,
  -- e.g. {cut, blister, redness, swelling, colour_change, pain}
  findings        text[] not null default '{}',
  photo_url       text,
  note            text,
  -- The clinician_alert raised when any_problem = true (set by the trigger).
  clinician_alert_id uuid references public.clinician_alerts (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists foot_self_checks_patient_idx on public.foot_self_checks (patient_id, checked_at desc);
create index if not exists foot_self_checks_org_idx on public.foot_self_checks (organisation_id);

-- --- G9: sick-day log (§10.1, §17.4) ---------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'appetite_level') then
    create type public.appetite_level as enum ('normal', 'reduced', 'none');
  end if;
end $$;

create table if not exists public.sick_day_logs (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  started_on      date not null default (now() at time zone 'Africa/Lagos')::date,
  illness         text,
  appetite        public.appetite_level not null default 'normal',
  vomiting        boolean not null default false,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists sick_day_logs_patient_idx on public.sick_day_logs (patient_id, started_on desc);
create index if not exists sick_day_logs_org_idx on public.sick_day_logs (organisation_id);

-- --- updated_at triggers ----------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['insulin_logs', 'foot_self_checks', 'sick_day_logs'] loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t, t);
  end loop;
end $$;

-- --- RLS: patient owns their own rows; org clinical staff read all ----------
alter table public.insulin_logs enable row level security;
alter table public.foot_self_checks enable row level security;
alter table public.sick_day_logs enable row level security;

do $$
declare t text;
begin
  foreach t in array array['insulin_logs', 'foot_self_checks', 'sick_day_logs'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format($p$create policy %I_select on public.%I for select to authenticated
      using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))$p$, t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format($p$create policy %I_insert on public.%I for insert to authenticated
      with check ((patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
                  or private.is_org_staff(organisation_id))$p$, t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format($p$create policy %I_update on public.%I for update to authenticated
      using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
      with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))$p$, t, t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;

-- --- G8 red flag: a foot problem raises a same-day clinician alert (§18.1) --
-- BEFORE INSERT (SECURITY DEFINER) so a patient-authored row can write the
-- staff-only clinician_alert — same shape as handle_symptom_red_flag().
create or replace function private.handle_foot_self_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
begin
  if new.any_problem then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
    values (
      new.organisation_id,
      new.patient_id,
      'urgent_escalation',
      'open',
      'Priority: diabetic foot problem reported',
      format('Patient reported a foot problem on self-check%s.%s Assess urgently — new ulcer, spreading redness, black tissue or fever is an emergency (§18.1).',
             case when array_length(new.findings, 1) is not null then ' (' || array_to_string(new.findings, ', ') || ')' else '' end,
             case when new.note is not null then ' Note: ' || new.note else '' end),
      now() + interval '4 hours',
      3
    )
    returning id into v_alert_id;
    new.clinician_alert_id := v_alert_id;
  end if;
  return new;
end;
$$;

drop trigger if exists foot_self_checks_raise_alert on public.foot_self_checks;
create trigger foot_self_checks_raise_alert
  before insert on public.foot_self_checks
  for each row execute function private.handle_foot_self_check();
