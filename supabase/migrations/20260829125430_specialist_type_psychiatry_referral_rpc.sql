-- Tarragon Health — Mental Health & Wellbeing Platform (Module 46 §46.8/
-- §46.9: therapy / psychiatric referral pathway).
--
-- Referral-only, self-arranged — Tarragon has no employed therapist/
-- psychiatrist role in the clinical_staff tier ladder and does not run its
-- own clinics (CLAUDE.md), so this is never in-house booking. It reuses the
-- existing, deliberately-narrowed specialist_referrals model exactly as-is
-- (fulfilment defaults to 'self_arranged'; the guardrailed specialist-
-- matching/booking engine — CLINICAL_NETWORK_SPEC.md §3 — is untouched).
--
-- public.refer_patient_to_specialist mirrors, almost verbatim, the referral
-- branch already inside public.action_consultation_follow_up
-- (20260828000005) — same clinical-staff/tier authority check, same insert
-- shape — but does not require a pre-existing consultation_follow_ups row,
-- since a mental-health screen is not a consultation. This is a clinical
-- decision (referral routing, not patient self-service), matching how
-- action_consultation_follow_up already gates referral creation to
-- clinical-tier staff only.

alter type public.specialist_type add value if not exists 'psychiatry';
alter type public.specialist_type add value if not exists 'psychology';

create or replace function public.refer_patient_to_specialist(
  p_patient_id uuid,
  p_specialist_type text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff       record;
  v_organisation_id uuid;
  v_specialist  public.specialist_type;
  v_new_id      uuid;
begin
  select organisation_id into v_organisation_id
  from public.profiles
  where id = p_patient_id;

  if v_organisation_id is null then
    raise exception 'patient not found';
  end if;

  select cs.* into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = v_organisation_id
    and cs.active;
  if v_staff.id is null then
    raise exception 'only an active member of this organisation''s care team can create a referral'
      using errcode = '42501';
  end if;

  if not (v_staff.is_clinical_director or v_staff.doctor_tier in
    ('tier_1', 'tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')) then
    raise exception 'only a clinical-tier member of the care team can create a referral'
      using errcode = '42501';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a referral needs a reason';
  end if;

  begin
    v_specialist := p_specialist_type::public.specialist_type;
  exception when invalid_text_representation then
    raise exception '% is not a recognised specialist type', p_specialist_type;
  end;

  insert into public.specialist_referrals
    (organisation_id, patient_id, specialist_type, referral_reason, origin, set_by)
  values
    (v_organisation_id, p_patient_id, v_specialist, btrim(p_reason), 'clinically_triggered', v_staff.profile_id)
  returning id into v_new_id;

  return v_new_id;
end;
$$;

comment on function public.refer_patient_to_specialist(uuid, text, text) is
  'Module 46 §46.8/§46.9: lets a clinical-tier staff member create a specialist referral (e.g. psychiatry/psychology) directly, without a prior consultation_follow_ups row — same authority check and insert shape as action_consultation_follow_up''s referral branch (20260828000005). Stays self_arranged by the existing fulfilment default; never touches the specialist-matching guardrail.';

revoke all on function public.refer_patient_to_specialist(uuid, text, text) from public;
revoke all on function public.refer_patient_to_specialist(uuid, text, text) from anon;
grant execute on function public.refer_patient_to_specialist(uuid, text, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'specialist_type' and e.enumlabel = 'psychiatry'
  ) then
    raise exception 'specialist_type is missing psychiatry';
  end if;
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'specialist_type' and e.enumlabel = 'psychology'
  ) then
    raise exception 'specialist_type is missing psychology';
  end if;

  raise notice 'PASS: specialist_type gained psychiatry/psychology, refer_patient_to_specialist installed';
end $$;
