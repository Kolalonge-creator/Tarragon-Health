-- Tarragon Health — Hypertension pathway Sprint C: drug ladder + drug safety
-- (TH-CP-HTN-001 §8.2, §12.3, §12.5, §14.3, §14.4).
--
-- H6 HEARTS stepped ladder reference (amlodipine -> +losartan SPC -> up-titrate
--    -> +HCTZ -> refer), ARB preferred over ACEi (Black-African evidence §12.4).
-- H7 ARB + thiazide + K-sparing drug-safety monitoring rows (drug_monitoring_
--    rules previously covered only ACE inhibitors + statins — not the ARBs the
--    pathway actually prefers, nor thiazides).
-- H8 prescribing hard block: never combine an ACE inhibitor and an ARB (§14.4).

create or replace function private.bp_drug_class(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name is null then null
    when lower(p_name) ~ '(losartan|telmisartan|valsartan|irbesartan|candesartan|olmesartan|azilsartan)' then 'arb'
    when lower(p_name) ~ '(ramipril|lisinopril|enalapril|perindopril|captopril|benazepril|fosinopril|quinapril)' then 'acei'
    when lower(p_name) ~ '(amlodipine|nifedipine|felodipine|lercanidipine|nitrendipine)' then 'ccb'
    when lower(p_name) ~ '(hydrochlorothiazide|hctz|indapamide|bendroflumethiazide|chlortalidone|chlorthalidone)' then 'thiazide'
    when lower(p_name) ~ '(spironolactone|amiloride|eplerenone|moduretic)' then 'k_sparing'
    else null
  end;
$$;

-- H7  ARB / thiazide / K-sparing monitoring rows.
insert into public.drug_monitoring_rules (match_pattern, drug_class, monitoring_label, interval_months, monitor_on_initiation, is_active)
select v.match_pattern, v.drug_class, v.monitoring_label, v.interval_months, v.monitor_on_initiation, true
from (values
  ('losartan%',           'ARB', 'Kidney function & potassium (U&E) before, 1-2 weeks after start/increase', 12, true),
  ('telmisartan%',        'ARB', 'Kidney function & potassium (U&E) before, 1-2 weeks after start/increase', 12, true),
  ('valsartan%',          'ARB', 'Kidney function & potassium (U&E) before, 1-2 weeks after start/increase', 12, true),
  ('irbesartan%',         'ARB', 'Kidney function & potassium (U&E) before, 1-2 weeks after start/increase', 12, true),
  ('candesartan%',        'ARB', 'Kidney function & potassium (U&E) before, 1-2 weeks after start/increase', 12, true),
  ('hydrochlorothiazide%','Thiazide diuretic', 'Electrolytes (Na, K), renal function & glucose before, ~4 weeks after start', 12, true),
  ('indapamide%',         'Thiazide diuretic', 'Electrolytes (Na, K), renal function & glucose before, ~4 weeks after start', 12, true),
  ('spironolactone%',     'Potassium-sparing diuretic', 'Potassium & renal function (U&E) before, 1-2 weeks after start', 6, true),
  ('amiloride%',          'Potassium-sparing diuretic', 'Potassium & renal function (U&E) before, 1-2 weeks after start', 6, true)
) as v(match_pattern, drug_class, monitoring_label, interval_months, monitor_on_initiation)
where not exists (
  select 1 from public.drug_monitoring_rules r where r.match_pattern = v.match_pattern and r.drug_class = v.drug_class
);

-- H6  HEARTS ladder reference (global catalogue, admin-editable).
create table if not exists public.bp_ladder_steps (
  step       smallint primary key check (step between 1 and 5),
  regimen    text not null,
  notes      text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bp_ladder_steps enable row level security;

drop policy if exists bp_ladder_steps_read on public.bp_ladder_steps;
create policy bp_ladder_steps_read on public.bp_ladder_steps
  for select to authenticated using (true);
drop policy if exists bp_ladder_steps_admin on public.bp_ladder_steps;
create policy bp_ladder_steps_admin on public.bp_ladder_steps
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

grant select, insert, update, delete on public.bp_ladder_steps to authenticated;

insert into public.bp_ladder_steps (step, regimen, notes) values
  (1, 'Amlodipine 5 mg once daily', 'First-line for most; effective in Black-African patients; no blood monitoring.'),
  (2, 'Amlodipine 5 mg + Losartan 50 mg (single-pill combination preferred)', 'Telmisartan 40 mg preferable to losartan if available. Check U&E/K+ around ARB start.'),
  (3, 'Amlodipine 10 mg + Losartan 100 mg (SPC preferred)', 'Up-titrate both components.'),
  (4, 'Amlodipine 10 mg + Losartan 100 mg + Hydrochlorothiazide 25 mg', 'May substitute HCTZ with amiloride 2.5 mg/HCTZ 25 mg (Moduretic 1/2 tab) if HCTZ unavailable. Check electrolytes.'),
  (5, 'Refer to specialist (resistant hypertension)', 'Consider adding spironolactone 25 mg under specialist care after excluding secondary causes and confirming adherence.')
on conflict (step) do nothing;

-- H8  Prescribing hard block: never ACE inhibitor + ARB together (clinician/
-- specialist rows only; a patient recording reality is never blocked).
create or replace function private.enforce_bp_prescribing_safety()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class text;
  v_conflict text;
begin
  if new.is_active is not true or new.source = 'patient' then
    return new;
  end if;
  v_class := private.bp_drug_class(new.drug_name);
  if v_class not in ('acei', 'arb') then
    return new;
  end if;

  v_conflict := case when v_class = 'acei' then 'arb' else 'acei' end;

  if exists (
    select 1 from public.medications m
    where m.patient_id = new.patient_id
      and m.is_active is true
      and m.id <> new.id
      and private.bp_drug_class(m.drug_name) = v_conflict
  ) then
    raise exception
      'Unsafe combination: an ACE inhibitor and an ARB must never be prescribed together (TH-CP-HTN-001 §14.4). Stop one before adding the other.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists medications_bp_prescribing_safety on public.medications;
create trigger medications_bp_prescribing_safety
  before insert or update on public.medications
  for each row execute function private.enforce_bp_prescribing_safety();
