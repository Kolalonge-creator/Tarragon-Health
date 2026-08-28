-- Tarragon Health — polypharmacy detection (13.15)
--
-- 13.15: "identify patients taking multiple medications... generate
-- 'Medication review recommended' based on approved criteria." This is the
-- 6th source on the existing care_plan_review_prompts worklist
-- (20260717223000), following its exact established pattern (a structural
-- AFTER INSERT trigger calling the shared private.enqueue_care_plan_review_
-- prompt upsert helper) rather than inventing a new mechanism.
--
-- Threshold: 5+ concurrently active medications is the standard clinical
-- definition of polypharmacy in the literature this platform's own drug-
-- safety engine already cites elsewhere (lib/rules/drug-safety.ts's duplicate-
-- therapy checks). Counted across ALL sources (clinician/specialist/patient-
-- added) — pill burden and interaction risk don't care who added the row,
-- unlike the lab-monitoring/check-in schedulers which deliberately only fire
-- for clinician/specialist medications.
--
-- Dedup is inherited for free from the shared helper's partial unique index
-- (one open prompt per patient+event): a patient already over the threshold
-- adding yet another medication refreshes the existing open prompt's count/
-- reason instead of spamming a new row every time.

create or replace function private.check_polypharmacy_threshold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_count integer;
begin
  if not new.is_active then
    return new;
  end if;

  select count(*) into v_active_count
  from public.medications
  where patient_id = new.patient_id and is_active = true;

  if v_active_count < 5 then
    return new;
  end if;

  perform private.enqueue_care_plan_review_prompt(
    new.organisation_id,
    new.patient_id,
    'polypharmacy_threshold',
    new.id,
    format('Patient now has %s active medications — medication review recommended.', v_active_count)
  );

  return new;
end;
$$;

drop trigger if exists medications_check_polypharmacy on public.medications;
create trigger medications_check_polypharmacy
  after insert on public.medications
  for each row execute function private.check_polypharmacy_threshold();

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'medications_check_polypharmacy' and tgrelid = 'public.medications'::regclass
  ) then
    raise exception 'medications_check_polypharmacy trigger was not created';
  end if;
  raise notice 'PASS: polypharmacy detection trigger installed';
end $$;
