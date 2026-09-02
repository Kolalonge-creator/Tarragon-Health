-- Chronic disease monitoring §1.4: medication adherence log becomes
-- append-only. Every dose-taken/missed/skipped action is now a new, standing
-- entry (full history), not an overwrite of a single "last taken" field —
-- feeding the same notification/clinical-review loop as the vitals readings.
--
-- This reverses a deliberate, documented design decision:
-- 20260809232922_medication_logs_acting_for.sql explicitly built
-- medication_logs as NOT append-only ("the patient has always been able to
-- correct their own same-day tap"), and gave a supporter the narrow right to
-- UPDATE only a row they themselves logged. Going append-only means a
-- correction is a new row, not an in-place edit — the latest row per slot is
-- authoritative for "today's status," but every prior claim stays visible in
-- the record for clinical review. Scope note: this necessarily widens what a
-- supporter can do versus the old narrow UPDATE scope — they may now insert
-- a newer entry for ANY slot on a patient they act for (including one the
-- patient logged herself), not just correct their own previous entry, since
-- the concern the narrow scope existed to guard against (irreversibly
-- overwriting someone else's data) no longer applies once nothing is ever
-- overwritten. Every row still carries its own real author via
-- stamp_acting_supporter, unchanged.

-- ---------------------------------------------------------------------------
-- 1. Allow multiple rows per slot
-- ---------------------------------------------------------------------------

drop index public.medication_logs_scheduled_dose_uidx;

-- ---------------------------------------------------------------------------
-- 2. No more in-place status edits for anyone — a correction is a new insert
-- under the existing (unchanged) insert policies.
-- ---------------------------------------------------------------------------

drop policy medication_logs_update on public.medication_logs;
drop policy medication_logs_update_acting_supporter on public.medication_logs;

comment on column public.medication_logs.logged_by_profile_id is
  'Who marked this dose, when that is not the patient. NULL = the patient themselves. Server-derived from auth.uid() by private.stamp_acting_supporter on insert, never client-supplied. Fixed at insert time — medication_logs is append-only (20260830224528), so this no longer reverts on a later touch; a correction is a new row with its own attribution.';

-- The trigger's UPDATE half is now dead code (no UPDATE policy can ever let
-- an update reach it) but harmless to leave — simplifying it to INSERT-only
-- isn't worth a second migration touching a working trigger definition.

-- ---------------------------------------------------------------------------
-- 3. Read path: the latest row per slot is "today's status." Freeform/
-- as-needed logs (no scheduled_time) have no slot to dedupe against, so
-- every such row stands on its own — the CASE below gives each one a unique
-- extra grouping key (its own id) so DISTINCT ON never collapses two
-- different freeform entries into one (DISTINCT ON treats NULLs in its key
-- as equal, which would otherwise merge every freeform row together).
-- ---------------------------------------------------------------------------

create view public.medication_logs_latest_per_slot as
select distinct on (
    medication_id,
    scheduled_for_date,
    scheduled_time,
    case when scheduled_time is null then id end
  )
  *
from public.medication_logs
order by
  medication_id,
  scheduled_for_date,
  scheduled_time,
  case when scheduled_time is null then id end,
  logged_at desc,
  id desc;

alter view public.medication_logs_latest_per_slot set (security_invoker = on);

grant select on public.medication_logs_latest_per_slot to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Escalation evaluator: count distinct slots whose LATEST status is
-- 'missed' in the trailing 30 days, not a raw row count — otherwise a
-- corrected dose (mistaken 'missed' re-logged as 'taken') would both
-- double-count today and never un-count, since every insert is now kept.
-- ---------------------------------------------------------------------------

create or replace function private.evaluate_adherence_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missed integer;
  v_level  public.med_adherence_alert_level;
  v_alert  public.medication_adherence_alerts%rowtype;
begin
  if new.status <> 'missed' then
    return new;
  end if;

  select count(*) into v_missed
  from (
    select distinct on (
        case when scheduled_time is not null and scheduled_for_date is not null
          then scheduled_for_date::text || '|' || scheduled_time
          else id::text
        end
      )
      status
    from public.medication_logs
    where medication_id = new.medication_id
      and logged_at >= now() - interval '30 days'
    order by
      case when scheduled_time is not null and scheduled_for_date is not null
        then scheduled_for_date::text || '|' || scheduled_time
        else id::text
      end,
      logged_at desc,
      id desc
  ) latest
  where latest.status = 'missed';

  if v_missed >= 6 then
    v_level := 'doctor';
  elsif v_missed >= 3 then
    v_level := 'coach';
  else
    return new;
  end if;

  select * into v_alert
  from public.medication_adherence_alerts
  where medication_id = new.medication_id and status <> 'resolved'
  limit 1;

  if v_alert.id is null then
    insert into public.medication_adherence_alerts
      (organisation_id, patient_id, medication_id, level, missed_count)
    values
      (new.organisation_id, new.patient_id, new.medication_id, v_level, v_missed);
  else
    update public.medication_adherence_alerts
      set missed_count = v_missed,
          -- only ever upgrade the rung
          level = case when v_level = 'doctor' then 'doctor' else level end,
          -- a fresh doctor-level breach re-opens an acknowledged coach alert
          status = case
            when status = 'acknowledged' and v_level = 'doctor' and level <> 'doctor'
            then 'open'::public.med_adherence_alert_status
            else status
          end
    where id = v_alert.id;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Supporting index for the latest-per-slot lookups above.
-- ---------------------------------------------------------------------------

create index medication_logs_slot_latest_idx
  on public.medication_logs (medication_id, scheduled_for_date, scheduled_time, logged_at desc);

-- ---------------------------------------------------------------------------
-- Assert
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'medication_logs'
       and cmd = 'UPDATE'
  ) then
    raise exception 'medication_logs must have no UPDATE policy left — append-only means corrections are new inserts';
  end if;

  if not exists (
    select 1 from pg_views
     where schemaname = 'public' and viewname = 'medication_logs_latest_per_slot'
  ) then
    raise exception 'medication_logs_latest_per_slot view is missing';
  end if;

  if exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'medication_logs'
       and indexname = 'medication_logs_scheduled_dose_uidx'
  ) then
    raise exception 'the per-slot unique index must be gone for medication_logs to be append-only';
  end if;
end $$;
