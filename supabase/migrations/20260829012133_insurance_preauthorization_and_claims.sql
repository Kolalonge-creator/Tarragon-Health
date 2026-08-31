-- Tarragon Health — insurance, part 2: pre-authorisation and claims (spec
-- §25.17, part of §25.16). Builds the workflow spec §25.17 describes:
--
--   Service requested → check benefit → pre-authorisation required
--   → request submitted → approved/denied → booking/payment
--
-- No insurer has a real API integration (none is even contracted yet), so
-- both request_preauthorization/decide_preauthorization and
-- submit_insurance_claim/record_claim_adjudication are tracked WORKFLOW
-- STATE, not automated calls to anyone — staff record what the insurer's
-- portal/email/phone call actually said, the same discipline insurers.
-- claim_submission_method already documents in part 1. This mirrors how
-- partner_statements are entered from an emailed lab/pharmacy invoice
-- rather than pulled from a partner API that does not exist.
--
-- Deliberately does NOT post anything to the general ledger.
-- record_claim_adjudication only records what was decided
-- (insurer_covered_kobo, patient_copay_kobo) — it does not create a
-- receivable, does not touch 1020/4100, and does not decide whether
-- Tarragon bills the insurer directly or the patient pays and claims
-- reimbursement themselves. That is the same "genuine unresolved business
-- decision" part 1's header flags for the checkout side; the financial
-- entries that decision implies belong in a future migration once it is
-- made, not invented here.

-- ---------------------------------------------------------------------------
-- 1. Pre-authorisation.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.insurance_preauth_status as enum ('pending', 'approved', 'denied', 'expired');
exception when duplicate_object then null; end $$;

create table public.insurance_preauthorizations (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  policy_id             uuid not null references public.insurance_policies (id) on delete restrict,
  service_category      text not null check (service_category in
    ('consultation', 'laboratory', 'pharmacy', 'referral')),
  -- What the request is for, in the same shape as patient_receipts'/
  -- invoices' service_type + source_id — a lab_order/pharmacy_order/
  -- specialist_referral id once one exists, or null when pre-authorisation
  -- is being sought before a booking is made (spec §25.17's own flow starts
  -- with "service requested", which can precede an actual booking record).
  source_id             uuid,
  estimated_amount_kobo bigint not null check (estimated_amount_kobo >= 0),
  clinical_justification text,
  status                public.insurance_preauth_status not null default 'pending',
  authorization_number  text,
  valid_from            date,
  valid_until           date,
  denial_reason         text,
  requested_by          uuid not null references public.profiles (id) on delete restrict,
  requested_at          timestamptz not null default now(),
  decided_by            uuid references public.profiles (id) on delete restrict,
  decided_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on column public.insurance_preauthorizations.source_id is
  'The lab_order/pharmacy_order/specialist_referral/video_visit_request this pre-authorisation covers, once one exists. No FK: polymorphic across four tables, same bare-uuid-with-comment idiom as commissions.source_id. Null is valid — pre-authorisation is often sought before booking.';

create index insurance_preauthorizations_policy_idx on public.insurance_preauthorizations (policy_id);
create index insurance_preauthorizations_org_status_idx on public.insurance_preauthorizations (organisation_id, status);

drop trigger if exists insurance_preauthorizations_set_updated_at on public.insurance_preauthorizations;
create trigger insurance_preauthorizations_set_updated_at
  before update on public.insurance_preauthorizations
  for each row execute function private.set_updated_at();

alter table public.insurance_preauthorizations enable row level security;

create policy insurance_preauthorizations_patient_select on public.insurance_preauthorizations
  for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    or exists (select 1 from public.insurance_policies ip
                where ip.id = policy_id and ip.patient_id = (select auth.uid()))
  );

grant select on public.insurance_preauthorizations to authenticated;
revoke all on public.insurance_preauthorizations from anon;
-- Deliberately no insert/update grant to authenticated — only
-- request_preauthorization()/decide_preauthorization() below ever write a
-- row, both SECURITY DEFINER with their own is_org_staff gate.

create or replace function public.request_preauthorization(
  p_policy_id uuid,
  p_service_category text,
  p_estimated_amount_kobo bigint,
  p_source_id uuid default null,
  p_clinical_justification text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.insurance_policies%rowtype;
  v_id uuid;
begin
  select * into v_policy from public.insurance_policies where id = p_policy_id;
  if v_policy.id is null then
    raise exception 'no such policy' using errcode = '42501';
  end if;
  if not private.is_org_staff(v_policy.organisation_id) then
    raise exception 'only care-team staff can request pre-authorisation' using errcode = '42501';
  end if;
  if p_service_category not in ('consultation', 'laboratory', 'pharmacy', 'referral') then
    raise exception 'unknown service_category: %', p_service_category using errcode = '22023';
  end if;

  insert into public.insurance_preauthorizations
    (organisation_id, policy_id, service_category, source_id, estimated_amount_kobo,
     clinical_justification, requested_by)
  values
    (v_policy.organisation_id, p_policy_id, p_service_category, p_source_id, p_estimated_amount_kobo,
     p_clinical_justification, (select auth.uid()))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'preauthorization_id', v_id, 'status', 'pending');
end;
$$;

revoke all on function public.request_preauthorization(uuid, text, bigint, uuid, text) from public;
revoke all on function public.request_preauthorization(uuid, text, bigint, uuid, text) from anon;
grant execute on function public.request_preauthorization(uuid, text, bigint, uuid, text) to authenticated;

create or replace function public.decide_preauthorization(
  p_preauthorization_id uuid,
  p_decision text,
  p_authorization_number text default null,
  p_valid_until date default null,
  p_denial_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.insurance_preauthorizations%rowtype;
begin
  select * into v_p from public.insurance_preauthorizations where id = p_preauthorization_id;
  if v_p.id is null then
    raise exception 'no such pre-authorisation request' using errcode = '42501';
  end if;
  if not private.is_org_staff(v_p.organisation_id) then
    raise exception 'only care-team staff can record a pre-authorisation decision' using errcode = '42501';
  end if;
  if v_p.status <> 'pending' then
    raise exception 'this request is already %', v_p.status using errcode = '23514';
  end if;
  if p_decision not in ('approved', 'denied') then
    raise exception 'decision must be approved or denied' using errcode = '23514';
  end if;
  if p_decision = 'approved' and coalesce(btrim(p_authorization_number), '') = '' then
    raise exception 'an approval needs the insurer''s authorisation number' using errcode = '23514';
  end if;
  if p_decision = 'denied' and coalesce(btrim(p_denial_reason), '') = '' then
    raise exception 'a denial needs a reason' using errcode = '23514';
  end if;

  update public.insurance_preauthorizations
     set status = p_decision::public.insurance_preauth_status,
         authorization_number = p_authorization_number,
         valid_from = case when p_decision = 'approved' then current_date else valid_from end,
         valid_until = p_valid_until,
         denial_reason = p_denial_reason,
         decided_by = (select auth.uid()),
         decided_at = now()
   where id = p_preauthorization_id;

  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;

revoke all on function public.decide_preauthorization(uuid, text, text, date, text) from public;
revoke all on function public.decide_preauthorization(uuid, text, text, date, text) from anon;
grant execute on function public.decide_preauthorization(uuid, text, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Claims.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.insurance_claim_status as enum
    ('submitted', 'adjudicating', 'approved', 'partially_approved', 'denied', 'paid');
exception when duplicate_object then null; end $$;

create table public.insurance_claims (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  policy_id             uuid not null references public.insurance_policies (id) on delete restrict,
  preauthorization_id   uuid references public.insurance_preauthorizations (id) on delete set null,
  service_category      text not null check (service_category in
    ('consultation', 'laboratory', 'pharmacy', 'referral')),
  source_id             uuid not null,
  claim_reference        text,
  billed_amount_kobo    bigint not null check (billed_amount_kobo >= 0),
  insurer_covered_kobo  bigint check (insurer_covered_kobo is null or insurer_covered_kobo >= 0),
  patient_copay_kobo    bigint not null check (patient_copay_kobo >= 0),
  status                public.insurance_claim_status not null default 'submitted',
  denial_reason         text,
  submitted_by          uuid not null references public.profiles (id) on delete restrict,
  submitted_at          timestamptz not null default now(),
  adjudicated_by        uuid references public.profiles (id) on delete restrict,
  adjudicated_at        timestamptz,
  paid_at               timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (insurer_covered_kobo is null or insurer_covered_kobo <= billed_amount_kobo),
  check (patient_copay_kobo <= billed_amount_kobo),
  -- One claim per underlying booking, ever — mirrors invoices' own
  -- (service_type, source_id) uniqueness discipline.
  unique (service_category, source_id)
);

comment on column public.insurance_claims.source_id is
  'The lab_order/pharmacy_order/specialist_referral/video_visit_request this claim is for. No FK: polymorphic across four tables, same idiom as insurance_preauthorizations.source_id above.';
comment on column public.insurance_claims.patient_copay_kobo is
  'The patient''s share — an estimate from check_insurance_coverage() at submission, recomputed to the real figure by record_claim_adjudication() once the insurer actually responds (denied = billed_amount_kobo in full; approved/partially_approved = billed_amount_kobo minus insurer_covered_kobo). Never stale after adjudication.';

create index insurance_claims_policy_idx on public.insurance_claims (policy_id);
create index insurance_claims_org_status_idx on public.insurance_claims (organisation_id, status);

drop trigger if exists insurance_claims_set_updated_at on public.insurance_claims;
create trigger insurance_claims_set_updated_at
  before update on public.insurance_claims
  for each row execute function private.set_updated_at();

alter table public.insurance_claims enable row level security;

create policy insurance_claims_patient_select on public.insurance_claims
  for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    or exists (select 1 from public.insurance_policies ip
                where ip.id = policy_id and ip.patient_id = (select auth.uid()))
  );

grant select on public.insurance_claims to authenticated;
revoke all on public.insurance_claims from anon;

create or replace function public.submit_insurance_claim(
  p_policy_id uuid,
  p_service_category text,
  p_source_id uuid,
  p_billed_amount_kobo bigint,
  p_preauthorization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.insurance_policies%rowtype;
  v_coverage jsonb;
  v_copay bigint;
  v_id uuid;
begin
  select * into v_policy from public.insurance_policies where id = p_policy_id;
  if v_policy.id is null then
    raise exception 'no such policy' using errcode = '42501';
  end if;
  if not private.is_org_staff(v_policy.organisation_id) then
    raise exception 'only care-team staff can submit a claim' using errcode = '42501';
  end if;
  if p_service_category not in ('consultation', 'laboratory', 'pharmacy', 'referral') then
    raise exception 'unknown service_category: %', p_service_category using errcode = '22023';
  end if;

  -- Snapshot the patient's expected co-pay at submission time from the same
  -- benefit calculation check_insurance_coverage() exposes — never
  -- recomputed later, same discipline as partner_cost_kobo on lab/pharmacy
  -- orders. The insurer's own adjudicated figure (insurer_covered_kobo)
  -- overwrites nothing here; it lands separately via
  -- record_claim_adjudication once the insurer actually responds.
  v_coverage := public.check_insurance_coverage(v_policy.patient_id, p_service_category, p_billed_amount_kobo);
  v_copay := coalesce((v_coverage ->> 'patient_responsibility_kobo')::bigint, p_billed_amount_kobo);

  insert into public.insurance_claims
    (organisation_id, policy_id, preauthorization_id, service_category, source_id,
     billed_amount_kobo, patient_copay_kobo, submitted_by)
  values
    (v_policy.organisation_id, p_policy_id, p_preauthorization_id, p_service_category, p_source_id,
     p_billed_amount_kobo, v_copay, (select auth.uid()))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'claim_id', v_id, 'estimated_patient_copay_kobo', v_copay);
end;
$$;

revoke all on function public.submit_insurance_claim(uuid, text, uuid, bigint, uuid) from public;
revoke all on function public.submit_insurance_claim(uuid, text, uuid, bigint, uuid) from anon;
grant execute on function public.submit_insurance_claim(uuid, text, uuid, bigint, uuid) to authenticated;

create or replace function public.record_claim_adjudication(
  p_claim_id uuid,
  p_status text,
  p_claim_reference text default null,
  p_insurer_covered_kobo bigint default null,
  p_denial_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.insurance_claims%rowtype;
begin
  select * into v_c from public.insurance_claims where id = p_claim_id;
  if v_c.id is null then
    raise exception 'no such claim' using errcode = '42501';
  end if;
  if not private.is_org_staff(v_c.organisation_id) then
    raise exception 'only care-team staff can record a claim decision' using errcode = '42501';
  end if;
  if v_c.status = 'paid' then
    raise exception 'this claim is already paid' using errcode = '23514';
  end if;
  if p_status not in ('adjudicating', 'approved', 'partially_approved', 'denied', 'paid') then
    raise exception 'invalid claim status: %', p_status using errcode = '23514';
  end if;
  if p_status in ('approved', 'partially_approved') and p_insurer_covered_kobo is null then
    raise exception 'an approval needs the amount the insurer agreed to cover' using errcode = '23514';
  end if;
  if p_status = 'denied' and coalesce(btrim(p_denial_reason), '') = '' then
    raise exception 'a denial needs a reason' using errcode = '23514';
  end if;

  update public.insurance_claims
     set status = p_status::public.insurance_claim_status,
         claim_reference = coalesce(p_claim_reference, claim_reference),
         insurer_covered_kobo = coalesce(p_insurer_covered_kobo, insurer_covered_kobo),
         -- The estimate from submission is now the real answer: a denial
         -- means the patient owes the whole bill, an approval/partial
         -- approval means whatever the insurer did not cover.
         patient_copay_kobo = case
           when p_status = 'denied' then billed_amount_kobo
           when p_status in ('approved', 'partially_approved') then billed_amount_kobo - p_insurer_covered_kobo
           else patient_copay_kobo
         end,
         denial_reason = p_denial_reason,
         adjudicated_by = (select auth.uid()),
         adjudicated_at = case when p_status in ('approved', 'partially_approved', 'denied')
                                then now() else adjudicated_at end,
         paid_at = case when p_status = 'paid' then now() else paid_at end
   where id = p_claim_id;

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

revoke all on function public.record_claim_adjudication(uuid, text, text, bigint, text) from public;
revoke all on function public.record_claim_adjudication(uuid, text, text, bigint, text) from anon;
grant execute on function public.record_claim_adjudication(uuid, text, text, bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Assertions.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'insurance_preauthorizations'
  ) then
    raise exception 'FAIL: insurance_preauthorizations was not created';
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'insurance_claims'
  ) then
    raise exception 'FAIL: insurance_claims was not created';
  end if;

  if not has_function_privilege('authenticated', 'public.request_preauthorization(uuid,text,bigint,uuid,text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute request_preauthorization';
  end if;
  if not has_function_privilege('authenticated', 'public.submit_insurance_claim(uuid,text,uuid,bigint,uuid)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute submit_insurance_claim';
  end if;

  raise notice 'PASS: insurance pre-authorisation and claims workflow all in place';
end $$;
