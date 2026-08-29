-- Tarragon Health — Result Lifecycle §58.13 (Patient result release):
-- "Not every result necessarily needs to be released instantly. The system
-- should allow clinical governance to define: immediate release, release
-- after clinician review, restricted release for specific result types."
--
-- What already existed before this migration: a positive HIV/hepatitis/
-- cancer screening result is meant to be DOCTOR-DELIVERED, never broken by
-- an automated message (20260719140000_sensitive_result_gating.sql,
-- screen_types.sensitive covering hiv/hep_b/hep_c/cervical_smear/
-- mammography/psa/fit/colonoscopy/clinical_breast_exam) — but that gate
-- only suppresses the automated WhatsApp reassurance send. The raw
-- screening_results row itself was, and until this migration remained,
-- immediately readable by the patient the instant a clinician inserted it —
-- undermining "doctor-delivered" in practice: a patient could read
-- "abnormal" plus a summary on their own dashboard before any doctor had
-- spoken to them.
--
-- 'after_review' is deliberately NOT given separate enforcement from
-- 'immediate' here: every screening_results row is already clinician-
-- entered-only (submitScreeningResult / confirm_lab_report_extraction —
-- there is no automated, unreviewed insertion path into this table), so a
-- distinct "wait for review" gate would either be a no-op or, worse, if
-- wired to the newer action-tracking reviewed_at column (only stamped once
-- a follow-up ACTION is decided, which a normal result may never need),
-- would make every normal result permanently invisible. The enum still
-- carries the value so clinical governance can record that intent
-- explicitly; only 'restricted' changes behaviour today. This is recorded
-- here rather than silently pretended away.
--
-- Governed jsonb-config-with-sign-off, same shape as escalation_slas
-- (20260730105131) / alert_rules (20260828013011) — deliberately NOT a
-- plain keyed table, to stay consistent with the one pattern this codebase
-- already uses for "clinical governance can configure X."

create type public.result_release_mode as enum ('immediate', 'after_review', 'restricted');

create table public.result_release_policies (
  id            uuid primary key default gen_random_uuid(),
  version       integer not null,
  config        jsonb not null,
  notes         text,
  approved_by   uuid references public.clinical_staff (id),
  approved_at   timestamptz,
  is_active     boolean not null default false,
  created_at    timestamptz not null default now()
);

comment on table public.result_release_policies is
  'Governed jsonb-document ledger, same shape as escalation_slas/alert_rules: one row per proposed/signed version, is_active marks the live one. Each config[] entry is {screen_type_code, release_mode, reason} for one screen_types.code. Reader: private.result_release_mode(screen_type_code).';

create index result_release_policies_active_idx on public.result_release_policies (is_active) where is_active;

alter table public.result_release_policies enable row level security;

create policy result_release_policies_select on public.result_release_policies
  for select to authenticated using (true);

-- Mirrors escalation_slas_insert exactly: any admin may propose a new
-- inactive, unsigned draft version; only sign_result_release_policies()
-- (Clinical-Director-gated) may activate/sign one.
create policy result_release_policies_insert on public.result_release_policies
  for insert to authenticated
  with check (
    private.is_admin()
    and approved_by is null
    and approved_at is null
    and is_active = false
  );

grant select, insert on public.result_release_policies to authenticated;

-- ---------------------------------------------------------------------------
-- Lookup helper. Unlike private.escalation_sla_minutes, a MISSING config
-- entry is not a bug here — most screen types are never restricted, so
-- "not configured" correctly means 'immediate', not a raised exception.
--
-- Called directly from an RLS USING clause (see the policy rewrite below),
-- not merely from another SECURITY DEFINER trigger — so, unlike
-- escalation_sla_minutes/notify_clinician_alert, this must stay executable
-- by `authenticated` (the 20260812003758 default-privileges rule already
-- grants that automatically for every new private.* function; no explicit
-- grant/revoke needed or added here — confirmed by the assertion block
-- below rather than assumed).
-- ---------------------------------------------------------------------------
create or replace function private.result_release_mode(p_screen_type_code text)
returns public.result_release_mode
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select (entry->>'release_mode')::public.result_release_mode
      from public.result_release_policies c,
           jsonb_array_elements(c.config) as entry
      where c.is_active
        and entry->>'screen_type_code' = p_screen_type_code
      limit 1
    ),
    'immediate'::public.result_release_mode
  );
$$;

-- 'restricted' only withholds the row from the PATIENT when it is actually
-- bad news (abnormal/critical) — a normal HIV/mammography/PSA result has
-- nothing to soften and stays immediately visible, matching the sensitive-
-- gating precedent's own framing ("a POSITIVE result must be doctor-
-- delivered"), not a blanket per-type visibility block.
create or replace function private.patient_result_blocked(
  p_screen_type_code text,
  p_result_status public.result_status
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_screen_type_code is not null
    and p_result_status in ('abnormal', 'critical')
    and private.result_release_mode(p_screen_type_code) = 'restricted';
$$;

-- ---------------------------------------------------------------------------
-- The RLS rewrite. Byte-identical to the live screening_results_select
-- (20260731185243_sponsor_clinical_access_results_and_escalations.sql)
-- except the added block check — org staff are NEVER gated by release
-- policy (a restriction is about what's shown to the PATIENT pending a
-- doctor's delivery, not about hiding a result from the care team that has
-- to deliver it), only the patient-direct and consented-supporter branches.
-- ---------------------------------------------------------------------------
drop policy if exists screening_results_select on public.screening_results;
create policy screening_results_select on public.screening_results
  for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    or (
      not private.patient_result_blocked(screen_type_code, result_status)
      and (
        patient_id = (select auth.uid())
        or private.can_read_clinical(patient_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Seed v1 — a faithful, STRENGTHENING transcription of the already-
-- established sensitive-positive policy (the same 9 screen_types.sensitive
-- codes), now enforced at the row-visibility layer rather than only the
-- auto-message layer. Active from the start (same reasoning as
-- escalation_slas v1: the RLS policy above depends on a resolvable config
-- existing immediately), deliberately UNSIGNED — a faithful transcription
-- of an existing rule is not the same thing as a Director's fresh
-- attestation of this new mechanism; see the admin review page.
-- ---------------------------------------------------------------------------
insert into public.result_release_policies (version, config, notes, is_active)
values (
  1,
  '[
    {"screen_type_code": "hiv", "release_mode": "restricted", "reason": "Positive HIV result must be doctor-delivered, per CLAUDE.md Non-Negotiable Business Rules and the AHC pathway."},
    {"screen_type_code": "hep_b", "release_mode": "restricted", "reason": "Positive hepatitis result must be doctor-delivered."},
    {"screen_type_code": "hep_c", "release_mode": "restricted", "reason": "Positive hepatitis result must be doctor-delivered."},
    {"screen_type_code": "cervical_smear", "release_mode": "restricted", "reason": "Abnormal cancer screen must be doctor-delivered."},
    {"screen_type_code": "mammography", "release_mode": "restricted", "reason": "Abnormal cancer screen must be doctor-delivered."},
    {"screen_type_code": "psa", "release_mode": "restricted", "reason": "Abnormal cancer screen must be doctor-delivered."},
    {"screen_type_code": "fit", "release_mode": "restricted", "reason": "Abnormal cancer screen must be doctor-delivered."},
    {"screen_type_code": "colonoscopy", "release_mode": "restricted", "reason": "Abnormal cancer screen must be doctor-delivered."},
    {"screen_type_code": "clinical_breast_exam", "release_mode": "restricted", "reason": "Abnormal cancer screen must be doctor-delivered."}
  ]'::jsonb,
  'v1: faithful transcription of the existing screen_types.sensitive catalogue (20260719140000) into a governed, row-visibility-enforcing policy. Restriction applies only when the result is abnormal/critical — a normal result of these types stays immediately visible. Pending Clinical Director sign-off; see /admin/settings/result-release-policies.',
  true
);

-- ---------------------------------------------------------------------------
-- Sign & activate — same shape as sign_escalation_slas exactly.
-- ---------------------------------------------------------------------------
create or replace function public.sign_result_release_policies(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
begin
  if not exists (select 1 from public.result_release_policies where id = p_id) then
    raise exception 'Result release policy version not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.active
    and cs.is_clinical_director
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can sign the result release policy';
  end if;

  update public.result_release_policies set is_active = false
    where is_active and id <> p_id;

  update public.result_release_policies
    set approved_by = v_staff, approved_at = now(), is_active = true
    where id = p_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  select cs.organisation_id, (select auth.uid()), 'result_release_policies.signed',
         'result_release_policies', p_id,
         jsonb_build_object('signed_by_clinical_staff', v_staff)
  from public.clinical_staff cs where cs.id = v_staff;

  return p_id;
end;
$$;

-- The anon-execute gotcha, corrected form (per this codebase's own
-- 2026-07-27 finding, re-confirmed 2026-08-27): revoke from both public and
-- anon explicitly, then grant back to authenticated.
revoke all on function public.sign_result_release_policies(uuid) from public;
revoke all on function public.sign_result_release_policies(uuid) from anon;
grant execute on function public.sign_result_release_policies(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
declare
  v_mode public.result_release_mode;
  v_blocked boolean;
begin
  if not exists (select 1 from pg_type where typname = 'result_release_mode') then
    raise exception 'result_release_mode enum was not created';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'result_release_policies') then
    raise exception 'result_release_policies table was not created';
  end if;

  v_mode := private.result_release_mode('hiv');
  if v_mode <> 'restricted' then
    raise exception 'FAIL: hiv should resolve to restricted, got %', v_mode;
  end if;
  v_mode := private.result_release_mode('hba1c');
  if v_mode <> 'immediate' then
    raise exception 'FAIL: an unconfigured screen type should default to immediate, got %', v_mode;
  end if;

  v_blocked := private.patient_result_blocked('hiv', 'abnormal');
  if not v_blocked then
    raise exception 'FAIL: an abnormal hiv result should be blocked from direct patient read';
  end if;
  v_blocked := private.patient_result_blocked('hiv', 'normal');
  if v_blocked then
    raise exception 'FAIL: a normal hiv result must stay immediately visible, restriction is for bad news only';
  end if;
  v_blocked := private.patient_result_blocked('hba1c', 'critical');
  if v_blocked then
    raise exception 'FAIL: an unrestricted screen type must never be blocked regardless of severity';
  end if;

  if not has_function_privilege('authenticated', 'private.result_release_mode(text)', 'EXECUTE') then
    raise exception 'authenticated cannot execute private.result_release_mode — RLS policy would break';
  end if;
  if has_function_privilege('anon', 'private.result_release_mode(text)', 'EXECUTE') then
    raise exception 'anon can execute private.result_release_mode';
  end if;
  if not has_function_privilege('authenticated', 'private.patient_result_blocked(text, public.result_status)', 'EXECUTE') then
    raise exception 'authenticated cannot execute private.patient_result_blocked — RLS policy would break';
  end if;
  if has_function_privilege('anon', 'private.patient_result_blocked(text, public.result_status)', 'EXECUTE') then
    raise exception 'anon can execute private.patient_result_blocked';
  end if;

  if has_function_privilege('anon', 'public.sign_result_release_policies(uuid)', 'EXECUTE') then
    raise exception 'anon can execute public.sign_result_release_policies';
  end if;
  if not has_function_privilege('authenticated', 'public.sign_result_release_policies(uuid)', 'EXECUTE') then
    raise exception 'authenticated cannot execute public.sign_result_release_policies';
  end if;

  -- The rewritten policy must still check is_org_staff — org staff can
  -- never be gated by a patient-release policy.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'screening_results' and policyname = 'screening_results_select'
      and qual like '%is_org_staff%' and qual like '%patient_result_blocked%'
  ) then
    raise exception 'screening_results_select does not carry both is_org_staff and the new release-policy gate';
  end if;

  raise notice 'PASS: result_release_policies governance + RLS gate all correct';
end $$;
