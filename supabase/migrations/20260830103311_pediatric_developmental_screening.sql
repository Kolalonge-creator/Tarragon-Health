-- Tarragon Health — Paediatric developmental monitoring (Child Health Platform §48.5)
--
-- §48.5 lists motor/language/social/cognitive/behavioural domains and says
-- "age-appropriate questionnaires CAN be used" — permissive, not naming a
-- specific instrument. Deliberately does NOT reproduce ASQ-3 or any other
-- licensed/copyrighted developmental-screening tool: ASQ-3 (Brookes
-- Publishing) is commercial IP with proprietary item wording and normed
-- cutoffs neither available nor safe to approximate from memory (same
-- fabrication-risk reasoning as the growth-reference-LMS gap in the previous
-- migration). What ships here is an ORIGINAL, transparent, unlicensed starter
-- item bank with a plainly-documented, non-normed scoring rule — a structured
-- aid that routes concern to a real clinician, not a validated diagnostic
-- instrument. Adopting a licensed instrument instead is a founder/clinical
-- decision, not something to build speculatively — see
-- docs/PEDIATRIC_CHILD_HEALTH_SPEC.md.

-- ---------------------------------------------------------------------------
-- 1. developmental_questionnaire_items — the (starter) item bank
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'developmental_domain') then
    create type public.developmental_domain as enum (
      'motor', 'language', 'social', 'cognitive', 'behavioural'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'developmental_item_answer') then
    create type public.developmental_item_answer as enum ('yes', 'sometimes', 'not_yet');
  end if;
end $$;

create table if not exists public.developmental_questionnaire_items (
  id                    uuid primary key default gen_random_uuid(),
  domain                public.developmental_domain not null,
  age_band_months_min   integer not null check (age_band_months_min >= 0),
  age_band_months_max   integer not null check (age_band_months_max > age_band_months_min),
  prompt                text not null,
  display_order         integer not null default 0,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now()
);

create index if not exists developmental_questionnaire_items_age_band_idx
  on public.developmental_questionnaire_items (age_band_months_min, age_band_months_max, is_active);

alter table public.developmental_questionnaire_items enable row level security;

drop policy if exists developmental_questionnaire_items_select on public.developmental_questionnaire_items;
create policy developmental_questionnaire_items_select on public.developmental_questionnaire_items
  for select to authenticated
  using (is_active or private.is_admin());

drop policy if exists developmental_questionnaire_items_write on public.developmental_questionnaire_items;
create policy developmental_questionnaire_items_write on public.developmental_questionnaire_items
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update, delete on public.developmental_questionnaire_items to authenticated;

-- Six age bands x five domains x two items = 60 items. General, widely-known,
-- non-instrument-specific developmental milestones (not ASQ-3 wording).
insert into public.developmental_questionnaire_items
  (domain, age_band_months_min, age_band_months_max, prompt, display_order)
values
  -- 4-8 months
  ('motor',      4, 8, 'Does your baby roll over from tummy to back or back to tummy?', 1),
  ('motor',      4, 8, 'Does your baby sit for a short time without your support?', 2),
  ('language',   4, 8, 'Does your baby babble, making repeated sounds like "ba-ba"?', 1),
  ('language',   4, 8, 'Does your baby turn toward a new sound or your voice?', 2),
  ('social',     4, 8, 'Does your baby smile back at you or others?', 1),
  ('social',     4, 8, 'Does your baby enjoy simple games like peek-a-boo?', 2),
  ('cognitive',  4, 8, 'Does your baby reach for and grasp a toy?', 1),
  ('cognitive',  4, 8, 'Does your baby look for a toy that has dropped out of sight?', 2),
  ('behavioural',4, 8, 'Can your baby usually be soothed when upset?', 1),
  ('behavioural',4, 8, 'Does your baby settle into a fairly predictable sleep/feeding pattern?', 2),
  -- 9-15 months
  ('motor',      9, 15, 'Does your child pull up to stand or take steps holding on to furniture?', 1),
  ('motor',      9, 15, 'Does your child pick up small objects using thumb and finger?', 2),
  ('language',   9, 15, 'Does your child say one or two words other than "mama"/"dada"?', 1),
  ('language',   9, 15, 'Does your child point to show you something they want?', 2),
  ('social',     9, 15, 'Does your child wave bye-bye?', 1),
  ('social',     9, 15, 'Does your child look at you when you call their name?', 2),
  ('cognitive',  9, 15, 'Does your child imitate simple actions you make, like clapping?', 1),
  ('cognitive',  9, 15, 'Does your child put an object into a container and take it out?', 2),
  ('behavioural',9, 15, 'Does your child show interest in exploring their surroundings?', 1),
  ('behavioural',9, 15, 'Is your child generally easy to comfort after a fright or fall?', 2),
  -- 16-23 months
  ('motor',      16, 23, 'Does your child walk alone without holding on?', 1),
  ('motor',      16, 23, 'Does your child scribble with a crayon or pencil?', 2),
  ('language',   16, 23, 'Does your child say at least three to five words besides "mama"/"dada"?', 1),
  ('language',   16, 23, 'Does your child follow a simple one-step instruction ("give me the cup")?', 2),
  ('social',     16, 23, 'Does your child copy things you do, like sweeping or talking on a phone?', 1),
  ('social',     16, 23, 'Does your child show affection to familiar people?', 2),
  ('cognitive',  16, 23, 'Does your child point to at least one body part when asked?', 1),
  ('cognitive',  16, 23, 'Does your child use an object correctly, like drinking from a cup?', 2),
  ('behavioural',16, 23, 'Does your child have tantrums that you can usually redirect or calm?', 1),
  ('behavioural',16, 23, 'Does your child stay interested in an activity for a few minutes?', 2),
  -- 24-35 months
  ('motor',      24, 35, 'Does your child run fairly well without falling often?', 1),
  ('motor',      24, 35, 'Does your child kick a ball forward?', 2),
  ('language',   24, 35, 'Does your child put two or more words together ("more milk")?', 1),
  ('language',   24, 35, 'Do familiar people understand most of what your child says?', 2),
  ('social',     24, 35, 'Does your child play alongside other children (even if not together)?', 1),
  ('social',     24, 35, 'Does your child show interest in other children?', 2),
  ('cognitive',  24, 35, 'Does your child sort objects by shape or colour?', 1),
  ('cognitive',  24, 35, 'Does your child complete a simple puzzle with a few pieces?', 2),
  ('behavioural',24, 35, 'Does your child follow simple routines (mealtime, bedtime) without major resistance?', 1),
  ('behavioural',24, 35, 'Does your child cope with brief separations from you?', 2),
  -- 36-47 months
  ('motor',      36, 47, 'Does your child climb stairs using alternating feet?', 1),
  ('motor',      36, 47, 'Does your child draw a circle when shown how?', 2),
  ('language',   36, 47, 'Does your child speak in short sentences of three or more words?', 1),
  ('language',   36, 47, 'Do unfamiliar people usually understand what your child says?', 2),
  ('social',     36, 47, 'Does your child take turns when playing with other children?', 1),
  ('social',     36, 47, 'Does your child engage in pretend/make-believe play?', 2),
  ('cognitive',  36, 47, 'Does your child count a few objects out loud?', 1),
  ('cognitive',  36, 47, 'Does your child know their own first name and age?', 2),
  ('behavioural',36, 47, 'Can your child sit and attend to a short activity or story?', 1),
  ('behavioural',36, 47, 'Does your child manage frustration without frequent aggressive outbursts?', 2),
  -- 48-60 months
  ('motor',      48, 60, 'Does your child hop or stand briefly on one foot?', 1),
  ('motor',      48, 60, 'Does your child use scissors to cut paper?', 2),
  ('language',   48, 60, 'Does your child tell a simple story or describe a recent event?', 1),
  ('language',   48, 60, 'Does your child answer simple "why" or "how" questions?', 2),
  ('social',     48, 60, 'Does your child play cooperatively, sharing and taking turns?', 1),
  ('social',     48, 60, 'Does your child show concern when another child is upset?', 2),
  ('cognitive',  48, 60, 'Does your child recognise some letters or numbers?', 1),
  ('cognitive',  48, 60, 'Does your child follow a two- or three-step instruction?', 2),
  ('behavioural',48, 60, 'Does your child separate from you at nursery/school without prolonged distress?', 1),
  ('behavioural',48, 60, 'Does your child follow classroom/household rules most of the time?', 2)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. developmental_screenings — parent/staff-completed, clinician-reviewed
-- ---------------------------------------------------------------------------
create table if not exists public.developmental_screenings (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  patient_id             uuid not null references public.profiles (id) on delete cascade,
  screening_date         date not null default current_date,
  age_months_at_screening integer not null,
  age_band_months_min    integer not null,
  age_band_months_max    integer not null,
  -- {item_id: 'yes'|'sometimes'|'not_yet'}
  responses              jsonb not null default '{}'::jsonb,
  -- {domain: percentage_0_to_100}
  domain_scores          jsonb not null default '{}'::jsonb,
  flagged_domains        public.developmental_domain[] not null default '{}',
  overall_flag           boolean not null default false,
  logged_by_profile_id   uuid references public.profiles (id) on delete set null,
  reviewed_by            uuid references public.clinical_staff (id) on delete set null,
  reviewed_at            timestamptz,
  review_note            text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists developmental_screenings_patient_idx
  on public.developmental_screenings (patient_id, screening_date desc);
create index if not exists developmental_screenings_org_idx
  on public.developmental_screenings (organisation_id);
create index if not exists developmental_screenings_flagged_idx
  on public.developmental_screenings (organisation_id, overall_flag) where overall_flag;

drop trigger if exists developmental_screenings_set_updated_at on public.developmental_screenings;
create trigger developmental_screenings_set_updated_at
  before update on public.developmental_screenings
  for each row execute function private.set_updated_at();

comment on column public.developmental_screenings.domain_scores is
  'Original, non-normed scoring: yes=100%, sometimes=50%, not_yet=0%, averaged per domain over answered items in that domain. NOT a validated/licensed instrument score (no ASQ-3 equivalence) — see this file''s header.';
comment on column public.developmental_screenings.flagged_domains is
  'Domains scoring below the conservative default concern threshold (private.score_developmental_screening, currently 50%). A screening aid routing to clinical review, never a diagnosis.';

-- Scores the screening from responses + the item bank. Runs BEFORE INSERT so
-- a client can never submit a fabricated score alongside raw answers.
create or replace function private.score_developmental_screening()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dob date;
  v_domain public.developmental_domain;
  v_scores jsonb := '{}'::jsonb;
  v_flagged public.developmental_domain[] := '{}';
  v_total numeric;
  v_count int;
  v_pct numeric;
  v_threshold numeric := 50;
begin
  -- Age (and therefore which item-bank age band applies) is always
  -- server-derived from the patient's own date_of_birth, never trusted from
  -- the client — same discipline as private.stamp_growth_measurement.
  select date_of_birth into v_dob from public.profiles where id = new.patient_id;
  if v_dob is null then
    raise exception 'Cannot record a developmental screening: % has no date of birth on file.', new.patient_id
      using errcode = 'check_violation';
  end if;
  new.age_months_at_screening := floor((new.screening_date - v_dob) / 30.4375);

  select i.age_band_months_min, i.age_band_months_max
    into new.age_band_months_min, new.age_band_months_max
  from public.developmental_questionnaire_items i
  where i.age_band_months_min <= new.age_months_at_screening
    and i.age_band_months_max >= new.age_months_at_screening
  limit 1;

  if new.age_band_months_min is null then
    raise exception 'No developmental screening age band covers % months old', new.age_months_at_screening
      using errcode = 'check_violation';
  end if;

  foreach v_domain in array enum_range(null::public.developmental_domain)
  loop
    select
      sum(case (new.responses ->> i.id::text)
            when 'yes' then 100
            when 'sometimes' then 50
            when 'not_yet' then 0
          end),
      count(*)
    into v_total, v_count
    from public.developmental_questionnaire_items i
    where i.domain = v_domain
      and i.age_band_months_min = new.age_band_months_min
      and i.age_band_months_max = new.age_band_months_max
      and new.responses ? i.id::text;

    if v_count > 0 then
      v_pct := round(v_total / v_count, 1);
      v_scores := v_scores || jsonb_build_object(v_domain::text, v_pct);
      if v_pct < v_threshold then
        v_flagged := array_append(v_flagged, v_domain);
      end if;
    end if;
  end loop;

  new.domain_scores := v_scores;
  new.flagged_domains := v_flagged;
  new.overall_flag := coalesce(array_length(v_flagged, 1), 0) > 0;

  if new.patient_id is distinct from (select auth.uid()) then
    new.logged_by_profile_id := (select auth.uid());
  else
    new.logged_by_profile_id := null;
  end if;

  if new.overall_flag then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail)
    values (
      new.organisation_id,
      new.patient_id,
      'clinician_review',
      'open',
      'Developmental screening flagged for review',
      format('Domains below the concern threshold: %s. Screening aid only — not a diagnosis.',
             array_to_string(v_flagged, ', '))
    );
  end if;

  return new;
end;
$$;

drop trigger if exists developmental_screenings_score on public.developmental_screenings;
create trigger developmental_screenings_score
  before insert on public.developmental_screenings
  for each row execute function private.score_developmental_screening();

-- A patient/parent session may never set the clinical-review fields itself —
-- same guard shape as private.enforce_emergency_event_update.
create or replace function private.enforce_developmental_screening_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not private.is_org_staff(new.organisation_id) then
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    new.review_note := old.review_note;
    new.responses := old.responses;
    new.domain_scores := old.domain_scores;
    new.flagged_domains := old.flagged_domains;
    new.overall_flag := old.overall_flag;
  end if;
  return new;
end;
$$;

drop trigger if exists developmental_screenings_update_guard on public.developmental_screenings;
create trigger developmental_screenings_update_guard
  before update on public.developmental_screenings
  for each row execute function private.enforce_developmental_screening_update();

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table public.developmental_screenings enable row level security;

drop policy if exists developmental_screenings_select on public.developmental_screenings;
create policy developmental_screenings_select on public.developmental_screenings
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category)
  );

drop policy if exists developmental_screenings_insert on public.developmental_screenings;
create policy developmental_screenings_insert on public.developmental_screenings
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_act_for(patient_id)
  );

drop policy if exists developmental_screenings_update on public.developmental_screenings;
create policy developmental_screenings_update on public.developmental_screenings
  for update to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_act_for(patient_id)
  )
  with check (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_act_for(patient_id)
  );

drop policy if exists developmental_screenings_delete on public.developmental_screenings;
create policy developmental_screenings_delete on public.developmental_screenings
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.developmental_screenings to authenticated;

-- Assertions.
do $$
declare v_item_count int;
begin
  select count(*) into v_item_count from public.developmental_questionnaire_items;
  if v_item_count <> 60 then
    raise exception 'expected 60 seeded developmental_questionnaire_items, found %', v_item_count;
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'developmental_screenings'
      and policyname = 'developmental_screenings_insert'
      and with_check::text like '%can_act_for%'
  ) then
    raise exception 'a parent/guardian must be able to complete a screening for a child they manage';
  end if;
end $$;
