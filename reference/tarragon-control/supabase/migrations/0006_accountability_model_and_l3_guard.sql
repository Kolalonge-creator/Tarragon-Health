-- Tarragon Control — M2: accountability_model default + Phase 2 L3 guard
-- Source: docs/tarragon-build-spec-v3.md §4 (default value), Phase 2 §1
-- ("L3 | app_config.accountability_model set on written legal advice |
-- No clinical_notes row may be signed; drafting still works").
--
-- Phase 2 §1 is explicit that these guards are built alongside Phase 1,
-- not deferred ("no build gates... Claude Code should never stop Phase 2
-- work waiting on operational data"). L3 is built now, not the other three
-- (L1/L2/L4), because it is the one guard directly coupled to what M2
-- introduces (real clinical_notes signing semantics) -- L1 belongs with
-- the triage engine (M5), L2 with the enrolment endpoint, L4 with
-- referrals (M8). Adding those now would be scope creep ahead of the
-- milestones that actually need them.
--
-- The guard condition, read literally from the spec's own wording, is
-- whether accountability_model has been SET (deliberately, by someone,
-- on legal advice) rather than left at its unconfirmed bootstrap default.
-- app_config.set_by is exactly that signal: NULL means "nobody has made
-- this decision yet," non-null means a real person did. No second boolean
-- key is introduced.

insert into app_config (key, value, set_by, set_at)
values ('accountability_model', '"tech_layer"'::jsonb, null, now())
on conflict (key) do nothing;

comment on table app_config is
  'Deliberately not gated by application code alone. accountability_model seeds at its spec-stated default (tech_layer) with set_by=NULL -- that NULL is the Phase 2 L3 guard condition itself (see trg_enforce_l3_accountability_model_confirmed on clinical_notes): nobody has yet made the deliberate, legally-advised decision this key represents. A superadmin sets set_by=auth.uid() when they do.';

create or replace function private.enforce_l3_accountability_model_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set_by uuid;
begin
  select set_by into v_set_by from app_config where key = 'accountability_model';

  if v_set_by is null then
    raise exception
      'L3 guard: app_config.accountability_model has not been deliberately set on written legal advice (set_by is null). No clinical_notes row may be signed until a superadmin confirms this. Drafting/other work is unaffected -- only clinical_notes signing is blocked.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger trg_enforce_l3_accountability_model_confirmed
  before insert on clinical_notes
  for each row
  execute function private.enforce_l3_accountability_model_confirmed();
