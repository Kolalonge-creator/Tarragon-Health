-- Chronic disease monitoring §1.4 follow-up: two clinical-safety gaps found
-- on review of 20260830224528_medication_logs_append_only.sql, both closed
-- here.
--
-- 1. logged_at was never server-stamped, only logged_by_profile_id was
--    (private.stamp_acting_supporter touches attribution, not the
--    timestamp). Under the old upsert model that was a minor cosmetic gap —
--    at most one row ever existed per slot, so a manipulated logged_at only
--    affected a "when was this last touched" detail. Append-only makes
--    logged_at the SOLE mechanism deciding which of several permanent,
--    competing claims about a slot is authoritative (both
--    medication_logs_latest_per_slot's "latest wins" and the escalation
--    evaluator's 30-day window key off it) — an unenforced, client-settable
--    ordering key is a real integrity hole in a record this spec explicitly
--    wants "auditable" (§1.18's Original -> Correction -> Reason -> Author
--    -> Timestamp model). No UI ever needed a caller-supplied logged_at (a
--    dose is always logged "now"), so closing this removes no real
--    capability. Enforced with clock_timestamp(), not now(): now() is
--    frozen to transaction-start, so two inserts in the same transaction
--    (a realistic shape for a batched/offline-sync client, and exactly the
--    shape of this migration's own verification tests) would otherwise
--    receive an IDENTICAL logged_at and make "latest wins" genuinely
--    ambiguous rather than merely theoretically racy.
--
-- 2. private.evaluate_adherence_escalation() only recomputes/updates an
--    already-open alert's missed_count when the triggering row's OWN status
--    is 'missed' (an early return skips everything else otherwise). A
--    correction (missed -> taken) never re-fires that recompute, so a
--    clinician reviewing an open alert could see a stale, inflated
--    missed_count that doesn't reflect a correction already on file. Fixed
--    to recompute and reconcile the count on every insert for the
--    medication, while keeping the actual escalate/create/upgrade logic
--    gated to a 'missed'-status insert only — a correction can true up the
--    displayed number, it must never itself raise or escalate an alert.
--    (The alert's own status/level are untouched here: only a clinician can
--    resolve one, and level is still upgrade-only — both pre-existing,
--    correct safety properties, unchanged.)

-- ---------------------------------------------------------------------------
-- 1. logged_at is a server fact, not a client claim.
-- ---------------------------------------------------------------------------

create or replace function private.stamp_medication_log_timestamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.logged_at := clock_timestamp();
  return new;
end;
$$;

create trigger medication_logs_stamp_timestamp
  before insert on public.medication_logs
  for each row execute function private.stamp_medication_log_timestamp();

-- ---------------------------------------------------------------------------
-- 2. Keep an open alert's missed_count truthful on every insert, not only
-- on a fresh 'missed' one.
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

  select * into v_alert
  from public.medication_adherence_alerts
  where medication_id = new.medication_id and status <> 'resolved'
  limit 1;

  -- Reconcile a pre-existing open alert's displayed count regardless of
  -- this insert's own status -- a correction should not leave a clinician
  -- looking at a stale, inflated number.
  if v_alert.id is not null then
    update public.medication_adherence_alerts
      set missed_count = v_missed
    where id = v_alert.id;
  end if;

  -- Only a 'missed' event may RAISE a new alert or upgrade one's level -- a
  -- correction must never spuriously create or escalate one.
  if new.status <> 'missed' then
    return new;
  end if;

  if v_missed >= 6 then
    v_level := 'doctor';
  elsif v_missed >= 3 then
    v_level := 'coach';
  else
    return new;
  end if;

  if v_alert.id is null then
    insert into public.medication_adherence_alerts
      (organisation_id, patient_id, medication_id, level, missed_count)
    values
      (new.organisation_id, new.patient_id, new.medication_id, v_level, v_missed);
  else
    update public.medication_adherence_alerts
      set level = case when v_level = 'doctor' then 'doctor' else level end,
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
-- Assert
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'medication_logs_stamp_timestamp'
       and tgrelid = 'public.medication_logs'::regclass
       and not tgisinternal
  ) then
    raise exception 'medication_logs is missing its server-side logged_at stamp';
  end if;
end $$;
