-- S11b: a rule set can only be approved by an active Chief Medical Officer (review finding on S11).
-- The S11 check required approved_by to be non-null, so any profile id could be recorded as the signer.
-- This trigger checks the approver at the moment a row becomes approved (insert or update).
create or replace function private.triage_rule_sets_approver_is_cmo()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- A missing approver is left to the table's own check constraint.
  if new.status = 'approved' and new.approved_by is not null and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    if not exists (
      select 1 from public.clinical_staff
      where profile_id = new.approved_by and active and doctor_tier = 'chief_medical_officer'
    ) then
      raise exception 'a triage rule set can only be approved by an active Chief Medical Officer' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger triage_rule_sets_approver_is_cmo before insert or update on public.triage_rule_sets
  for each row execute function private.triage_rule_sets_approver_is_cmo();
