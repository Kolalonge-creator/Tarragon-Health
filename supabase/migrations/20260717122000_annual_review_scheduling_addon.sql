-- Tarragon Health — Annual Health Review: à-la-carte add-on, video-consult
-- scheduling handshake, and age/sex-aware workup catalogue.
--
-- Three additive extensions to the 2026-07-17 Annual Health Review pathway:
--   1. A standalone `annual-review` add-on so patients on lower tiers can buy
--      the programme à la carte (mirrors the lifestyle-coaching add-on shape:
--      NGN active, GBP/USD inactive until synced to a real Stripe Price). This
--      grants the same `annual_review` feature the comprehensive plans carry,
--      so has_feature_access resolves it identically.
--   2. A propose->confirm scheduling handshake on video_consultations: the
--      clinician offers candidate slots (proposed_slots), the patient confirms
--      one in-app (scheduled_at + patient_confirmed_at). This is how doctor and
--      patient agree a day/time without a live calendar-availability system.
--      WhatsApp/SMS only reminds — never the booking interface.
--   3. Age/sex applicability on the workup catalogue so the auto-seeded general
--      workup is tailored (e.g. cervical screening for women 25+, prostate for
--      men 45+, ECG from 40) instead of one flat list. A reusable
--      private.open_annual_review() seeds only applicable items; a clinician can
--      still add any catalogue item manually from the worklist.
-- All idempotent-guarded.

-- ---------------------------------------------------------------------------
-- 1. À-la-carte add-on
-- ---------------------------------------------------------------------------
-- Yearly interval (the programme is annual). Pricing is a PLACEHOLDER for the
-- founder to confirm. GBP/USD stay inactive until synced to a real Stripe
-- Price via /admin/settings/subscriptions, same as every diaspora add-on row.
insert into public.add_ons
  (code, name, description, price_minor, currency, interval, features, restricted_to_plan_code, is_active)
values
  ('annual-review', 'Annual Health Review',
   'A once-a-year whole-body check — general bloods, heart and other screening beyond your ongoing condition care — plus a video consult with your Tarragon doctor to talk through your whole year.',
   5000000, 'NGN', 'yearly', array['annual_review'], null, true),
  ('annual-review_gbp', 'Annual Health Review',
   'A once-a-year whole-body check — general bloods, heart and other screening beyond your ongoing condition care — plus a video consult with your Tarragon doctor to talk through your whole year.',
   3000, 'GBP', 'yearly', array['annual_review'], null, false),
  ('annual-review_usd', 'Annual Health Review',
   'A once-a-year whole-body check — general bloods, heart and other screening beyond your ongoing condition care — plus a video consult with your Tarragon doctor to talk through your whole year.',
   3800, 'USD', 'yearly', array['annual_review'], null, false)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Video-consult scheduling handshake
-- ---------------------------------------------------------------------------
alter table public.video_consultations
  add column if not exists proposed_slots      timestamptz[],
  add column if not exists patient_confirmed_at timestamptz;

-- A consult with proposed_slots set but scheduled_at still null = "awaiting the
-- patient's pick". No status-enum churn needed for that state.

-- ---------------------------------------------------------------------------
-- 3. Age/sex-aware workup catalogue
-- ---------------------------------------------------------------------------
alter table public.annual_review_workup_catalogue
  add column if not exists min_age     integer,
  add column if not exists max_age     integer,
  add column if not exists applies_sex public.sex;

-- Replace the single generic cancer-screening item with sex/age-specific
-- screening items + age-gate the ECG. Safe to delete the generic row: no real
-- (committed) workup_items reference it yet.
delete from public.annual_review_workup_catalogue where code = 'cancer_screening_review';

-- Age-gate the resting ECG (cardiac screen more relevant with age).
update public.annual_review_workup_catalogue set min_age = 40 where code = 'ecg';

insert into public.annual_review_workup_catalogue
  (code, label, description, default_applicable, sort_order, min_age, max_age, applies_sex) values
  ('cervical_screening',   'Cervical cancer screening', 'Pap smear / HPV screen.',                 true, 110, 25, 65, 'female'),
  ('breast_screening',     'Breast cancer screening',   'Clinical breast exam / mammography referral.', true, 111, 40, null, 'female'),
  ('prostate_screening',   'Prostate screening',        'PSA / prostate review.',                  true, 112, 45, null, 'male'),
  ('colorectal_screening', 'Colorectal cancer screening','FIT / colonoscopy referral.',            true, 113, 45, null, null)
on conflict (code) do update
  set label = excluded.label, description = excluded.description,
      default_applicable = excluded.default_applicable, sort_order = excluded.sort_order,
      min_age = excluded.min_age, max_age = excluded.max_age, applies_sex = excluded.applies_sex;

-- ---------------------------------------------------------------------------
-- Reusable opener: insert a review + seed only APPLICABLE workup items.
-- Age-gated items are included when the patient's DOB is unknown (don't miss a
-- screen); sex-gated items are only included on a confirmed sex match (never
-- seed a prostate screen for an unknown/mismatched sex). Returns the review id,
-- or null if one already exists for that cycle.
-- ---------------------------------------------------------------------------
create or replace function private.open_annual_review(
  p_patient uuid, p_org uuid, p_year integer
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_review_id uuid;
  v_dob date;
  v_sex public.sex;
begin
  select date_of_birth, sex into v_dob, v_sex from public.profiles where id = p_patient;

  insert into public.annual_reviews (organisation_id, patient_id, cycle_year, due_date)
  values (p_org, p_patient, p_year, current_date)
  on conflict (patient_id, cycle_year) do nothing
  returning id into v_review_id;

  if v_review_id is null then
    return null;
  end if;

  insert into public.annual_review_workup_items (annual_review_id, organisation_id, code, label)
  select v_review_id, p_org, c.code, c.label
  from public.annual_review_workup_catalogue c
  where c.default_applicable
    and (c.min_age is null or v_dob is null or extract(year from age(v_dob)) >= c.min_age)
    and (c.max_age is null or v_dob is null or extract(year from age(v_dob)) <= c.max_age)
    and (c.applies_sex is null or c.applies_sex = v_sex)
  on conflict (annual_review_id, code) do nothing;

  return v_review_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rewrite the scheduler to use the applicability-aware opener + reminder.
-- ---------------------------------------------------------------------------
create or replace function private.queue_annual_reviews()
returns void language plpgsql security definer set search_path = '' as $$
declare v_year integer := extract(year from current_date); r record; v_review_id uuid;
begin
  for r in
    select distinct s.subscriber_id as patient_id, p.organisation_id
    from public.subscriptions s
    join public.profiles p on p.id = s.subscriber_id
    left join public.subscription_plans pl on pl.id = s.plan_id
    where s.status in ('active', 'trialing') and p.role = 'patient'
      and ((pl.features is not null and 'annual_review' = any(pl.features))
        or exists (select 1 from public.subscription_add_ons sao
          join public.add_ons a on a.id = sao.add_on_id
          where sao.subscription_id = s.id and sao.status in ('active', 'trialing')
            and 'annual_review' = any(a.features)))
  loop
    if exists (select 1 from public.annual_reviews ar where ar.patient_id = r.patient_id
      and (ar.status in ('pending', 'in_progress') or ar.due_date > current_date - interval '11 months')) then
      continue;
    end if;

    v_review_id := private.open_annual_review(r.patient_id, r.organisation_id, v_year);
    if v_review_id is null then continue; end if;

    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (r.organisation_id, r.patient_id, 'whatsapp', 'pending', 'annual_review_due',
      jsonb_build_object('cycle_year', v_year));
  end loop;
end; $$;
