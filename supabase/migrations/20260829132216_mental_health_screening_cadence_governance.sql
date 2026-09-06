-- Tarragon Health — Mental Health & Wellbeing Platform: a governed recurring
-- screening cadence (Module 46 §46.4/§46.5 follow-through). Previously
-- flagged as a Clinical-Director-signed decision rather than something to
-- hardcode unilaterally — this migration builds the governance mechanism
-- itself, on explicit ask, mirroring the existing signed-config pattern
-- (public.alert_rules / public.escalation_slas) rather than
-- medication_review_cadences' bare, unsigned 2-column shape, since this is
-- exactly the kind of protocol decision that pattern exists for.
--
-- Ships v1 active-but-unsigned, same precedent as escalation_slas v1 and
-- alert_rules v1 — a governed cadence value is available to the scheduler
-- immediately, and a Clinical Director formalises it later via
-- sign_mental_health_screening_cadences() without that gating whether the
-- feature works day one.

create table public.mental_health_screening_cadences (
  id           uuid primary key default gen_random_uuid(),
  version      integer not null,
  config       jsonb not null,
  notes        text,
  approved_by  uuid references public.clinical_staff (id),
  approved_at  timestamptz,
  is_active    boolean not null default false,
  created_at   timestamptz not null default now()
);

comment on column public.mental_health_screening_cadences.config is
  'jsonb array, one entry per instrument: {"instrument": "phq9", "standard_interval_months": 12, "followup_interval_months": 3}. standard_interval_months applies when the patient''s last screen was no/low concern; followup_interval_months applies after a moderate/high concern band (private.classify_mental_health_screen_concern) — re-screening sooner after a concerning result is standard practice. EPDS is deliberately absent: it is context-triggered (perinatal self-identification), not on a periodic cadence.';

create index mental_health_screening_cadences_active_idx
  on public.mental_health_screening_cadences (is_active) where is_active;

alter table public.mental_health_screening_cadences enable row level security;

create policy mental_health_screening_cadences_select on public.mental_health_screening_cadences
  for select to authenticated using (true);

-- Anyone (admin) can propose a draft version; only sign_mental_health_screening_cadences()
-- may activate one — same shape as alert_rules_insert.
create policy mental_health_screening_cadences_insert on public.mental_health_screening_cadences
  for insert to authenticated
  with check (private.is_admin() and approved_by is null and approved_at is null and is_active = false);

grant select, insert on public.mental_health_screening_cadences to authenticated;

insert into public.mental_health_screening_cadences (version, config, notes, is_active)
values (
  1,
  '[
    {"instrument": "phq9", "standard_interval_months": 12, "followup_interval_months": 3},
    {"instrument": "gad7", "standard_interval_months": 12, "followup_interval_months": 3},
    {"instrument": "auditc", "standard_interval_months": 12, "followup_interval_months": 6}
  ]'::jsonb,
  'Initial cadence: annual re-screen by default (matches the existing Annual Health Check cadence this ran on before §46.5), shortened to a follow-up interval after a moderate/high concern band. Ships active but unsigned — needs Clinical Director sign-off via sign_mental_health_screening_cadences() to formalise, not to function.',
  true
);

-- Fail-open reader: never blocks scheduling on missing/unsigned governance —
-- this is a scheduling nicety, not a safety gate (unlike escalation_slas'
-- reader, which fails loud because its call sites are safety-critical).
create or replace function private.mental_health_screening_cadence_months(
  p_instrument text,
  p_concern text
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select case
        when p_concern in ('moderate', 'high') then (entry ->> 'followup_interval_months')::integer
        else (entry ->> 'standard_interval_months')::integer
      end
      from public.mental_health_screening_cadences c, jsonb_array_elements(c.config) as entry
      where c.is_active and entry ->> 'instrument' = p_instrument
      limit 1
    ),
    12
  );
$$;

comment on function private.mental_health_screening_cadence_months(text, text) is
  'Fail-open reader for the governed cadence config — defaults to 12 months (annual) if no active config or matching instrument entry exists, so an unsigned/missing config never blocks scheduling.';

revoke all on function private.mental_health_screening_cadence_months(text, text) from public;

create or replace function public.sign_mental_health_screening_cadences(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
begin
  if not exists (select 1 from public.mental_health_screening_cadences where id = p_id) then
    raise exception 'Mental-health screening cadence version not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid()) and cs.active and cs.is_clinical_director
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can sign the mental-health screening cadence config';
  end if;

  update public.mental_health_screening_cadences set is_active = false where is_active and id <> p_id;
  update public.mental_health_screening_cadences set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  select cs.organisation_id, (select auth.uid()), 'mental_health_screening_cadences.signed',
         'mental_health_screening_cadences', p_id, jsonb_build_object('signed_by_clinical_staff', v_staff)
  from public.clinical_staff cs where cs.id = v_staff;

  return p_id;
end;
$$;

comment on function public.sign_mental_health_screening_cadences(uuid) is
  'Only an active Clinical Director may sign/activate a mental_health_screening_cadences version — deactivates every other version in the same statement, logs to audit_log. Mirrors sign_alert_rules().';

revoke all on function public.sign_mental_health_screening_cadences(uuid) from public, anon;
grant execute on function public.sign_mental_health_screening_cadences(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from public.mental_health_screening_cadences where is_active) then
    raise exception 'expected an active mental_health_screening_cadences row after seeding';
  end if;
  if private.mental_health_screening_cadence_months('phq9', 'high') is distinct from 3 then
    raise exception 'sabotage check failed: phq9 high concern should use the 3-month followup interval';
  end if;
  if private.mental_health_screening_cadence_months('auditc', 'none') is distinct from 12 then
    raise exception 'sabotage check failed: auditc no concern should use the 12-month standard interval';
  end if;
  if private.mental_health_screening_cadence_months('unknown_instrument', 'none') is distinct from 12 then
    raise exception 'sabotage check failed: an unmatched instrument should fail open to 12 months';
  end if;

  raise notice 'PASS: mental_health_screening_cadences governance + reader installed and seeded';
end $$;
