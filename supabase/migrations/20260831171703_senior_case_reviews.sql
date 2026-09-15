-- Tarragon Health — Pay-per-service item: Senior Case Review.
--
-- Named "Senior Case Review", not "multi-disciplinary case review" —
-- deliberate rename (founder decision, 2026-08-31) to avoid colliding with
-- docs/Tarragon_Health_Master_Operating_Plan_v4.md's separate "virtual
-- multidisciplinary care network" positioning goal (external partner
-- specialists defining their own availability — a larger, different
-- initiative). This is the smaller, internal product it was actually
-- described as: a Tier 3/4/5 senior doctor (or Clinical Director)
-- coordinating a complex, often multi-condition case, output is a written
-- plan delivered to the patient in-app.
--
-- This is NOT case-briefs/case-cockpit (lib/case-briefs, lib/case-cockpit) —
-- those are a single-doctor AI-drafted summary + deterministic one-click
-- actions on one escalation, not a senior-coordination product, and their
-- output goes into escalation_notes/case_review_actions, never a
-- patient-facing artifact. Reusable pattern from this item: the plain
-- signed-PDF machinery already built for verified_documents
-- (20260831171012) — a completed review is delivered as an in-app written
-- plan first; a downloadable PDF can reuse that exact machinery later if
-- asked for, not built speculatively here.
--
-- Gate: pure pay-per-service, no plan bypass — a senior-doctor deliverable
-- is a standalone premium item. Review authority is deliberately STRICTER
-- than every other doctor sign-off in this migration set (which only
-- excludes care_coordinator): only tier_3/tier_4_senior_registrar/
-- tier_5_partner_specialist or a Clinical Director may write the plan,
-- matching the tier ladder's own definition of who owns complex/multi-drug
-- case management and cross-tier supervision
-- (docs/Tarragon_Health_Master_Operating_Plan_v4.md §4).

create type public.senior_case_review_status as enum (
  'submitted', 'in_review', 'completed', 'declined'
);

create table public.senior_case_reviews (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  -- The patient's own account of why this needs senior-level coordination
  -- (e.g. multiple conditions, conflicting advice, a plan that isn't
  -- working) — free text, not itself the plan.
  situation_summary  text not null,
  status             public.senior_case_review_status not null default 'submitted',
  -- The actual deliverable: a written, multi-part plan for the patient.
  written_plan       text,
  declined_reason    text,
  reviewed_by        uuid references public.clinical_staff (id) on delete set null,
  reviewed_at        timestamptz,
  -- More time than a routine written Q&A — this is genuinely more work
  -- (reviewing the whole record, coordinating across conditions).
  sla_due_at         timestamptz not null default now() + interval '120 hours',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint senior_case_reviews_completed_has_plan
    check (status <> 'completed' or written_plan is not null)
);

create index senior_case_reviews_org_status_idx
  on public.senior_case_reviews (organisation_id, status, sla_due_at);
create index senior_case_reviews_patient_idx
  on public.senior_case_reviews (patient_id, created_at desc);

create trigger senior_case_reviews_set_updated_at
  before update on public.senior_case_reviews
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Pay-per-service gate.
-- ---------------------------------------------------------------------------

insert into public.service_products (code, name, description, price_kobo, currency, access_duration_days, is_active)
values (
  'senior_case_review_credit',
  'Senior Case Review',
  'A senior doctor coordinates your case across conditions and delivers a written plan in-app.',
  1500000, -- PLACEHOLDER (₦15,000) — not founder-confirmed
  'NGN', 90, true
)
on conflict (code) do nothing;

create or replace function private.enforce_senior_case_review_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.id := coalesce(new.id, gen_random_uuid());

  begin
    perform public.redeem_available_service_purchase(
      new.patient_id, 'senior_case_review_credit', 'senior_case_review', new.id
    );
  exception when others then
    if sqlerrm like 'no available%' then
      raise exception 'Buy a senior case review credit to request this.'
        using errcode = 'P0001', detail = 'SENIOR_CASE_REVIEW_CREDIT_REQUIRED';
    end if;
    raise;
  end;

  return new;
end;
$$;

create trigger senior_case_reviews_enforce_credit
  before insert on public.senior_case_reviews
  for each row execute function private.enforce_senior_case_review_credit();

-- ---------------------------------------------------------------------------
-- Forge-proof review attribution — stricter tier gate than the rest of this
-- migration set (see header).
-- ---------------------------------------------------------------------------

create or replace function private.stamp_senior_case_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
begin
  if new.status in ('completed', 'declined') and old.status not in ('completed', 'declined') then
    select cs.id into v_staff
    from public.clinical_staff cs
    where cs.profile_id = (select auth.uid())
      and cs.organisation_id = new.organisation_id
      and cs.active
      and (
        cs.is_clinical_director
        or cs.doctor_tier in ('tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
      );
    if v_staff is null then
      raise exception 'only a senior doctor (Tier 3+) or Clinical Director may complete a senior case review'
        using errcode = '42501';
    end if;
    new.reviewed_by := v_staff;
    new.reviewed_at := now();
  elsif new.status not in ('completed', 'declined') and old.status not in ('completed', 'declined') then
    new.reviewed_by := null;
    new.reviewed_at := null;
  else
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;
  return new;
end;
$$;

create trigger senior_case_reviews_stamp_review
  before update on public.senior_case_reviews
  for each row execute function private.stamp_senior_case_review();

alter table public.senior_case_reviews enable row level security;

create policy senior_case_reviews_select on public.senior_case_reviews
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy senior_case_reviews_insert on public.senior_case_reviews
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    and organisation_id = private.current_org_id()
  );
create policy senior_case_reviews_update on public.senior_case_reviews
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.senior_case_reviews to authenticated;

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_junior_profile uuid;
  v_senior_profile uuid;
  v_product_id uuid;
  v_purchase_id uuid;
  v_review_id uuid;
begin
  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' limit 1;
  if v_patient is null then
    raise notice 'SKIPPED behavioral proof: no patient row exists to test against';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.senior_case_reviews (organisation_id, patient_id, situation_summary)
    values (v_org, v_patient, 'repoint-proof: should be blocked, no credit');
    reset role;
    raise exception 'FAIL: senior_case_reviews insert succeeded with no credit';
  exception when others then
    reset role;
    if sqlerrm not like '%Buy a senior case review credit%' then
      raise;
    end if;
  end;

  select id into v_product_id from public.service_products where code = 'senior_case_review_credit';
  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
     amount_kobo, currency, purchased_at, expires_at)
  values
    (v_org, v_patient, v_patient, v_product_id, 'active', 1500000, 'NGN', now(), now() + interval '90 days')
  returning id into v_purchase_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.senior_case_reviews (organisation_id, patient_id, situation_summary)
  values (v_org, v_patient, 'repoint-proof: paid via credit')
  returning id into v_review_id;
  reset role;

  if not exists (select 1 from public.service_purchases where id = v_purchase_id and redeemed_at is not null and redeemed_entity_id = v_review_id) then
    raise exception 'FAIL: senior case review credit was not redeemed against the new review row';
  end if;

  -- Confirm the STRICTER gate actually excludes a junior doctor (tier_1/2),
  -- not just care_coordinator like the other items' looser gate.
  select cs.profile_id into v_junior_profile
  from public.clinical_staff cs
  where cs.organisation_id = v_org and cs.active and cs.doctor_tier in ('tier_1', 'tier_2') and not cs.is_clinical_director
  limit 1;

  if v_junior_profile is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_junior_profile, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      update public.senior_case_reviews set status = 'completed', written_plan = 'should be rejected' where id = v_review_id;
      reset role;
      raise exception 'FAIL: a junior-tier doctor was able to complete a senior case review';
    exception when others then
      reset role;
      if sqlerrm not like '%senior doctor%' then
        raise;
      end if;
    end;
  else
    raise notice 'SKIPPED junior-doctor-rejected proof: no tier_1/2 non-director fixture in org';
  end if;

  select cs.profile_id into v_senior_profile
  from public.clinical_staff cs
  where cs.organisation_id = v_org and cs.active
    and (cs.is_clinical_director or cs.doctor_tier in ('tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist'))
  limit 1;

  if v_senior_profile is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_senior_profile, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.senior_case_reviews
      set status = 'completed', written_plan = 'proof written plan'
      where id = v_review_id;
    reset role;

    if not exists (select 1 from public.senior_case_reviews where id = v_review_id and reviewed_by is not null and reviewed_at is not null) then
      raise exception 'FAIL: completing did not stamp reviewed_by/reviewed_at';
    end if;
  else
    raise notice 'SKIPPED senior-doctor-accepted proof: no tier_3+/director fixture in org';
  end if;

  delete from public.senior_case_reviews where id = v_review_id;
  delete from public.service_purchases where id = v_purchase_id;

  raise notice 'PASS: senior_case_reviews credit gate + strict senior-tier-only completion both work';
end $$;
