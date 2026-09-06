-- Tarragon Health — Referral Management Engine, gap 3: nothing gates WHO can
-- create a specialist_referrals row. The shared org-staff INSERT policy
-- from 20260705211237_prevention.sql (looped across five screening/referral
-- tables) admits any active org-staff member, Care Coordinator included —
-- but deciding to refer a patient to a specialist is exactly the kind of
-- judgment call the Clinical Tier Ladder reserves for clinical tier
-- ("[Care Coordinator] never interprets a result, adjusts medication, or
-- closes an escalation — routes anything needing judgment to Tier 1",
-- CLAUDE.md). private.is_clinical_tier(org) is the same helper
-- clinical_encounter_notes/consultation_follow_ups/escalation-claim already
-- use for this exact floor.
--
-- public.refer_patient_to_specialist (20260829125430) already gates ITSELF
-- to clinical tier, but that check only covers callers going through that
-- one RPC — a direct .insert() against the table (which the shared RLS
-- policy still permits to any org staff) bypasses it entirely. This trigger
-- closes that gap at the table level, so every insertion path — the RPC,
-- action_consultation_follow_up's referral branch, and a direct insert from
-- the new create-referral form (apps/web/.../create-referral-form.tsx) — is
-- gated the same way. "RLS admits, the trigger narrows" — same shape as
-- consultation_follow_ups_enforce_write and enforce_referral_fulfilment.
--
-- Also fills in referred_by / submitted_at for this new insertion path:
-- referred_by already exists (20260828231917) but nothing before this
-- populated it on a plain client insert — its own comment anticipates
-- exactly this ("Null for automated/trigger-created referrals... never
-- inferred or backfilled" implies a real clinician-initiated insert SHOULD
-- carry it). Resolved as a clinical_staff.id (the column's actual FK
-- target, confirmed live), never a bare profiles id, and always
-- server-derived — same forge-proof pattern as stamp_bariatric_referral_staff.
-- submitted_at is new in this series: null while status='draft', stamped
-- the moment it is not (67.4 Draft -> Submitted).
--
-- organisation_id is re-derived from the patient's own profile row rather
-- than trusted from the client, same discipline
-- enforce_consultation_follow_up_write uses for encounter_note_id →
-- organisation_id/patient_id: a client-supplied organisation_id could
-- otherwise be used to smuggle a referral into an org the caller merely
-- happens to also staff, for a patient who isn't actually that org's.

create or replace function private.enforce_specialist_referral_create()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_patient_org uuid;
  v_staff_id uuid;
begin
  select organisation_id into v_patient_org
  from public.profiles
  where id = new.patient_id and role = 'patient';

  if v_patient_org is null then
    raise exception 'patient not found or has no organisation on file';
  end if;
  new.organisation_id := v_patient_org;

  if not private.is_clinical_tier(new.organisation_id) then
    raise exception 'Only a clinical-tier member of the care team can create a specialist referral.'
      using errcode = '42501';
  end if;

  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active
  limit 1;

  new.referred_by := v_staff_id;
  new.submitted_at := case when new.status = 'draft' then null else now() end;

  return new;
end;
$function$;

comment on function private.enforce_specialist_referral_create() is
  'BEFORE INSERT on specialist_referrals: re-derives organisation_id from the patient''s own profile (never trusted from the client), requires clinical tier (excludes Care Coordinator by name, and closes the direct-insert bypass around refer_patient_to_specialist''s own RPC-level check), server-stamps referred_by (as a clinical_staff.id) and submitted_at.';

drop trigger if exists specialist_referrals_enforce_create on public.specialist_referrals;
create trigger specialist_referrals_enforce_create
  before insert on public.specialist_referrals
  for each row execute function private.enforce_specialist_referral_create();

revoke all on function private.enforce_specialist_referral_create() from public;
revoke all on function private.enforce_specialist_referral_create() from anon;
revoke all on function private.enforce_specialist_referral_create() from public, anon;

-- A draft moving to any other status is "submission" (67.4 Draft ->
-- Submitted) and must be stamped the same way a fresh non-draft INSERT is.
create or replace function private.stamp_specialist_referral_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'draft' and new.status <> 'draft' and new.submitted_at is null then
    new.submitted_at := now();
  end if;
  return new;
end;
$function$;

comment on function private.stamp_specialist_referral_submission() is
  'BEFORE UPDATE on specialist_referrals: stamps submitted_at the moment a draft first leaves draft status, if not already set.';

drop trigger if exists specialist_referrals_stamp_submission on public.specialist_referrals;
create trigger specialist_referrals_stamp_submission
  before update on public.specialist_referrals
  for each row execute function private.stamp_specialist_referral_submission();

revoke all on function private.stamp_specialist_referral_submission() from public;
revoke all on function private.stamp_specialist_referral_submission() from anon;
revoke all on function private.stamp_specialist_referral_submission() from public, anon;

do $$
begin
  if has_function_privilege('anon', 'private.enforce_specialist_referral_create()', 'EXECUTE') then
    raise exception 'anon must not execute enforce_specialist_referral_create';
  end if;
  if has_function_privilege('anon', 'private.stamp_specialist_referral_submission()', 'EXECUTE') then
    raise exception 'anon must not execute stamp_specialist_referral_submission';
  end if;
  raise notice 'PASS: specialist_referrals create-gate + submission-stamp triggers present, anon denied';
end $$;
