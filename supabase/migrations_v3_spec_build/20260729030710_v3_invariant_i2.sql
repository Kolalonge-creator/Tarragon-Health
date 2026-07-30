-- I2: every reading produces exactly one triage_classifications row (unique constraint on
-- reading_id already enforces "exactly one"; this trigger enforces "produces").
--
-- Deliberately minimal for M1: this is the v0-provisional "classifies conservatively" behaviour
-- from spec §7.1 (everything -> needs_review), not the real WHO HEARTS engine -- that is
-- packages/triage's job at M5, which will replace this trigger's body with real threshold logic
-- while leaving I2's guarantee (every reading gets a row) intact.
--
-- If no clinician-approved protocol_configs row is active yet, the insert is blocked outright --
-- you cannot log a reading before a real clinician has signed off on at least a provisional
-- ruleset. That is a feature, not a bug: it means M4 (readings) cannot go live before M2
-- (a real, activated clinician) has happened, matching the spec's own build order.
create or replace function private.classify_reading_conservatively() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_protocol_id uuid;
begin
  select id into v_protocol_id
  from protocol_configs
  where effective_from <= new.taken_at
    and (effective_to is null or effective_to > new.taken_at)
  order by effective_from desc
  limit 1;

  if v_protocol_id is null then
    raise exception 'I2: no active protocol_configs row covers this reading (taken_at %). A clinician must approve at least a v0-provisional ruleset before any reading can be logged.', new.taken_at;
  end if;

  insert into triage_classifications (reading_id, patient_id, classification, protocol_config_id, rule_fired)
  values (new.id, new.patient_id, 'needs_review', v_protocol_id, 'v0_provisional_conservative_default');

  return new;
end;
$$;

create trigger classify_reading_after_insert
  after insert on readings
  for each row execute function private.classify_reading_conservatively();

