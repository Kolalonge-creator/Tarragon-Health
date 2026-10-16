-- S76 B2 (decision S-18): MDCN licence re-verification at onboarding and every 12 months, by a staff check of the register.
-- No MDCN API is claimed or used: a person looks the clinician up on the register and records what they saw.
--
--   * credentialing_config version 5 (PROPOSED, NOT ACTIVE): the version 4 rules (S20 v2: licence notices, renewal cycle; itself built on P5's
--     version 3) plus reverify_months and reverify_notice_days. (It was version 3, then 4, before P5 and S20 v2 took those numbers.)
--     It is inserted inactive so nothing changes until the chief medical officer's sign-off activates it. Until then
--     private.credential_rule('reverify_months') is null and the sweep below does nothing (inert by design).
--   * clinician_licence_verifications: append only; who checked, when, the folio seen, the register result, the evidence
--     document, the date the next check is due.
--   * public.record_licence_verification(): reviewer door (admin or chief medical officer, never about yourself). A result
--     that is not "on the register in good standing" pauses access through the existing suspension function.
--   * private.licence_reverification_sweep(): daily. One notice to the reviewers when a check is due soon, one when it is
--     overdue, then suspension of an overdue clinician through private.suspend_clinician_internal unless an audited LICENCE
--     grace period covers them (private.credential_in_grace). The S15 expiry sweep is not touched.
-- Baseline for a clinician with no recorded check: the later of their licence verification date and the day their staff
-- record was created, so switching this on never suspends the existing team on day one.
-- Counts before: clinician_licence_verifications did not exist; live clinical staff are untouched by this migration.

-- credentialing-rules-begin
insert into public.credentialing_config (version, is_active, effective_from, rules) values (5, false, '2026-10-15', $json$
{
  "min_practice_years": 2,
  "pass_percent": 80,
  "all_red_correct": true,
  "audited_task_count": 20,
  "referees_required": 2,
  "referee_independent_contact": true,
  "test_max_attempts": 3,
  "test_retake_cooldown_hours": 24,
  "test_scenarios_per_attempt": 10,
  "notice_windows_days": [90, 30, 7, 0],
  "grace_max_days": 14,
  "separate_verifier_and_approver": true,
  "document_max_bytes": 8388608,
  "document_retention_years_after_offboarding": 7,
  "require_verified_phone": false,
  "document_purge_enabled": false,
  "rejected_application_document_retention_months": 24,
  "primary_source_required": true,
  "primary_source_routes": ["mdcn_dataflow", "mdcn_written_confirmation", "mdcn_register_check"],
  "primary_source_max_age_days": 365,
  "recheck_months": 6,
  "recheck_overdue_days": 14,
  "credential_date_max_days": 1100,
  "grandfather_ends_on": null,
  "renewal_cycle": { "cycle_end_month": 12, "cycle_end_day": 31, "proof_deadline_month": 12, "proof_deadline_day": 15 },
  "missing_licence_date_ineligible": true,
  "verification_sources": ["mdcn_register_lookup", "document_sighted", "insurer_confirmation", "other"],
  "reverify_months": 12,
  "reverify_notice_days": 30
}
$json$::jsonb);
-- credentialing-rules-end

create table public.clinician_licence_verifications (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  clinical_staff_id    uuid not null references public.clinical_staff (id) on delete cascade,
  checked_by           uuid not null references public.profiles (id) on delete restrict,
  checked_on           date not null,
  folio                text not null check (char_length(btrim(folio)) >= 2),
  register_result      text not null check (register_result in ('good_standing', 'conditions', 'not_found', 'suspended_or_erased')),
  evidence_document_id uuid references public.clinician_documents (id) on delete set null,
  notes                text,
  next_due             date not null,
  is_test              boolean not null default false,
  created_at           timestamptz not null default now(),
  constraint licence_verification_evidence_or_notes check (evidence_document_id is not null or char_length(btrim(coalesce(notes, ''))) >= 10),
  constraint licence_verification_due_after_check check (next_due > checked_on)
);
create index clinician_licence_verifications_staff_idx on public.clinician_licence_verifications (clinical_staff_id, checked_on desc);
create trigger clinician_licence_verifications_append_only before update or delete on public.clinician_licence_verifications
  for each row execute function private.queue_append_only();
alter table public.clinician_licence_verifications enable row level security;
create policy clinician_licence_verifications_select on public.clinician_licence_verifications for select to authenticated
  using (private.can_credential_review() or exists (
    select 1 from public.clinical_staff cs where cs.id = clinical_staff_id and cs.profile_id = (select auth.uid())));
revoke all on public.clinician_licence_verifications from anon;
revoke insert, update, delete, truncate on public.clinician_licence_verifications from authenticated;
grant select on public.clinician_licence_verifications to authenticated;

-- One notice per clinician, due date and stage, so a daily sweep tells the reviewers once.
create table public.licence_reverification_notices (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  clinical_staff_id uuid not null references public.clinical_staff (id) on delete cascade,
  due_on            date not null,
  stage             text not null check (stage in ('due_soon', 'overdue')),
  created_at        timestamptz not null default now(),
  unique (clinical_staff_id, due_on, stage)
);
alter table public.licence_reverification_notices enable row level security;
create policy licence_reverification_notices_select on public.licence_reverification_notices for select to authenticated
  using (private.can_credential_review());
revoke all on public.licence_reverification_notices from anon;
revoke insert, update, delete, truncate on public.licence_reverification_notices from authenticated;
grant select on public.licence_reverification_notices to authenticated;

-- When is this clinician's next register check due?
create function private.licence_next_due(p_staff uuid) returns date
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select v.next_due from public.clinician_licence_verifications v where v.clinical_staff_id = cs.id order by v.checked_on desc, v.created_at desc limit 1),
    ((greatest(coalesce(cs.license_verified_at, cs.created_at), cs.created_at) at time zone 'Africa/Lagos')::date
       + make_interval(months => coalesce((private.credential_rule('reverify_months'))::int, 12)))::date)
  from public.clinical_staff cs where cs.id = p_staff
$$;
revoke all on function private.licence_next_due(uuid) from public, anon, authenticated;

create function public.record_licence_verification(
  p_staff uuid, p_folio text, p_register_result text, p_evidence_document uuid default null,
  p_checked_on date default null, p_next_due date default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  s public.clinical_staff%rowtype;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_checked date := coalesce(p_checked_on, (now() at time zone 'Africa/Lagos')::date);
  v_months int := coalesce((private.credential_rule('reverify_months'))::int, 12);
  v_next date;
  v_id uuid;
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into s from public.clinical_staff where id = p_staff for update;
  if not found then raise exception 'clinician not found' using errcode = 'P0002'; end if;
  if s.profile_id is not distinct from auth.uid() then raise exception 'you cannot record a check of your own licence' using errcode = '42501'; end if;
  if p_register_result not in ('good_standing', 'conditions', 'not_found', 'suspended_or_erased') then
    raise exception 'unknown register result' using errcode = '23514'; end if;
  if v_checked > v_today or v_checked < v_today - 31 then raise exception 'the check date must be within the last 31 days and not in the future' using errcode = '23514'; end if;
  if p_evidence_document is not null and not exists (
       select 1 from public.clinician_documents d where d.id = p_evidence_document and d.owner_profile_id = s.profile_id and d.superseded_at is null) then
    raise exception 'evidence document not found for this clinician' using errcode = 'P0002'; end if;
  v_next := coalesce(p_next_due, (v_checked + make_interval(months => v_months))::date);
  if v_next <= v_checked then raise exception 'the next check must be after this one' using errcode = '23514'; end if;
  insert into public.clinician_licence_verifications (organisation_id, clinical_staff_id, checked_by, checked_on, folio, register_result,
      evidence_document_id, notes, next_due, is_test)
    values (s.organisation_id, s.id, auth.uid(), v_checked, btrim(p_folio), p_register_result, p_evidence_document, nullif(btrim(coalesce(p_notes, '')), ''), v_next, s.is_test)
    returning id into v_id;
  perform private.credential_audit(s.organisation_id, auth.uid(), 'clinician_licence.verified', 'clinical_staff', s.id,
    jsonb_build_object('verification_id', v_id, 'result', p_register_result, 'next_due', v_next,
                       'folio_matches_record', s.credential_number is not null and lower(btrim(s.credential_number)) = lower(btrim(p_folio))));
  if p_register_result in ('not_found', 'suspended_or_erased') then
    perform private.suspend_clinician_internal(s.id, 'The register check did not show you in good standing. The clinical lead will contact you.', auth.uid());
  end if;
  return v_id;
end;
$$;

create function private.licence_reverification_sweep() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_months int := (private.credential_rule('reverify_months'))::int;
  v_notice int := coalesce((private.credential_rule('reverify_notice_days'))::int, 30);
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_due date; v_soon int := 0; v_overdue int := 0; v_suspended int := 0; v_errors int := 0; v_rows int;
begin
  -- inert until the chief medical officer has activated a config version carrying the cadence
  if v_months is null then return jsonb_build_object('inert', true); end if;
  for r in select cs.* from public.clinical_staff cs where cs.active and cs.status = 'active' and cs.profile_id is not null loop
    begin
      v_due := private.licence_next_due(r.id);
      if v_due < v_today then
        insert into public.licence_reverification_notices (organisation_id, clinical_staff_id, due_on, stage) values (r.organisation_id, r.id, v_due, 'overdue') on conflict do nothing;
        get diagnostics v_rows = row_count;
        if v_rows > 0 then
          v_overdue := v_overdue + 1;
          perform private.credential_notify_reviewers(r.organisation_id, 'MDCN register check overdue',
            format('%s: the register check was due on %s. Record it, or access is paused.', r.full_name, to_char(v_due, 'DD Mon YYYY')),
            jsonb_build_object('clinical_staff_id', r.id, 'kind', 'licence_reverification'));
        end if;
        if not private.credential_in_grace(r.id, 'licence') then
          perform private.suspend_clinician_internal(r.id, format('Your MDCN register check was due on %s and has not been recorded.', to_char(v_due, 'DD Mon YYYY')), null);
          v_suspended := v_suspended + 1;
        end if;
      elsif v_due - v_today <= v_notice then
        insert into public.licence_reverification_notices (organisation_id, clinical_staff_id, due_on, stage) values (r.organisation_id, r.id, v_due, 'due_soon') on conflict do nothing;
        get diagnostics v_rows = row_count;
        if v_rows > 0 then
          v_soon := v_soon + 1;
          perform private.credential_notify_reviewers(r.organisation_id, 'MDCN register check due soon',
            format('%s: the register check is due on %s.', r.full_name, to_char(v_due, 'DD Mon YYYY')),
            jsonb_build_object('clinical_staff_id', r.id, 'kind', 'licence_reverification'));
        end if;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'licence_reverification_sweep failed for clinician %: %', r.id, sqlerrm;
      perform private.credential_audit(r.organisation_id, null, 'credential_sweep.error', 'clinical_staff', r.id, jsonb_build_object('error', sqlerrm, 'sweep', 'licence_reverification'));
    end;
  end loop;
  return jsonb_build_object('due_soon', v_soon, 'overdue', v_overdue, 'suspended', v_suspended, 'errors', v_errors);
end;
$$;
revoke all on function private.licence_reverification_sweep() from public, anon, authenticated;

do $$
begin
  perform cron.schedule('licence-reverification-sweep', '40 5 * * *', $c$select private.licence_reverification_sweep()$c$);
end $$;

revoke all on function public.record_licence_verification(uuid, text, text, uuid, date, date, text) from public, anon;
grant execute on function public.record_licence_verification(uuid, text, text, uuid, date, date, text) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['clinician_licence_verifications', 'licence_reverification_notices'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'S76 B2: RLS off on %', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT') then raise exception 'S76 B2: anon can read %', t; end if;
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE') then raise exception 'S76 B2: direct write on %', t; end if;
  end loop;
  if has_function_privilege('anon', 'public.record_licence_verification(uuid, text, text, uuid, date, date, text)', 'EXECUTE') then raise exception 'S76 B2: anon can record'; end if;
  if (select is_active from public.credentialing_config where version = 5) then raise exception 'S76 B2: the proposed config must not be active'; end if;
  if private.credential_rule('reverify_months') is not null then raise exception 'S76 B2: the cadence must be inert until a signed version is activated'; end if;
  if not exists (select 1 from cron.job where jobname = 'licence-reverification-sweep') then raise exception 'S76 B2: sweep not scheduled'; end if;
end $$;
