-- Tarragon Control — M3: fix a real gap in screening_participants
--
-- Spec §8 requires capturing "name, DOB, sex, phone, consent... temp_ref"
-- for a screening participant. DOB/sex have a home (patients, once a row
-- exists for them -- see 0011). Name and phone have NONE:
-- screening_participants (§5.10) carries no name/phone columns at all,
-- patients carries neither (full_name/phone live on profiles), and
-- profiles requires a real auth.users row, which a walk-up screening
-- participant does not have. Without these two columns, an explicit,
-- named requirement is simply impossible to satisfy. Fixed minimally.

alter table screening_participants add column full_name text not null default '';
alter table screening_participants add column phone_e164 text;

-- the default '' only exists so this additive migration doesn't fail on
-- a table that (in a real deployment) might already have rows; every new
-- INSERT going forward supplies a real value via capture_screening_participant.
alter table screening_participants alter column full_name drop default;

comment on column screening_participants.full_name is
  'Not in the spec''s §5.10 DDL -- added because §8''s capture requirement ("name, DOB, sex, phone...") has nowhere else to live for a participant with no auth.users/profiles row yet.';
comment on column screening_participants.phone_e164 is
  'Same gap as full_name -- see that column''s comment.';
