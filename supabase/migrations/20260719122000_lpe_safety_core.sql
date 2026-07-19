-- ============================================================================
-- LPE Phase 2 — Safety core: red-flag events + escalation wiring
-- Spec §9. Plan: docs/LIFESTYLE_ENGINE_BUILD_PLAN.md
--
-- The TS evaluator (packages/lifestyle-engine/safety) decides WHICH rules fire;
-- it writes one lpe_red_flag_events row per fired flag. This migration makes the
-- DB the backstop that CANNOT be bypassed:
--   * every flag creates a clinician_alerts worklist row (severity-mapped SLA)
--   * an auto_pause_weightloss flag pauses the enrollment in the SAME txn
--   * a flag can only be stood down by a real clinical_staff actor + reason
--     (no auto-close / auto-downgrade — enforced by trigger; enum has no
--      'auto_closed' value by design)
-- ============================================================================

do $$ begin
  create type public.lpe_red_flag_severity as enum ('amber','red','emergency');
exception when duplicate_object then null; end $$;

-- NB: intentionally only two states. There is no 'auto_closed' (spec §4.4).
do $$ begin
  create type public.lpe_red_flag_status as enum ('open','stood_down');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lpe_red_flag_action as enum
    ('supportive_reply','same_day_review','auto_pause_weightloss','page_oncall','refer');
exception when duplicate_object then null; end $$;

create table if not exists public.lpe_red_flag_events (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  enrollment_id     uuid references public.lpe_enrollments (id) on delete set null,
  measurement_id    uuid references public.lpe_measurements (id) on delete set null,
  rule_key          text not null,
  severity          public.lpe_red_flag_severity not null,
  escalation_level  smallint not null check (escalation_level between 1 and 4),
  action            public.lpe_red_flag_action not null,
  status            public.lpe_red_flag_status not null default 'open',
  clinician_alert_id uuid references public.clinician_alerts (id) on delete set null,
  stood_down_by     uuid references public.clinical_staff (id) on delete set null,
  stood_down_reason text,
  stood_down_at     timestamptz,
  opened_at         timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
create index if not exists lpe_red_flag_events_patient_idx
  on public.lpe_red_flag_events (patient_id, status, opened_at desc);

-- Close the loop from the measurement to its flag (deferred from Phase 1).
do $$ begin
  alter table public.lpe_measurements
    add constraint lpe_measurements_red_flag_event_fk
    foreign key (red_flag_event_id)
    references public.lpe_red_flag_events (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- On INSERT: raise the worklist alert + audit + (if demanded) auto-pause.
-- ---------------------------------------------------------------------------
create or replace function private.handle_lpe_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level  public.alert_level;
  v_sla    timestamptz;
  v_alert  uuid;
begin
  -- Map clinical severity → alert level + contact SLA (spec §9.2).
  if new.severity = 'emergency' then
    v_level := 'emergency';        v_sla := now() + interval '15 minutes';
  elsif new.severity = 'red' then
    v_level := 'doctor_escalation'; v_sla := now() + interval '1 hour';
  else
    v_level := 'nurse_review';      v_sla := now() + interval '72 hours';
  end if;

  if new.clinician_alert_id is null then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
    values (
      new.organisation_id, new.patient_id, v_level, 'open',
      format('Lifestyle red flag (%s): %s', new.severity, new.rule_key),
      format('Rule %s fired for a logged reading. Action: %s.', new.rule_key, new.action),
      v_sla, new.escalation_level)
    returning id into v_alert;
    new.clinician_alert_id := v_alert;
  end if;

  -- ED / self-harm ⇒ pause weight-loss in the SAME transaction (spec §9.3).
  if new.action = 'auto_pause_weightloss' and new.enrollment_id is not null then
    update public.lpe_enrollments
      set status = 'paused',
          paused_reason = coalesce(paused_reason,
            'Auto-paused: safety flag ' || new.rule_key)
      where id = new.enrollment_id
        and status <> 'paused';
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.patient_id, 'lpe_red_flag.opened',
    'lpe_red_flag_events', new.id,
    jsonb_build_object('rule_key', new.rule_key, 'severity', new.severity,
                       'action', new.action, 'clinician_alert_id', new.clinician_alert_id));

  return new;
end;
$$;

drop trigger if exists lpe_red_flag_on_insert on public.lpe_red_flag_events;
create trigger lpe_red_flag_on_insert
  before insert on public.lpe_red_flag_events
  for each row execute function private.handle_lpe_red_flag();

-- ---------------------------------------------------------------------------
-- On UPDATE: enforce no-auto-close. Only a real clinical_staff actor with a
-- reason may stand a flag down; a stood-down flag can never be reopened here.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_lpe_red_flag_stand_down()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'stood_down' and old.status is distinct from 'stood_down' then
    if new.stood_down_by is null or new.stood_down_reason is null then
      raise exception 'a red flag can only be stood down by a clinician with a reason'
        using errcode = 'check_violation';
    end if;
    new.stood_down_at := now();
  end if;

  if old.status = 'stood_down' and new.status is distinct from 'stood_down' then
    raise exception 'a stood-down red flag cannot be reopened or downgraded'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists lpe_red_flag_on_update on public.lpe_red_flag_events;
create trigger lpe_red_flag_on_update
  before update on public.lpe_red_flag_events
  for each row execute function private.enforce_lpe_red_flag_stand_down();

-- ---------------------------------------------------------------------------
-- RLS: patient reads own flags; org staff read + stand down. Inserts are
-- system/staff only (the server action inserts via service role after the
-- evaluator runs) — a patient can never forge or stand down a flag.
-- ---------------------------------------------------------------------------
alter table public.lpe_red_flag_events enable row level security;

drop policy if exists lpe_red_flag_events_select on public.lpe_red_flag_events;
create policy lpe_red_flag_events_select on public.lpe_red_flag_events
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists lpe_red_flag_events_insert on public.lpe_red_flag_events;
create policy lpe_red_flag_events_insert on public.lpe_red_flag_events
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

drop policy if exists lpe_red_flag_events_update on public.lpe_red_flag_events;
create policy lpe_red_flag_events_update on public.lpe_red_flag_events
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));
