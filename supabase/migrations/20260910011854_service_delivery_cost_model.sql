-- A cost model for doctor time, so a price can be shown to clear its own cost.
-- Founder decision, 2026-09-10.
--
-- THE GAP
-- -------
-- Laboratory pricing on this platform is guarded. private.assert_test_price_covers_cost
-- fires on screen_types, private.enforce_lab_order_not_below_cost fires on
-- lab_orders, and neither will let a test be sold below what the provider
-- charges. Doctor time has had nothing equivalent: no recorded minutes, no
-- clinician rate, no floor. Whether 2,500 naira for a written clinical answer
-- with a 72-hour turnaround clears its delivery cost was not merely unproven,
-- it was unknowable, because no number existed anywhere to check it against.
--
-- THE NUMBERS BELOW ARE MARKET ESTIMATES AND ARE MARKED AS SUCH
-- --------------------------------------------------------------
-- Founder instruction, 2026-09-10: populate with sourced market estimates,
-- flagged provisional, with enforcement in WARN mode until real payroll figures
-- replace them. is_provisional is true on every rate row for exactly that
-- reason, and public.assert_service_price_covers_cost raises a WARNING rather
-- than an exception while any rate it depends on is provisional. It becomes a
-- hard floor automatically, with no code change, the moment someone clears the
-- flag -- which is the point of building it this way rather than leaving the
-- table empty.
--
-- Rate derivation, so a reader can disagree with it specifically rather than
-- generally: assumed monthly cost to Tarragon, multiplied by 1.3 for employer
-- on-costs, divided by 7,920 productive clinical minutes a month (22 working
-- days at 6 productive hours, which is deliberately below an 8-hour day because
-- nobody consults for eight hours).
--
--   Care Coordinator          200,000/month  ->    33/minute
--   Medical Officer           600,000/month  ->   100/minute
--   Senior Medical Officer  1,400,000/month  ->   230/minute
--   Chief Medical Officer   2,500,000/month  ->   410/minute
--
-- Replace these with real figures and clear is_provisional. Until then, treat
-- any margin this model reports as indicative.

begin;

create table public.clinical_tier_cost_rates (
  doctor_tier      public.doctor_tier primary key,
  cost_per_minute_kobo bigint not null check (cost_per_minute_kobo > 0),
  basis            text not null,
  is_provisional   boolean not null default true,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles(id) on delete set null
);

comment on table public.clinical_tier_cost_rates is
  'What a minute of each clinical tier costs Tarragon, fully loaded. Seeded 2026-09-10 with market ESTIMATES, not payroll. While is_provisional is true anywhere, public.assert_service_price_covers_cost warns instead of blocking; clearing the flag turns the same function into a hard floor.';
comment on column public.clinical_tier_cost_rates.basis is
  'How the figure was arrived at, in enough detail that the next person can challenge the assumption rather than the number.';

insert into public.clinical_tier_cost_rates (doctor_tier, cost_per_minute_kobo, basis) values
  ('care_coordinator',       3300, 'Estimate: 200,000/month x 1.3 on-costs / 7,920 productive minutes. Nigerian non-clinical coordinator salary, market estimate 2026-09-10.'),
  ('medical_officer',       10000, 'Estimate: 600,000/month x 1.3 on-costs / 7,920 productive minutes. Nigerian private-sector medical officer salary, market estimate 2026-09-10.'),
  ('senior_medical_officer', 23000, 'Estimate: 1,400,000/month x 1.3 on-costs / 7,920 productive minutes. Nigerian senior/specialist salary, market estimate 2026-09-10.'),
  ('chief_medical_officer',  41000, 'Estimate: 2,500,000/month x 1.3 on-costs / 7,920 productive minutes. Contracted CMO, market estimate 2026-09-10.')
on conflict (doctor_tier) do nothing;

create table public.service_delivery_cost_model (
  service_product_code text primary key,
  expected_minutes     numeric(6,1) not null check (expected_minutes > 0),
  delivered_by_tier    public.doctor_tier not null,
  coordination_minutes numeric(6,1) not null default 0 check (coordination_minutes >= 0),
  units_per_term       numeric(6,1) not null default 1 check (units_per_term > 0),
  notes                text,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.profiles(id) on delete set null
);

comment on table public.service_delivery_cost_model is
  'Minutes of clinical time each paid product is expected to consume. Keyed on service_products.code by TEXT rather than a foreign key so a retired product keeps its costing for historical margin analysis instead of disappearing from the record.';
comment on column public.service_delivery_cost_model.units_per_term is
  'How many times the work happens across the product term. One for a single credit; twelve for a monthly review inside a twelve-month programme. This is what stops a term product being costed as though it were delivered once.';
comment on column public.service_delivery_cost_model.coordination_minutes is
  'Care Coordinator minutes, costed at the coordinator rate rather than a doctor''s. Chasing a patient who has not logged a reading is real work and real cost, and pretending it is free is how a price ends up below its true floor.';

insert into public.service_delivery_cost_model
  (service_product_code, expected_minutes, delivered_by_tier, coordination_minutes, units_per_term, notes)
values
  ('async_consult_credit',            12, 'medical_officer',         3,  1, 'Read the record, write a considered answer, file it. 72-hour SLA.'),
  ('confidential_message_credit',     12, 'medical_officer',         0,  1, 'As above; no coordinator involvement by design, the thread is confidential.'),
  ('prescription_renewal_credit',     10, 'medical_officer',         3,  1, 'Review the existing prescription, confirm it is still appropriate, sign.'),
  ('written_result_interpretation',   20, 'medical_officer',         3,  1, 'Read an uploaded result from any provider, write a plain-language interpretation, file it to the record.'),
  ('second_opinion_credit',           25, 'senior_medical_officer',  3,  1, 'Senior review of an existing result or diagnosis, written assessment. Thinnest margin on the ladder; watch it.'),
  ('video_visit_credit',              20, 'medical_officer',         5,  1, '15-minute consultation plus notes, plus slot coordination.'),
  ('result_interpretation_credit',    25, 'medical_officer',         5,  1, 'Prepared read plus a 15-minute video walkthrough.'),
  ('senior_case_review_credit',       60, 'senior_medical_officer', 10,  1, 'Every condition, one written plan. The most doctor time of any one-off product.'),

  ('verified_document_fit_to_work',             15, 'medical_officer', 5, 1, 'Record review, attestation drafting, signature.'),
  ('verified_document_return_to_work',          15, 'medical_officer', 5, 1, 'As above.'),
  ('verified_document_medication_carry_letter', 12, 'medical_officer', 5, 1, 'Drug list, doses, indications, in the form officials expect.'),
  ('verified_document_school_health_form',      15, 'medical_officer', 8, 1, 'Coordinator assembles the immunisation record; the doctor attests it.'),
  ('verified_document_travel_health_certificate', 20, 'medical_officer', 5, 1, 'Stability assessment plus medication list for an airline or insurer.'),
  ('verified_document_specialist_referral_letter', 25, 'medical_officer', 5, 1, 'History, medicines, results and the specific clinical question.'),
  ('verified_document_insurance_medical_summary',  35, 'senior_medical_officer', 8, 1, 'The most detailed document issued; senior tier because an insurer relies on it.'),

  -- Monitoring is costed per EXCEPTION, not per patient-month: the watch itself
  -- is deterministic and free, and the only cost is a doctor looking at a
  -- reading that crossed a threshold. 0.3 escalations per patient-month is an
  -- assumption and the single most important number to replace with observed
  -- data once there is any.
  ('continuous_monitoring_3m',        15, 'medical_officer', 5,  0.9, '0.3 escalations per patient-month over 3 months. Assumption, not observation.'),
  ('continuous_monitoring_6m',        15, 'medical_officer', 5,  1.8, 'As above over 6 months.'),
  ('continuous_monitoring_12m',       15, 'medical_officer', 5,  3.6, 'As above over 12 months.'),

  ('weight_management_3m',            30, 'senior_medical_officer', 20, 4.0, 'Eligibility assessment plus 3 monthly reviews; coordinator handles fortnightly check-in chasing.'),
  ('weight_management_6m',            30, 'senior_medical_officer', 20, 7.0, 'Eligibility plus 6 monthly reviews.'),
  ('weight_management_12m',           30, 'senior_medical_officer', 20, 13.0, 'Eligibility plus 12 monthly reviews.'),

  ('chronic_doctor_supported_pack',   40, 'senior_medical_officer', 30, 4.0, 'Three doctor reviews plus one medication review across twelve weeks.')
on conflict (service_product_code) do update
  set expected_minutes     = excluded.expected_minutes,
      delivered_by_tier    = excluded.delivered_by_tier,
      coordination_minutes = excluded.coordination_minutes,
      units_per_term       = excluded.units_per_term,
      notes                = excluded.notes;

-- ---------------------------------------------------------------------------
-- Margin view and the floor
-- ---------------------------------------------------------------------------

create or replace view public.service_product_margins as
select
  p.code,
  p.name,
  p.price_kobo,
  m.delivered_by_tier,
  m.expected_minutes,
  m.units_per_term,
  round((m.expected_minutes * r.cost_per_minute_kobo
       + m.coordination_minutes * cr.cost_per_minute_kobo) * m.units_per_term) as delivery_cost_kobo,
  -- Paystack: 1.5% on local cards, plus a 100 naira flat fee that is waived
  -- entirely at or below 2,500 naira. The cliff is real and worth seeing in the
  -- same table as the margin.
  round(p.price_kobo * 0.015) + case when p.price_kobo > 250000 then 10000 else 0 end as payment_fee_kobo,
  p.price_kobo
    - round((m.expected_minutes * r.cost_per_minute_kobo
           + m.coordination_minutes * cr.cost_per_minute_kobo) * m.units_per_term)
    - (round(p.price_kobo * 0.015) + case when p.price_kobo > 250000 then 10000 else 0 end)
    as contribution_kobo,
  bool_or(r.is_provisional or cr.is_provisional) over () as rates_are_provisional
from public.service_products p
join public.service_delivery_cost_model m on m.service_product_code = p.code
join public.clinical_tier_cost_rates r  on r.doctor_tier = m.delivered_by_tier
join public.clinical_tier_cost_rates cr on cr.doctor_tier = 'care_coordinator'
where p.is_active;

comment on view public.service_product_margins is
  'Price, modelled delivery cost, payment processing and contribution for every active paid product. rates_are_provisional says whether the underlying clinician rates are real payroll or the 2026-09-10 market estimates; while it is true, treat every figure here as indicative.';

create or replace function public.assert_service_price_covers_cost()
returns table (code text, price_kobo bigint, delivery_cost_kobo numeric, contribution_kobo numeric, verdict text)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_provisional boolean;
  v_failing int;
begin
  select bool_or(is_provisional) into v_provisional from public.clinical_tier_cost_rates;

  return query
    select m.code, m.price_kobo, m.delivery_cost_kobo, m.contribution_kobo,
           case
             when m.contribution_kobo < 0 then 'BELOW COST'
             when m.contribution_kobo < m.delivery_cost_kobo * 0.5 then 'THIN'
             else 'OK'
           end
      from public.service_product_margins m
     order by m.contribution_kobo asc;

  select count(*) into v_failing
    from public.service_product_margins m
   where m.contribution_kobo < 0;

  if v_failing > 0 then
    if v_provisional then
      raise warning '% product(s) price below modelled delivery cost. Rates are PROVISIONAL market estimates, so this is advisory. Replace clinical_tier_cost_rates with payroll and clear is_provisional to make it binding.', v_failing;
    else
      raise exception '% product(s) price below delivery cost', v_failing;
    end if;
  end if;
end;
$function$;

alter table public.clinical_tier_cost_rates    enable row level security;
alter table public.service_delivery_cost_model enable row level security;

create policy clinical_tier_cost_rates_admin on public.clinical_tier_cost_rates
  for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy service_delivery_cost_model_admin on public.service_delivery_cost_model
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- Cost and pay rates are commercially sensitive and have no patient-facing use.
-- Admin only, and the grant is what makes the admin console able to read them
-- at all -- RLS restricts rows, it does not grant table access.
grant select, insert, update, delete on public.clinical_tier_cost_rates    to authenticated;
grant select, insert, update, delete on public.service_delivery_cost_model to authenticated;

revoke all on public.service_product_margins from public;
grant select on public.service_product_margins to authenticated;

revoke all on function public.assert_service_price_covers_cost() from public;
grant execute on function public.assert_service_price_covers_cost() to authenticated;

do $$
declare
  v_uncosted int;
  v_below    int;
begin
  select count(*) into v_uncosted
    from public.service_products p
   where p.is_active
     and p.price_kobo > 0
     and not exists (select 1 from public.service_delivery_cost_model m where m.service_product_code = p.code);
  if v_uncosted > 0 then
    raise warning '% active paid product(s) have no delivery costing. They are: %', v_uncosted,
      (select string_agg(p.code, ', ') from public.service_products p
        where p.is_active and p.price_kobo > 0
          and not exists (select 1 from public.service_delivery_cost_model m where m.service_product_code = p.code));
  end if;

  select count(*) into v_below from public.service_product_margins where contribution_kobo < 0;
  raise notice 'PASS: cost model live. % product(s) modelled below cost on PROVISIONAL rates; % uncosted.', v_below, v_uncosted;
end $$;

commit;
