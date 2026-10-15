-- S76 B1 (decision S-13): three more competencies as DATA (maternal, mental_health, paediatrics), a link from a scenario
-- to the competency it tests, and a rule that a competency with approved scenarios cannot be granted until the clinician
-- has passed them.
--
--   * doctor_tier stays the queue gate; nothing here changes it. Competencies are data rows (23.11 / S-13).
--   * No scenario is written here. The chief medical officer writes and approves them (save_credential_test_case /
--     approve_credential_content, then set_credential_test_case_competency below). With ZERO approved scenarios for a
--     competency the grant works exactly as today (grant_clinician_competency, chief medical officer, audited).
--   * Once ONE approved scenario carries the competency, the grant needs a passed competency test. A trigger on
--     clinician_competencies enforces it, so approve_clinician_application, grant_clinician_competency and every future
--     door are covered by the same rule.
--   * Onboarding test: start_credential_test is patched so a competency scenario never enters the general entry test.
--   * First-20-tasks audit in a new competency: NOT built. The S20 sampler keys on the clinician's credentialing level
--     only and there is no task type to competency map to extend (see the report).
-- Live counts: competencies 7 before; credential_test_cases has no competency column before this migration.

insert into public.competencies (code, label, description, requires_level) values
  ('maternal', 'Maternal health', 'Antenatal and postnatal care within protocols.', 1),
  ('mental_health', 'Mental health', 'Mental health follow-up within protocols.', 1),
  ('paediatrics', 'Paediatrics', 'Care of children within protocols.', 1)
on conflict (code) do nothing;

alter table public.credential_test_cases
  add column competency_code text references public.competencies (code);
create index credential_test_cases_competency_idx on public.credential_test_cases (competency_code) where competency_code is not null;

-- A competency test attempt by an existing clinician (the application based attempts above are for entry only).
create table public.competency_test_attempts (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  clinical_staff_id uuid not null references public.clinical_staff (id) on delete cascade,
  competency_code   text not null references public.competencies (code),
  case_ids          uuid[] not null,
  answers           jsonb,
  score_percent     numeric(5, 2),
  red_total         integer,
  red_correct       integer,
  passed            boolean,
  started_at        timestamptz not null default now(),
  submitted_at      timestamptz,
  is_test           boolean not null default false
);
create index competency_test_attempts_staff_idx on public.competency_test_attempts (clinical_staff_id, competency_code);
alter table public.competency_test_attempts enable row level security;
create policy competency_test_attempts_select on public.competency_test_attempts for select to authenticated
  using (private.can_credential_review() or exists (
    select 1 from public.clinical_staff cs where cs.id = clinical_staff_id and cs.profile_id = (select auth.uid())));
revoke all on public.competency_test_attempts from anon;
revoke insert, update, delete, truncate on public.competency_test_attempts from authenticated;
grant select on public.competency_test_attempts to authenticated;

-- Does this competency have approved scenarios (so a passed test is required)?
create function private.competency_has_cases(p_code text) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.credential_test_cases where competency_code = p_code and status = 'approved') $$;
revoke all on function private.competency_has_cases(text) from public, anon, authenticated;

-- Has this clinician passed a test that covered every approved red scenario of the competency?
create function private.competency_test_passed(p_staff uuid, p_code text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.competency_test_attempts t
    where t.clinical_staff_id = p_staff and t.competency_code = p_code and t.passed
      and not exists (select 1 from public.credential_test_cases c
                      where c.competency_code = p_code and c.status = 'approved' and c.is_red and not (c.id = any (t.case_ids))))
$$;
revoke all on function private.competency_test_passed(uuid, text) from public, anon, authenticated;

create function private.enforce_competency_test_passed() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if private.competency_has_cases(new.competency_code) and not private.competency_test_passed(new.clinical_staff_id, new.competency_code) then
    raise exception 'the % competency needs a passed scenario test first', new.competency_code using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_competency_test_passed() from public, anon, authenticated;
create trigger clinician_competencies_require_test before insert on public.clinician_competencies
  for each row execute function private.enforce_competency_test_passed();

-- The chief medical officer tags a DRAFT scenario with the competency it tests.
create function public.set_credential_test_case_competency(p_case uuid, p_code text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; c public.credential_test_cases%rowtype;
begin
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can write test content' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = auth.uid();
  select * into c from public.credential_test_cases where id = p_case and organisation_id = v_org for update;
  if not found then raise exception 'test case not found' using errcode = 'P0002'; end if;
  if c.status <> 'draft' then raise exception 'only a draft scenario can change competency; edit it first so it is approved again' using errcode = '23514'; end if;
  if p_code is not null and not exists (select 1 from public.competencies where code = p_code and is_active) then
    raise exception 'unknown competency' using errcode = 'P0002'; end if;
  update public.credential_test_cases set competency_code = p_code where id = p_case;
  perform private.credential_audit(v_org, auth.uid(), 'credential_test_case.competency_set', 'credential_test_case', p_case, jsonb_build_object('competency', p_code));
end;
$$;

create function public.start_competency_test(p_competency text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  s public.clinical_staff%rowtype;
  v_open public.competency_test_attempts%rowtype;
  v_last timestamptz;
  v_cooldown int := coalesce((private.credential_rule('test_retake_cooldown_hours'))::int, 24);
  v_ids uuid[];
begin
  select * into s from public.clinical_staff where profile_id = auth.uid() and active and status = 'active';
  if not found then raise exception 'only an active clinician can take a competency test' using errcode = '42501'; end if;
  if not exists (select 1 from public.competencies where code = p_competency and is_active) then raise exception 'unknown competency' using errcode = 'P0002'; end if;
  if exists (select 1 from public.clinician_competencies where clinical_staff_id = s.id and competency_code = p_competency and revoked_at is null) then
    raise exception 'you already hold this competency' using errcode = '23514'; end if;
  select * into v_open from public.competency_test_attempts where clinical_staff_id = s.id and competency_code = p_competency and submitted_at is null;
  if not found then
    select max(submitted_at) into v_last from public.competency_test_attempts where clinical_staff_id = s.id and competency_code = p_competency;
    if v_last is not null and v_last + make_interval(hours => v_cooldown) > now() then raise exception 'please wait before trying again' using errcode = '23514'; end if;
    select coalesce(array_agg(id), '{}') into v_ids from public.credential_test_cases
      where organisation_id = s.organisation_id and competency_code = p_competency and status = 'approved';
    if coalesce(array_length(v_ids, 1), 0) = 0 then
      raise exception 'there is no approved test for this competency; ask the clinical lead' using errcode = '23514'; end if;
    insert into public.competency_test_attempts (organisation_id, clinical_staff_id, competency_code, case_ids, is_test)
      values (s.organisation_id, s.id, p_competency, v_ids, s.is_test) returning * into v_open;
  end if;
  -- the answer key never leaves the database: scenario and options only
  return jsonb_build_object('attempt_id', v_open.id, 'competency', p_competency,
    'cases', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'scenario', c.scenario, 'options', c.options) order by random()), '[]'::jsonb)
              from public.credential_test_cases c where c.id = any (v_open.case_ids)));
end;
$$;

create function public.submit_competency_test(p_attempt uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  t public.competency_test_attempts%rowtype;
  s public.clinical_staff%rowtype;
  c record;
  v_total int := 0; v_correct int := 0; v_red_total int := 0; v_red_correct int := 0;
  v_score numeric; v_passed boolean;
  v_pass numeric := coalesce((private.credential_rule('pass_percent'))::numeric, 80);
  v_all_red boolean := coalesce((private.credential_rule('all_red_correct'))::boolean, true);
begin
  select * into t from public.competency_test_attempts where id = p_attempt for update;
  if not found then raise exception 'attempt not found' using errcode = 'P0002'; end if;
  select * into s from public.clinical_staff where id = t.clinical_staff_id and profile_id = auth.uid();
  if not found then raise exception 'attempt not found' using errcode = 'P0002'; end if;
  if t.submitted_at is not null then raise exception 'this attempt was already submitted' using errcode = '23514'; end if;
  for c in select * from public.credential_test_cases where id = any (t.case_ids) loop
    v_total := v_total + 1;
    if c.is_red then v_red_total := v_red_total + 1; end if;
    if (p_answers ->> c.id::text) is not distinct from c.correct_option_id then
      v_correct := v_correct + 1;
      if c.is_red then v_red_correct := v_red_correct + 1; end if;
    end if;
  end loop;
  v_score := case when v_total = 0 then 0 else round(100.0 * v_correct / v_total, 2) end;
  v_passed := v_total > 0 and v_score >= v_pass and (not v_all_red or v_red_correct = v_red_total);
  update public.competency_test_attempts set answers = p_answers, score_percent = v_score, red_total = v_red_total,
    red_correct = v_red_correct, passed = v_passed, submitted_at = now() where id = p_attempt;
  perform private.credential_audit(s.organisation_id, auth.uid(), 'competency_test.submitted', 'clinical_staff', s.id,
    jsonb_build_object('competency', t.competency_code, 'score', v_score, 'passed', v_passed));
  if v_passed then
    perform private.credential_notify_reviewers(s.organisation_id, 'A competency test was passed',
      s.full_name || ' passed the ' || t.competency_code || ' test and can now be granted it.',
      jsonb_build_object('clinical_staff_id', s.id, 'competency', t.competency_code));
  end if;
  return jsonb_build_object('passed', v_passed, 'score_percent', v_score, 'safety_critical_missed', v_red_total - v_red_correct);
end;
$$;

-- Keep competency scenarios out of the general entry test (the entry test draws every approved scenario in the organisation).
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'start_credential_test';
  v_new := replace(v_def, 'and status = ''approved'' and is_red;', 'and status = ''approved'' and is_red and competency_code is null;');
  v_new := replace(v_new, 'c.status = ''approved'' and not c.is_red', 'c.status = ''approved'' and not c.is_red and c.competency_code is null');
  if v_new = v_def or position('and is_red and competency_code is null;' in v_new) = 0 or position('not c.is_red and c.competency_code is null' in v_new) = 0 then
    raise exception 'start_credential_test did not have the expected text to replace';
  end if;
  execute v_new;
end $$;

do $$
declare f text;
begin
  foreach f in array array['set_credential_test_case_competency(uuid, text)', 'start_competency_test(text)', 'submit_competency_test(uuid, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Assertions
do $$
declare f record;
begin
  if (select count(*) from public.competencies where code in ('maternal', 'mental_health', 'paediatrics')) <> 3 then raise exception 'S76 B1: competencies missing'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.competency_test_attempts'::regclass) then raise exception 'S76 B1: RLS off'; end if;
  if has_table_privilege('anon', 'public.competency_test_attempts', 'SELECT') or has_table_privilege('authenticated', 'public.competency_test_attempts', 'INSERT') then
    raise exception 'S76 B1: competency_test_attempts grants are wrong'; end if;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('set_credential_test_case_competency', 'start_competency_test', 'submit_competency_test') loop
    if has_function_privilege('anon', f.sig, 'EXECUTE') then raise exception 'S76 B1: anon can execute %', f.sig; end if;
  end loop;
  if exists (select 1 from public.credential_test_cases where competency_code is not null) then raise exception 'S76 B1: a scenario was tagged by the migration'; end if;
end $$;
