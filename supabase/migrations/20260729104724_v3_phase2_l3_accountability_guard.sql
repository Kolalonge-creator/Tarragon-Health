-- Phase 2 §1, guard L3: "app_config.accountability_model set on written legal advice | No
-- clinical_notes row may be signed; drafting still works." Phase 2 §1 is explicit these guards
-- are built alongside Phase 1, not deferred ("no build gates... never stop Phase 2 work waiting
-- on operational data") -- found while reconciling against the parallel tarragon-control build
-- of this same spec, which built this guard at M2 for the same reason it belongs here: M2 is
-- what introduces real clinical_notes signing semantics.
--
-- L3 is built now; L1 (ties to the triage engine, M5), L2 (enrolment endpoint) and L4 (referrals,
-- M8) are deliberately deferred to the milestone that actually needs them -- adding those now
-- would be scope creep ahead of the milestones that introduce the thing they guard. app_config
-- already carries l1-l4 columns from M1's own schema build; only L3's trigger is wired here.
--
-- The guard condition is whether accountability_model has been SET deliberately (on legal advice)
-- rather than left at its unconfirmed bootstrap default: app_config.l3_set_by is exactly that
-- signal -- null means nobody has made this decision yet, non-null means a real person did.
create or replace function private.enforce_l3_accountability_model_confirmed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_set_by uuid;
begin
  select l3_set_by into v_set_by from app_config where id = true;

  if v_set_by is null then
    raise exception 'L3: app_config.accountability_model has not been deliberately confirmed on written legal advice (l3_set_by is null). No clinical_notes row may be signed until a superadmin confirms this -- drafting/other work is unaffected, only clinical_notes signing is blocked.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger enforce_l3_accountability_model_confirmed_trigger
  before insert on clinical_notes
  for each row execute function private.enforce_l3_accountability_model_confirmed();
