-- S51 pre-fix (SAFETY, apply live first): INV-04. The assistant and the result explainer must never read, quote or
-- explain a positive HIV, hepatitis B surface antigen or hepatitis C antibody result, or anything flagged sensitive.
--
-- The hole this closes: the AI path (apps/web/src/lib/ai-coach tools and context, apps/web/src/lib/patient-explainer
-- snapshot) read public.lab_analyte_readings directly. That table has no sensitive flag and no release state, so a
-- sensitive result written there would have reached the model. lab_result_items (S27) already carries
-- sensitive_positive, but the AI path never read it either.
--
-- Design (fail safe, deterministic, no model):
--   1. public.ai_excluded_analyte_tokens: the analyte-code tokens that mark a screening analyte (versioned config,
--      mirrored by packages/shared proposed-config key assistant.excluded_analytes; a test pins the two together).
--   2. private.is_ai_excluded_analyte(code, value_text): true when the normalised code contains a token AND the result
--      is not an explicit negative. Unknown, positive, reactive, indeterminate, blank: all excluded. Only a plain
--      negative of a screening analyte may still be explained.
--   3. lab_analyte_readings.sensitive_positive (additive, default false) is maintained by a trigger from (2), so the
--      INV-03/04 release machinery and any reader can respect it.
--   4. Two security_invoker views, the ONLY lab surface the AI path may read:
--        public.ai_readable_lab_readings      lab_analyte_readings minus excluded rows
--        public.ai_readable_lab_result_items  lab_result_items of RELEASED results minus sensitive_positive/excluded rows
--      RLS of the base tables still applies (security_invoker), so the views never widen access.
--   A repo scan test (apps/web ai-coach/patient-explainer) fails if the AI path queries the base tables again.
--
-- The token list also covers the neighbouring markers a lab reports for the same conditions (hepatitis B DNA and antigen and antibody
-- markers, CD4, viral load, p24). Syphilis and other STI tests are a CMO decision (OQ-290), not guessed here.
--
-- Live counts before this migration: 0 rows in lab_analyte_readings, lab_result_items and lab_results, so there is no
-- data to backfill.

create table public.ai_excluded_analyte_tokens (
  token          text primary key check (token = lower(token) and token ~ '^[a-z0-9_]+$'),
  note           text,
  config_version integer not null default 1,
  created_at     timestamptz not null default now()
);

-- ai-excluded-analytes-begin
insert into public.ai_excluded_analyte_tokens (token, note, config_version)
select t.token, 'PROPOSED screening analyte token (CMO confirms the list)', 1
  from jsonb_array_elements_text($json$["hiv","hbsag","hbs_ag","hcv","hepatitis","hep_b","hep_c","hepb","hepc","hbv","hbeag","hbe_ag","anti_hbc","anti_hbs","cd4","viral_load","p24","aids","retroviral"]$json$::jsonb) as t(token);
-- ai-excluded-analytes-end

alter table public.ai_excluded_analyte_tokens enable row level security;
create policy ai_excluded_analyte_tokens_read on public.ai_excluded_analyte_tokens for select to authenticated using (true);
revoke all on public.ai_excluded_analyte_tokens from public, anon, authenticated;
grant select on public.ai_excluded_analyte_tokens to authenticated;

create function private.is_ai_excluded_analyte(p_code text, p_value_text text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- a screening analyte (code contains a token) ...
    exists (
      select 1 from public.ai_excluded_analyte_tokens t
       where position(t.token in lower(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]+', '_', 'g'))) > 0
    )
    -- ... unless the result is an explicit negative. Anything else (positive, reactive, blank, numeric, odd text) is excluded.
    and lower(btrim(coalesce(p_value_text, ''))) not in ('negative', 'non-reactive', 'non reactive', 'nonreactive', 'not detected')
$$;
revoke all on function private.is_ai_excluded_analyte(text, text) from public, anon;
grant execute on function private.is_ai_excluded_analyte(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- lab_analyte_readings.sensitive_positive, kept true by a trigger
-- ---------------------------------------------------------------------------
alter table public.lab_analyte_readings add column sensitive_positive boolean not null default false;
comment on column public.lab_analyte_readings.sensitive_positive is
  'INV-04: true for a screening analyte (HIV, HBsAg, HCV) that is not an explicit negative. Set by trigger; the AI path never reads such a row.';

create function private.lab_analyte_readings_set_sensitive() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  new.sensitive_positive := new.sensitive_positive or private.is_ai_excluded_analyte(new.code, new.value_text);
  return new;
end $$;
revoke all on function private.lab_analyte_readings_set_sensitive() from public, anon;
create trigger lab_analyte_readings_set_sensitive before insert or update on public.lab_analyte_readings
  for each row execute function private.lab_analyte_readings_set_sensitive();

-- ---------------------------------------------------------------------------
-- The only lab surface the AI path may read
-- ---------------------------------------------------------------------------
create view public.ai_readable_lab_readings with (security_invoker = true) as
select r.id, r.patient_id, r.organisation_id, r.code, r.value, r.value_text, r.unit, r.taken_at,
       r.reference_range_low, r.reference_range_high, r.abnormal_flag, r.report_status
  from public.lab_analyte_readings r
 where not r.sensitive_positive
   -- a preliminary report is not yet a result anyone has stood behind; corrected and amended rows are the labs' own later word
   and r.report_status <> 'preliminary'
   and not private.is_ai_excluded_analyte(r.code, r.value_text);

create view public.ai_readable_lab_result_items with (security_invoker = true) as
select i.id, i.lab_result_id, i.patient_id, i.organisation_id, i.analyte_code, i.value_numeric, i.value_text, i.unit,
       i.ref_low, i.ref_high, i.flag, res.received_at
  from public.lab_result_items i
  join public.lab_results res on res.id = i.lab_result_id
 where res.release_state = 'released'
   and not i.sensitive_positive
   and not private.is_ai_excluded_analyte(i.analyte_code, i.value_text);

revoke all on public.ai_readable_lab_readings, public.ai_readable_lab_result_items from public, anon, authenticated;
grant select on public.ai_readable_lab_readings, public.ai_readable_lab_result_items to authenticated;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if not private.is_ai_excluded_analyte('hiv_screen', 'positive') then raise exception 'hiv positive not excluded'; end if;
  if not private.is_ai_excluded_analyte('HBsAg', null) then raise exception 'blank hbsag not excluded'; end if;
  if not private.is_ai_excluded_analyte('anti-HCV', 'reactive') then raise exception 'reactive hcv not excluded'; end if;
  if private.is_ai_excluded_analyte('hiv_screen', 'negative') then raise exception 'negative hiv wrongly excluded'; end if;
  if private.is_ai_excluded_analyte('hba1c', null) then raise exception 'hba1c wrongly excluded'; end if;
  if has_function_privilege('anon', 'private.is_ai_excluded_analyte(text, text)', 'EXECUTE') then raise exception 'anon can execute'; end if;
  if has_table_privilege('anon', 'public.ai_readable_lab_readings', 'SELECT') then raise exception 'anon can read the AI view'; end if;
  if (select count(*) from public.ai_excluded_analyte_tokens) <> 19 then raise exception 'token seed count'; end if;
  if not private.is_ai_excluded_analyte('cd4_count', null) then raise exception 'cd4 not excluded'; end if;
  if not private.is_ai_excluded_analyte('HBV DNA', null) then raise exception 'hbv dna not excluded'; end if;
end $$;
