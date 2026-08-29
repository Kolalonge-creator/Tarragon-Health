-- Tarragon Health — Electronic Prescription & Prescription Management Engine.
-- §62.7 prescription verification: any pharmacy (not only a contracted
-- partner — Tarragon has none live, see 20260803132008_medication_collected_
-- anywhere.sql) can verify a prescription a patient presents in person,
-- without Tarragon routing an order to it. NOT scoped to the pharmacist's own
-- partner via private.pharmacist_partner() the way the four RPCs in
-- 20260716178000_pharmacist_surface.sql are — this is deliberately cross-org
-- and cross-partner, matching the founder's "buy at the chemist down the
-- road" model: a Tarragon patient can walk into ANY pharmacy nationwide, so
-- any authenticated pharmacist account must be able to verify what they're
-- shown. What keeps this safe without partner-scoping is that a caller must
-- already hold BOTH the rx_number (a predictable sequence, of no use alone)
-- and the verification_code (a random 6-char value never shown anywhere
-- except this prescription's own record) — i.e. must have the specific
-- prescription in hand, not merely browse. See rx_number/verification_code's
-- column comments (20260829010000_prescription_lifecycle_rx_number_and_expiry.sql).
--
-- SECURITY DEFINER is required here (unlike amend_medication) because
-- verification is intentionally cross-org — a role='pharmacist' caller has no
-- RLS path to another organisation's medications row at all.

create or replace function public.verify_prescription(
  p_rx_number text,
  p_verification_code text
)
returns table (
  drug_name        text,
  dose             text,
  frequency        text,
  route            text,
  quantity         text,
  duration_days    integer,
  repeats_allowed  integer,
  repeats_used     integer,
  indication       text,
  instructions     text,
  status           text,
  signed_at        timestamptz,
  expires_at       timestamptz,
  version          integer,
  prescriber_name  text,
  patient_name     text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_med public.medications%rowtype;
  v_prescriber text;
  v_patient text;
  v_used integer;
begin
  if (select p.role from public.profiles p where p.id = (select auth.uid())) <> 'pharmacist' then
    return;
  end if;

  select * into v_med
  from public.medications m
  where m.rx_number = btrim(p_rx_number)
    and m.verification_code = upper(btrim(coalesce(p_verification_code, '')))
    and m.source = 'clinician';

  if v_med.id is null then
    return;
  end if;

  select full_name into v_prescriber from public.profiles where id = v_med.added_by;
  select full_name into v_patient from public.profiles where id = v_med.patient_id;

  -- Table alias + qualified columns required: this function's own RETURNS
  -- TABLE clause implicitly declares a plpgsql variable named `status`
  -- (among others), which would otherwise collide with
  -- medication_repeat_requests.status and fail to parse ("column reference
  -- status is ambiguous").
  select count(*) into v_used
  from public.medication_repeat_requests mrr
  where mrr.medication_id = v_med.id and mrr.status = 'approved';

  return query select
    v_med.drug_name, v_med.dose, v_med.frequency, v_med.route, v_med.quantity,
    v_med.duration_days, v_med.repeats_allowed, coalesce(v_used, 0),
    v_med.indication, v_med.instructions,
    case
      when v_med.superseded_at is not null then 'superseded'
      when v_med.expires_at is not null and v_med.expires_at < now() then 'expired'
      when not v_med.is_active then 'cancelled'
      else 'active'
    end,
    v_med.created_at, v_med.expires_at, v_med.version,
    coalesce(v_prescriber, 'Tarragon care team'), coalesce(v_patient, 'Unknown patient');
end;
$$;

comment on function public.verify_prescription is
  'Spec §62.7 prescription verification for any pharmacy. Requires both rx_number and verification_code, restricted to role=pharmacist callers. Returns zero rows (never an error) for a bad code, an unauthorised caller, or an unknown rx_number, so a lookup failure never distinguishes "wrong code" from "not found" — see this migration''s header.';

grant execute on function public.verify_prescription(text, text) to authenticated;
revoke all on function public.verify_prescription(text, text) from anon;
