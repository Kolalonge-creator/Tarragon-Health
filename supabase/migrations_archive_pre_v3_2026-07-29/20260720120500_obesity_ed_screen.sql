-- ============================================================================
-- Mandatory eating-disorder & mental-health screen (TH-CP-OB-001 §6.5, §16, §18)
--
-- The pathway's hardest safeguard: before any weight-loss plan, screen for an
-- eating disorder and mental-health risk. A POSITIVE screen must (a) raise a
-- clinician alert and (b) PAUSE weight-loss automatically — the system never
-- keeps pushing weight loss at someone who may be harmed by it (§16.3, §18.2).
--
-- Instrument: SCOFF (≥2 positive = screen positive) plus explicit mood /
-- self-harm / disordered-behaviour items. Can be completed by a clinician at
-- assessment or self-reported by the patient in-app; either way the auto-pause
-- and alert fire. Scoring + attribution are trigger-computed, never trusted
-- from the client.
-- ============================================================================

create table if not exists public.obesity_ed_screens (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  administered_by       uuid references public.clinical_staff (id) on delete set null,
  self_reported         boolean not null default false,
  -- SCOFF items.
  scoff_sick            boolean not null default false,  -- make yourself Sick when full
  scoff_control         boolean not null default false,  -- lost Control over eating
  scoff_one_stone       boolean not null default false,  -- lost >One stone in 3 months
  scoff_fat             boolean not null default false,   -- believe self Fat when others say thin
  scoff_food_dominates  boolean not null default false,  -- Food dominates life
  scoff_score           smallint not null default 0 check (scoff_score between 0 and 5),
  -- Explicit mental-health items (§6.5 / §18.1).
  self_harm_risk        boolean not null default false,
  low_mood              boolean not null default false,
  disordered_behaviours jsonb not null default '[]'::jsonb, -- binge, purging, restriction, driven_exercise, night_eating
  positive              boolean not null default false,
  clinician_alert_id    uuid references public.clinician_alerts (id) on delete set null,
  notes                 text,
  screened_at           timestamptz not null default now(),
  created_at            timestamptz not null default now()
);

create index if not exists obesity_ed_screens_patient_idx
  on public.obesity_ed_screens (patient_id, screened_at desc);
create index if not exists obesity_ed_screens_positive_idx
  on public.obesity_ed_screens (organisation_id, positive) where positive;

-- --- BEFORE INSERT: score, attribute, decide positivity (forge-proof) --------
create or replace function private.prepare_obesity_ed_screen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_staff uuid;
begin
  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = new.organisation_id
    and cs.active
  limit 1;
  new.administered_by := v_staff;
  new.self_reported := v_staff is null;

  new.scoff_score :=
    (new.scoff_sick)::int + (new.scoff_control)::int + (new.scoff_one_stone)::int
    + (new.scoff_fat)::int + (new.scoff_food_dominates)::int;

  -- SCOFF ≥ 2, OR any explicit mood/self-harm/behaviour flag ⇒ positive.
  new.positive :=
    new.scoff_score >= 2
    or new.self_harm_risk
    or new.low_mood
    or jsonb_array_length(coalesce(new.disordered_behaviours, '[]'::jsonb)) > 0;

  return new;
end;
$$;

drop trigger if exists obesity_ed_screens_prepare on public.obesity_ed_screens;
create trigger obesity_ed_screens_prepare
  before insert on public.obesity_ed_screens
  for each row execute function private.prepare_obesity_ed_screen();

-- --- AFTER INSERT: alert + auto-pause weight-loss + audit ---------------------
create or replace function private.handle_obesity_ed_screen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level public.alert_level;
  v_sla   timestamptz;
  v_esc   smallint;
  v_alert uuid;
begin
  if not new.positive then
    return new;
  end if;

  if new.self_harm_risk then
    v_level := 'emergency';         v_sla := now() + interval '15 minutes'; v_esc := 4;
  else
    v_level := 'urgent_escalation'; v_sla := now() + interval '1 hour';     v_esc := 3;
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
  values (
    new.organisation_id, new.patient_id, v_level, 'open',
    'Eating-disorder / mental-health screen positive',
    format('Positive obesity ED/mental-health screen (SCOFF %s/5%s%s). Weight-loss tasks paused; review and refer per §18 before resuming.',
      new.scoff_score,
      case when new.self_harm_risk then ', self-harm risk' else '' end,
      case when new.low_mood then ', low mood' else '' end),
    v_sla, v_esc)
  returning id into v_alert;

  update public.obesity_ed_screens set clinician_alert_id = v_alert where id = new.id;

  -- PAUSE the obesity lifestyle programme's weight-loss (§16.3, §18.2).
  update public.lpe_enrollments
    set status = 'paused',
        paused_reason = coalesce(paused_reason, 'Auto-paused: positive ED/mental-health screen')
    where patient_id = new.patient_id
      and condition = 'obesity'
      and status not in ('paused','completed');

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, coalesce(new.administered_by, new.patient_id),
    'obesity_ed_screen.positive', 'obesity_ed_screens', new.id,
    jsonb_build_object('scoff_score', new.scoff_score, 'self_harm_risk', new.self_harm_risk,
                       'low_mood', new.low_mood, 'clinician_alert_id', v_alert));

  return new;
end;
$$;

drop trigger if exists obesity_ed_screens_handle on public.obesity_ed_screens;
create trigger obesity_ed_screens_handle
  after insert on public.obesity_ed_screens
  for each row execute function private.handle_obesity_ed_screen();

-- --- RLS ---------------------------------------------------------------------
alter table public.obesity_ed_screens enable row level security;

drop policy if exists obesity_ed_screens_select on public.obesity_ed_screens;
create policy obesity_ed_screens_select on public.obesity_ed_screens
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- Patient may self-report their own screen; org-staff may screen for a patient.
drop policy if exists obesity_ed_screens_insert on public.obesity_ed_screens;
create policy obesity_ed_screens_insert on public.obesity_ed_screens
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id));

-- Only staff amend (notes / follow-up); the screen record itself is immutable content.
drop policy if exists obesity_ed_screens_update on public.obesity_ed_screens;
create policy obesity_ed_screens_update on public.obesity_ed_screens
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.obesity_ed_screens to authenticated;
