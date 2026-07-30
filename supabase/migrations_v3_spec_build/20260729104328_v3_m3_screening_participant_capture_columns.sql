-- M3: screening-day capture (build spec v3 §8), ported/adapted from the parallel tarragon-control
-- build of this same spec, which built M3 before this repo did. Reconciling the two.
--
-- Real gap found there, applies here too: §8 requires capturing "name, DOB, sex, phone,
-- consent... temp_ref" for a screening participant. DOB/sex have a home (patients, once a row
-- exists). Name and phone have NONE: screening_participants carries no name/phone columns at
-- all, patients carries neither (full_name/phone live on profiles), and profiles requires a real
-- auth.users row, which a walk-up screening participant does not have. Fixed minimally.
alter table screening_participants add column full_name text not null default '';
alter table screening_participants add column phone_e164 text;
alter table screening_participants alter column full_name drop default;

comment on column screening_participants.full_name is
  'Not in the spec''s §5.10 DDL -- added because §8''s capture requirement ("name, DOB, sex, phone...") has nowhere else to live for a participant with no auth.users/profiles row yet.';
comment on column screening_participants.phone_e164 is
  'Same gap as full_name -- see that column''s comment.';

-- §8's dedup key is (screening_event_id, temp_ref, type, taken_at), but temp_ref only lives on
-- screening_participants, not readings -- it resolves 1:1 to patient_id via that table, PROVIDED
-- temp_ref is unique per event, which the spec's own DDL didn't enforce either. Added here
-- alongside the dedup index since the whole dedup scheme is meaningless without it.
alter table screening_participants add constraint screening_participants_temp_ref_unique_per_event
  unique (screening_event_id, temp_ref);

-- Phase 2 I14 ("A reading originating from a paired device... carries device serial and firmware
-- version") has no columns to carry that yet. Added now, nullable, since screening-day BLE
-- captures are exactly the first real path that needs them, and I14's own enforcement (patient
-- role denied UPDATE on a patient_device_bt-sourced reading) is separable, deferred work.
alter table readings add column device_serial text;
alter table readings add column device_firmware text;

-- DB-level backstop matching the dedup key 1:1 (screening_event_id + patient_id stands in for
-- screening_event_id + temp_ref, per the constraint above). Catches a race between concurrent
-- sync attempts that an application-level check-then-insert can't.
create unique index screening_reading_dedup
  on readings (screening_event_id, patient_id, type, taken_at)
  where source = 'screening_day';
