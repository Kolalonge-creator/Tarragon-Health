-- Diaspora sponsorship: the Care Report a sponsor receives, and the patient's
-- control over what it contains.
-- Founder decision, 2026-09-10.
--
-- WHAT THE PRODUCT ACTUALLY IS
-- ----------------------------
-- Remittances to Nigeria run above 20 billion dollars a year and a documented
-- share of that goes to relatives' healthcare. The sponsor's problem is not the
-- money. It is not knowing whether the money reached care. A bank transfer can
-- never answer that; this can.
--
-- The purchase mechanism already exists and is sound -- public.care_vouchers
-- carries purchaser_profile_id, beneficiary_profile_id, the product bought, and
-- the activated and redeemed timestamps. What was missing is the thing the
-- sponsor actually wants, which is evidence, and a way for the patient to
-- decide how much of it to give.
--
-- No new payment rail is needed. Paystack accepts international cards at
-- 3.9% + 100 naira, so a sponsor abroad can pay in naira today. The USD/Stripe
-- path stays removed; nothing here reintroduces it.
--
-- THE CONSENT BOUNDARY, WHICH IS THE WHOLE DESIGN
-- -----------------------------------------------
-- The existing rule is that a sponsor sees that they bought something and later
-- that it was used, and nothing about results. An activity report -- "eleven
-- readings logged in March, a doctor reviewed them on the twelfth" -- is more
-- than that rule allows by default, so it is NOT granted by default. The
-- default sharing level is 'none', and only the patient can change it. A
-- sponsor cannot request an upgrade, a member of staff cannot set it on the
-- patient's behalf, and buying a more expensive product does not buy more
-- visibility.
--
-- Even at the most generous level this never returns a clinical VALUE. No blood
-- pressure figure, no glucose figure, no diagnosis, no medication name. It
-- returns facts about activity: that readings were logged, how many, that a
-- doctor reviewed them, and when the next check is due. That is what reassures
-- a sponsor, and it is the most that can be given without turning a payment
-- into a right to read somebody's medical record.

begin;

create type public.sponsor_sharing_level as enum ('none', 'activity', 'full');

comment on type public.sponsor_sharing_level is
  'none: the sponsor sees only that they paid and that it was activated and used. activity: plus counts of readings logged, whether a doctor reviewed, and when the next check is due -- never a clinical value. full: activity plus the patient''s own quarterly progress report, which the patient chooses to forward. Default is none; only the patient may raise it.';

create table public.sponsor_sharing_preferences (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  patient_id      uuid not null references public.profiles(id) on delete cascade,
  sponsor_id      uuid not null references public.profiles(id) on delete cascade,
  level           public.sponsor_sharing_level not null default 'none',
  decided_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (patient_id, sponsor_id),
  constraint sponsor_sharing_not_self check (patient_id <> sponsor_id)
);

comment on table public.sponsor_sharing_preferences is
  'What a specific sponsor may see about a specific patient. Set by the patient, and by nobody else -- see the write policy, which does not admit org staff. Absence of a row means ''none'', so a sponsor who was never granted anything gets the payment facts alone.';

create index sponsor_sharing_preferences_sponsor_idx
  on public.sponsor_sharing_preferences (sponsor_id, patient_id);

alter table public.sponsor_sharing_preferences enable row level security;

-- The patient sees and sets their own. The sponsor may READ what they have been
-- granted, so the app can tell them honestly that they will not be receiving
-- activity updates rather than silently showing them an empty report.
create policy sponsor_sharing_select on public.sponsor_sharing_preferences
  for select to authenticated
  using (patient_id = (select auth.uid()) or sponsor_id = (select auth.uid()));

-- Deliberately NOT is_org_staff. A member of staff setting this on a patient's
-- behalf would be staff consenting to disclosure for them, which is the exact
-- thing this table exists to prevent. Support handles it by asking the patient
-- to change it in the app.
create policy sponsor_sharing_write on public.sponsor_sharing_preferences
  for all to authenticated
  using (patient_id = (select auth.uid()))
  with check (patient_id = (select auth.uid()));

grant select, insert, update, delete on public.sponsor_sharing_preferences to authenticated;

create trigger sponsor_sharing_set_updated_at before update on public.sponsor_sharing_preferences
  for each row execute function private.set_updated_at();
create trigger audit_row_change_trg after insert or update or delete
  on public.sponsor_sharing_preferences for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- The Care Report
--
-- SECURITY DEFINER because it deliberately reads across a boundary the caller
-- has no direct RLS access to, and returns only the aggregate facts the patient
-- has agreed to. It is scoped to vouchers the CALLER purchased, so a sponsor
-- can only ever ask about someone they actually paid for.
-- ---------------------------------------------------------------------------

create or replace function public.sponsor_care_report(p_beneficiary uuid, p_since date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_caller    uuid := auth.uid();
  v_level     public.sponsor_sharing_level;
  v_since     date := coalesce(p_since, (current_date - interval '30 days')::date);
  v_vouchers  jsonb;
  v_readings  int;
  v_reviewed  timestamptz;
  v_next_due  date;
  v_cover_to  timestamptz;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  -- You may only ask about someone you have actually paid for.
  if not exists (
    select 1 from public.care_vouchers v
     where v.purchaser_profile_id = v_caller
       and v.beneficiary_profile_id = p_beneficiary
  ) then
    raise exception 'You have not sponsored this person''s care.' using errcode = '42501';
  end if;

  select coalesce(
           (select p.level from public.sponsor_sharing_preferences p
             where p.patient_id = p_beneficiary and p.sponsor_id = v_caller),
           'none'::public.sponsor_sharing_level)
    into v_level;

  -- Payment facts. Always available: this is the sponsor's own transaction
  -- record, and it contains nothing clinical.
  select jsonb_agg(jsonb_build_object(
           'voucher_number', v.voucher_number,
           'what',           v.sku_name,
           'paid_kobo',      v.amount_paid_kobo,
           'status',         v.status,
           'activated_at',   v.activated_at,
           'redeemed_at',    v.redeemed_at
         ) order by v.created_at desc)
    into v_vouchers
    from public.care_vouchers v
   where v.purchaser_profile_id = v_caller
     and v.beneficiary_profile_id = p_beneficiary;

  if v_level = 'none' then
    return jsonb_build_object(
      'sharing_level', 'none',
      'vouchers', coalesce(v_vouchers, '[]'::jsonb),
      'note', 'This is everything you have paid for and whether it has been used. They have not chosen to share how their care is going, which is theirs to decide.');
  end if;

  -- Activity facts. Counts and dates only. No clinical value is read here, and
  -- none may be added: a figure in this payload is a disclosure the patient did
  -- not agree to when they chose ''activity''.
  select count(*) into v_readings
    from public.vitals_readings r
   where r.patient_id = p_beneficiary
     and r.taken_at >= v_since;

  select max(a.updated_at) into v_reviewed
    from public.clinician_alerts a
   where a.patient_id = p_beneficiary
     and a.status in ('resolved', 'in_progress')
     and a.updated_at >= v_since;

  select min(s.due_date) into v_next_due
    from public.patient_screening_schedule s
   where s.patient_id = p_beneficiary
     and s.due_date >= current_date;

  select max(sp.expires_at) into v_cover_to
    from public.service_purchases sp
    join public.service_products p on p.id = sp.service_product_id
   where sp.patient_id = p_beneficiary
     and sp.status = 'active'
     and 'vitals_red_flag_doctor_escalation' = any(p.features)
     and (sp.expires_at is null or sp.expires_at > now());

  return jsonb_build_object(
    'sharing_level',        v_level,
    'since',                v_since,
    'vouchers',             coalesce(v_vouchers, '[]'::jsonb),
    'readings_logged',      coalesce(v_readings, 0),
    'last_clinical_review', v_reviewed,
    'next_check_due',       v_next_due,
    'monitoring_active_until', v_cover_to,
    'note', 'Activity only. Their actual readings, results and diagnoses stay private to them and their care team.');
end;
$function$;

comment on function public.sponsor_care_report(uuid, date) is
  'The sponsor-facing Care Report. Returns payment facts always, and activity counts only where the patient has raised sponsor_sharing_preferences.level. NEVER returns a clinical value, and must not be extended to -- if a future change adds one, it is a disclosure the patient did not consent to.';

revoke all on function public.sponsor_care_report(uuid, date) from public;
grant execute on function public.sponsor_care_report(uuid, date) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.sponsor_care_report(uuid, date)', 'EXECUTE') then
    raise exception 'FAIL: anon can EXECUTE sponsor_care_report';
  end if;
  if not has_table_privilege('authenticated', 'public.sponsor_sharing_preferences', 'SELECT') then
    raise exception 'FAIL: authenticated cannot SELECT sponsor_sharing_preferences';
  end if;
  raise notice 'PASS: sponsor Care Report live, default sharing level is none';
end $$;

commit;
