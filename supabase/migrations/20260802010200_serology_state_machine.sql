-- HBV / HCV / HIV serology state machine (spec §12), mapped onto real tables
-- — no new observation store. `screening_results.result_status` (normal /
-- borderline / abnormal / critical) is the existing per-test result; this
-- migration adds a per-patient status column on `profiles` and a trigger
-- that advances it whenever a hep_b/hep_c/hiv screening_results row lands.
--
-- HONEST LIMITATION, flagged rather than hidden: the ladder tests HBsAg only
-- (no anti-HBs) and anti-HCV only (no reflex RNA). That means the full
-- IMMUNE/SUSCEPTIBLE split for HBV and the ACTIVE/CLEARED split for HCV
-- cannot be reached with what's actually orderable today — this migration
-- defines the full enum (so adding anti-HBs/RNA later needs no redesign) but
-- the trigger only reaches the states current testing can prove:
--   HBV:  unknown -> chronic_hbv (terminal) | hbv_negative (keep screening)
--   HCV:  unknown -> hcv_rna_pending (terminal until a reflex RNA order
--         exists) | hcv_negative (keep screening)
--   HIV:  unknown -> hiv_positive (terminal) | hiv_negative (keep screening)

do $$ begin
  if not exists (select 1 from pg_type where typname = 'hbv_status') then
    create type public.hbv_status as enum (
      'unknown', 'hbv_negative', 'chronic_hbv', 'immune', 'susceptible',
      'vaccinated_pending', 'non_responder'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'hcv_status') then
    create type public.hcv_status as enum (
      'unknown', 'hcv_negative', 'hcv_rna_pending', 'hcv_active', 'hcv_cleared'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'hiv_status') then
    create type public.hiv_status as enum ('unknown', 'hiv_negative', 'hiv_positive');
  end if;
end $$;

alter table public.profiles
  add column if not exists hbv_status public.hbv_status not null default 'unknown',
  add column if not exists hcv_status public.hcv_status not null default 'unknown',
  add column if not exists hiv_status public.hiv_status not null default 'unknown';

-- ---------------------------------------------------------------------------
-- Append-only transition log — a state that matters clinically should be
-- provable, same discipline as the audit_log/clinical_event pattern used
-- throughout this codebase for terminal-state transitions.
-- ---------------------------------------------------------------------------
create table if not exists public.serology_status_transitions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  virus            text not null check (virus in ('hbv', 'hcv', 'hiv')),
  from_status      text not null,
  to_status        text not null,
  screening_result_id uuid references public.screening_results (id) on delete set null,
  created_at       timestamptz not null default now()
);

alter table public.serology_status_transitions enable row level security;

drop policy if exists serology_status_transitions_select on public.serology_status_transitions;
create policy serology_status_transitions_select on public.serology_status_transitions
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select on public.serology_status_transitions to authenticated;
revoke all on public.serology_status_transitions from anon;

-- ---------------------------------------------------------------------------
-- Trigger: advance status on a new hep_b / hep_c / hiv screening_results row.
-- Terminal states (chronic_hbv, hcv_rna_pending, hiv_positive) also raise the
-- SAME doctor-debrief clinician_review alert pattern as
-- private.handle_health_check_resulted — reactive results always reach a
-- doctor, never just the patient, and a bare-reactive HCV/HIV result is
-- withheld from patient release until that review happens (mirrors the
-- existing HPV/reflex-order release-block pattern).
-- ---------------------------------------------------------------------------
create or replace function private.advance_serology_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reactive boolean;
  v_current  text;
begin
  if new.screen_type_code not in ('hep_b', 'hep_c', 'hiv') then
    return new;
  end if;

  v_reactive := new.result_status in ('abnormal', 'critical');

  if new.screen_type_code = 'hep_b' then
    select hbv_status::text into v_current from public.profiles where id = new.patient_id;
    if v_reactive and v_current <> 'chronic_hbv' then
      update public.profiles set hbv_status = 'chronic_hbv' where id = new.patient_id;
      insert into public.serology_status_transitions
        (organisation_id, patient_id, virus, from_status, to_status, screening_result_id)
        values (new.organisation_id, new.patient_id, 'hbv', v_current, 'chronic_hbv', new.id);
    elsif not v_reactive and v_current = 'unknown' then
      update public.profiles set hbv_status = 'hbv_negative' where id = new.patient_id;
      insert into public.serology_status_transitions
        (organisation_id, patient_id, virus, from_status, to_status, screening_result_id)
        values (new.organisation_id, new.patient_id, 'hbv', v_current, 'hbv_negative', new.id);
    end if;
  end if;

  if new.screen_type_code = 'hep_c' then
    select hcv_status::text into v_current from public.profiles where id = new.patient_id;
    if v_reactive and v_current not in ('hcv_rna_pending', 'hcv_active') then
      update public.profiles set hcv_status = 'hcv_rna_pending' where id = new.patient_id;
      insert into public.serology_status_transitions
        (organisation_id, patient_id, virus, from_status, to_status, screening_result_id)
        values (new.organisation_id, new.patient_id, 'hcv', v_current, 'hcv_rna_pending', new.id);
    elsif not v_reactive and v_current = 'unknown' then
      update public.profiles set hcv_status = 'hcv_negative' where id = new.patient_id;
      insert into public.serology_status_transitions
        (organisation_id, patient_id, virus, from_status, to_status, screening_result_id)
        values (new.organisation_id, new.patient_id, 'hcv', v_current, 'hcv_negative', new.id);
    end if;
  end if;

  if new.screen_type_code = 'hiv' then
    select hiv_status::text into v_current from public.profiles where id = new.patient_id;
    if v_reactive and v_current <> 'hiv_positive' then
      update public.profiles set hiv_status = 'hiv_positive' where id = new.patient_id;
      insert into public.serology_status_transitions
        (organisation_id, patient_id, virus, from_status, to_status, screening_result_id)
        values (new.organisation_id, new.patient_id, 'hiv', v_current, 'hiv_positive', new.id);
    elsif not v_reactive and v_current = 'unknown' then
      update public.profiles set hiv_status = 'hiv_negative' where id = new.patient_id;
      insert into public.serology_status_transitions
        (organisation_id, patient_id, virus, from_status, to_status, screening_result_id)
        values (new.organisation_id, new.patient_id, 'hiv', v_current, 'hiv_negative', new.id);
    end if;
  end if;

  if v_reactive then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, escalation_level)
    values (
      new.organisation_id, new.patient_id, 'urgent_escalation', 'open',
      format('Reactive %s result — confirm and contact the patient', upper(new.screen_type_code)),
      'A reactive serology result was recorded. It must be confirmed and discussed with the patient directly — do not release a bare reactive result without this review.',
      1
    );
  end if;

  return new;
end;
$$;

drop trigger if exists screening_results_advance_serology on public.screening_results;
create trigger screening_results_advance_serology
  after insert on public.screening_results
  for each row execute function private.advance_serology_status();

do $$
declare
  v_count int;
begin
  select count(*) into v_count from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('hbv_status', 'hcv_status', 'hiv_status');
  if v_count <> 3 then
    raise exception 'serology status columns did not all get added';
  end if;
end $$;
