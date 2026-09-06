-- Tarragon Health — medication safety pathway 64.8 (part 2 of 2, see
-- 20260829142846 for why this is a separate migration): a patient
-- repeatedly logging a dose as 'not_available' is genuine non-adherence —
-- they could not take the medicine, same downstream risk as a 'missed' dose
-- — and must count toward the same missed-dose escalation ladder
-- (private.evaluate_adherence_escalation). Left out deliberately: 'skipped'
-- (already existed, was never counted — a deliberate/clinician-sanctioned
-- skip, not a risk signal) and the new 'delayed' (the dose WAS taken, just
-- later than scheduled — not a miss).
--
-- RECONCILED during PR #340's merge into main-dev (2026-09-02): this
-- migration originally claimed its body was "byte-for-byte the live
-- definition from 20260716175000_medication_adherence_escalation.sql" — true
-- when #340 was branched, but private.evaluate_adherence_escalation() has
-- since been rewritten twice while #340 sat unmerged:
--   20260830224528_medication_logs_append_only.sql made medication_logs
--     append-only (a correction is a new row, not an in-place edit) and
--     rewrote the count to be over DISTINCT SCHEDULED SLOTS keyed by their
--     LATEST logged row, not a raw row count — a naive `status in (...)`
--     row count would double-count a corrected slot forever.
--   20260830233204_medication_logs_safety_hardening.sql further made the
--     evaluator reconcile an already-open alert's missed_count on EVERY
--     insert for the medication, not only on a fresh 'missed' one, so a
--     correction (missed -> taken) can true up a stale displayed count —
--     while still gating actual alert creation/escalation to a 'missed'-
--     shaped event only.
-- Confirmed via pg_get_functiondef against the live project (not the local
-- migration file — see CLAUDE.md's standing lesson on live/file drift)
-- before writing this. Applying #340's original naive-count body here would
-- have silently reverted both of the above safety properties on every
-- medication dose log going forward. This version instead layers
-- 'not_available' onto the CURRENT live body: everywhere the live function
-- keys off 'missed' to decide what a slot's "latest status" counts as, or
-- whether an insert may raise/escalate, 'not_available' is now included
-- alongside it. Every other branch (append-only slot-latest dedup,
-- correction-triggered recompute, coach/doctor thresholds, re-open-on-
-- doctor-escalation) is unchanged.

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
  where latest.status in ('missed', 'not_available');

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

  -- Only a 'missed'/'not_available' event may RAISE a new alert or upgrade
  -- one's level -- a correction (or an unrelated 'taken'/'skipped'/'delayed'
  -- insert) must never spuriously create or escalate one.
  if new.status not in ('missed', 'not_available') then
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
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  if (select count(*) from pg_enum where enumtypid = 'public.medication_log_status'::regtype
        and enumlabel in ('delayed', 'not_available')) <> 2 then
    raise exception 'medication_log_status is missing delayed/not_available — run 20260829142846 first';
  end if;

  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'evaluate_adherence_escalation' and pronamespace = 'private'::regnamespace;

  if v_def not like '%not in (''missed'', ''not_available'')%'
     or v_def not like '%latest.status in (''missed'', ''not_available'')%' then
    raise exception 'evaluate_adherence_escalation was not updated to count not_available';
  end if;
  -- Every pre-existing branch (append-only slot-latest dedup, correction-
  -- triggered recompute, coach/doctor thresholds) must survive the rewrite.
  if v_def not like '%v_missed >= 6%' or v_def not like '%v_missed >= 3%' then
    raise exception 'evaluate_adherence_escalation lost the coach/doctor threshold logic';
  end if;
  if v_def not like '%distinct on (%' then
    raise exception 'evaluate_adherence_escalation lost the append-only distinct-on-slot dedup (20260830224528)';
  end if;
  if v_def not like '%set missed_count = v_missed%where id = v_alert.id;%if new.status not in%' then
    raise exception 'evaluate_adherence_escalation lost the reconcile-on-every-insert behaviour (20260830233204)';
  end if;

  raise notice 'PASS: medication_log_status carries delayed/not_available, escalation counts not_available alongside missed, append-only/correction-reconciliation logic preserved';
end $$;
