-- I14 (v3 port, founder-approved 2026-07-30): a patient session could freely
-- edit their own vitals_readings row regardless of source, even though a
-- device/wearable/CGM reading feeds the BP/glucose red-flag and
-- abnormal-result pipelines exactly like a manual entry does. Documented as
-- a genuine, live gap by packages/db/tests/i1_i10_invariants_platform.sql
-- (2026-07-29) and deliberately left unfixed pending a founder decision on
-- scope. Founder decision (2026-07-30): lock automatically-captured
-- readings (source <> 'manual'), leave self-reported manual entries freely
-- editable — a patient correcting their own typed-in weight is fine, a
-- patient silently rewriting what their BP cuff/glucometer/wearable/CGM
-- actually reported is not.
--
-- vitals_readings_update (20260705211129_chronic_disease.sql) is left
-- untouched — RLS still admits the patient broadly to their own rows; this
-- trigger narrows it, same "RLS admits broadly, trigger narrows" pattern as
-- private.enforce_medication_confirm_only. Org staff are unaffected — a
-- clinician correcting a misattributed device reading is a legitimate path
-- this does not block.
create or replace function private.enforce_vitals_reading_source_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Org staff (any role): unrestricted, unchanged from prior behavior.
  if private.is_org_staff(old.organisation_id) then
    return new;
  end if;

  -- Patient session editing their own row: only a 'manual' reading may be
  -- touched. Anything else (device/wearable/cgm, or any future source
  -- value — deny-by-default, not an enumerated allowlist) is locked.
  if old.source is distinct from 'manual' then
    raise exception
      'This reading was recorded automatically (%) and cannot be edited directly. Contact your care team if it needs a correction.',
      old.source
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger vitals_readings_enforce_source_lock
  before update on public.vitals_readings
  for each row execute function private.enforce_vitals_reading_source_lock();
