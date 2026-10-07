-- Segmented lead capture: an optional "what brings you here" field on the
-- marketing Contact/Join form, for conversion tracking by motivation rather
-- than only by role (patient/family/employer/...). Nullable — a lead who
-- doesn't pick one is still a valid lead, same as `message` today.

create type public.lead_goal as enum (
  'managing_a_condition',
  'staying_ahead',
  'family_care',
  'fast_doctor_access',
  'one_record',
  'still_exploring'
);

alter table public.leads
  add column goal public.lead_goal;
