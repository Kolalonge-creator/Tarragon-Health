-- Follow-up FU-notify A (OQ-329, OQ-330, OQ-331, OQ-337, OQ-341, OQ-346; founder and CMO answers 2026-10-16).
--
--   1. notifications.rules v5 (owner CMO, OQ-337): deliveredCountsAsConfirmed false (only the patient's own action ends the unconfirmed
--      wait, OQ-329); couldNotGetCareOutreachNow false ("I could not get care" is recorded and shown to on-call, but the clinician call
--      waits for the 30 minute rule, OQ-330); undeliveredMinutes 5 and expireHours 6 kept (OQ-331). Every other key copied unchanged.
--   2. Webhook inbox retention (OQ-341): config row (rejected 30 days, verified raw bodies 90 days then customer emails redacted), a
--      count-first plan function and a purge function that is OFF behind purgeEnabled and is NOT scheduled.
--   3. Credential evidence retention (OQ-346): employment plus 6 years recorded in credentialing_config v6 (inactive, unsigned). The purge
--      stays off (document_purge_enabled false) and now skips every evidence document, not only primary-source ones.
--
-- LIVE COUNTS BEFORE (2026-10-16, read only): provider_events 2 rows (none older than 2 days), clinician_documents 7, credentialing_config
-- versions 1-5 (3 active). Nothing is deleted or converted here. Rewritten functions start from their LIVE definitions.
-- No begin/commit here: the auto-apply workflow wraps this file.

-- 1. notifications.rules v5 --------------------------------------------------------------------------------------------
do $rules$
declare v_cfg jsonb; v_next integer;
begin
  select config into v_cfg from public.notification_rules_config where is_active order by version desc limit 1;
  if v_cfg is null then raise exception 'FU-notify: no active notification_rules_config row to copy'; end if;
  select max(version) + 1 into v_next from public.notification_rules_config;
  update public.notification_rules_config set is_active = false where is_active;
  insert into public.notification_rules_config (version, is_active, config, note) values
    (v_next, true,
     v_cfg || jsonb_build_object('redUnconfirmed',
       -- red-unconfirmed-rules-v5-begin
       $json${"enabled":true,"unconfirmedMinutes":30,"undeliveredMinutes":5,"expireHours":6,"deliveredCountsAsConfirmed":false,"couldNotGetCareOutreachNow":false,"criticalReceiptCheckMinutes":2}$json$::jsonb
       -- red-unconfirmed-rules-v5-end
     ),
     'FU-notify: CMO answers OQ-329/330/331. A delivered push receipt no longer ends the unconfirmed wait; "I could not get care" no longer opens the call at once; 5 and 6 hour timings kept.');
end $rules$;

-- 2. Webhook inbox retention -----------------------------------------------------------------------------------------
create table public.provider_event_retention_config (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  is_active boolean not null default false,
  config jsonb not null,
  note text,
  created_at timestamptz not null default now()
);
alter table public.provider_event_retention_config enable row level security;
create policy provider_event_retention_config_admin_read on public.provider_event_retention_config for select to authenticated using (private.is_admin());
revoke all on public.provider_event_retention_config from public, anon, authenticated;
grant select on public.provider_event_retention_config to authenticated;
grant select on public.provider_event_retention_config to service_role;

-- provider-event-retention-begin
insert into public.provider_event_retention_config (version, is_active, config, note) values
  (1, true, $json${"purgeEnabled":false,"rejectedDays":30,"verifiedRawBodyDays":90,"redactCustomerEmails":true,"batchLimit":500}$json$::jsonb,
   'OQ-341: rejected rows 30 days; verified raw bodies 90 days then customer emails redacted. The purge is OFF until the DPO signs and a new version sets purgeEnabled.');
-- provider-event-retention-end

create function private.provider_retention_rule(p_key text) returns text
language sql stable security definer set search_path = ''
as $$ select config ->> p_key from public.provider_event_retention_config where is_active order by version desc limit 1 $$;
revoke all on function private.provider_retention_rule(text) from public, anon, authenticated;

alter table public.provider_events add column raw_redacted_at timestamptz;

-- LIVE guard plus: raw_body and raw_redacted_at may change together, only inside the redaction function (tarragon.provider_redact = on),
-- and only once; content_sha256 keeps the hash of the ORIGINAL body so the record of what arrived survives.
create or replace function private.guard_provider_events()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'provider_events is append only: rows are never deleted' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    if old.status = 'rejected' and coalesce(current_setting('tarragon.provider_purge', true), '') = 'on' then return old; end if;
    raise exception 'provider_events is append only: rows are never deleted' using errcode = '42501';
  end if;
  if new.raw_body is distinct from old.raw_body or new.raw_redacted_at is distinct from old.raw_redacted_at then
    if coalesce(current_setting('tarragon.provider_redact', true), '') <> 'on'
       or old.raw_redacted_at is not null or new.raw_redacted_at is null or not old.signature_verified then
      raise exception 'the raw body of a provider event changes only through the retention redaction' using errcode = '42501';
    end if;
  end if;
  if new.provider is distinct from old.provider
     or new.content_sha256 is distinct from old.content_sha256 or new.idempotency_key is distinct from old.idempotency_key
     or new.signature_verified is distinct from old.signature_verified or new.event_type is distinct from old.event_type
     or new.received_at is distinct from old.received_at then
    raise exception 'the raw body, signature result and key of a provider event never change' using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- A redacted body cannot be replayed: it no longer holds what the provider sent.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.replay_provider_event(uuid, text)'::regprocedure);
  v_new := replace(v_def,
    E'  if e.status = ''processing'' and e.locked_until >= now() then',
    E'  if e.raw_redacted_at is not null then raise exception ''provider_event_body_redacted_never_replayed'' using errcode = ''23514''; end if;\n  if e.status = ''processing'' and e.locked_until >= now() then');
  if v_new = v_def then raise exception 'FU-notify: replay_provider_event marker not found (definition drifted)'; end if;
  execute v_new;
end $$;

-- Count-first: reports what a run would do, changes nothing, works while the purge is off.
create function public.provider_event_retention_plan() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'purge_enabled', coalesce(private.provider_retention_rule('purgeEnabled'), 'false')::boolean,
    'rejected_due', (select count(*) from public.provider_events
                      where status = 'rejected' and not signature_verified
                        and received_at < now() - make_interval(days => coalesce(private.provider_retention_rule('rejectedDays'), '30')::int)),
    'raw_bodies_due', (select count(*) from public.provider_events
                        where signature_verified and raw_redacted_at is null and status in ('processed', 'dead')
                          and received_at < now() - make_interval(days => coalesce(private.provider_retention_rule('verifiedRawBodyDays'), '90')::int)));
end;
$$;

-- The purge. Refuses while the flag is off. Never scheduled by this migration.
create function public.run_provider_event_retention(p_dry_run boolean default true) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_plan jsonb := public.provider_event_retention_plan();
  v_limit int := least(coalesce(private.provider_retention_rule('batchLimit'), '500')::int, 5000);
  v_rejected int := 0; v_redacted int := 0;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_dry_run then return v_plan || jsonb_build_object('dry_run', true); end if;
  if not (v_plan ->> 'purge_enabled')::boolean then
    raise exception 'webhook inbox retention is switched off' using errcode = '23514';
  end if;
  perform set_config('tarragon.provider_purge', 'on', true);
  delete from public.provider_events where id in (
    select id from public.provider_events where status = 'rejected' and not signature_verified
       and received_at < now() - make_interval(days => coalesce(private.provider_retention_rule('rejectedDays'), '30')::int)
     order by received_at limit v_limit);
  get diagnostics v_rejected = row_count;
  perform set_config('tarragon.provider_purge', 'off', true);
  if coalesce(private.provider_retention_rule('redactCustomerEmails'), 'true')::boolean then
    perform set_config('tarragon.provider_redact', 'on', true);
    update public.provider_events
       set raw_body = regexp_replace(raw_body, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email removed]', 'g'),
           raw_redacted_at = now()
     where id in (
       select id from public.provider_events where signature_verified and raw_redacted_at is null and status in ('processed', 'dead')
          and received_at < now() - make_interval(days => coalesce(private.provider_retention_rule('verifiedRawBodyDays'), '90')::int)
        order by received_at limit v_limit);
    get diagnostics v_redacted = row_count;
    perform set_config('tarragon.provider_redact', 'off', true);
  end if;
  return jsonb_build_object('dry_run', false, 'rejected_deleted', v_rejected, 'raw_bodies_redacted', v_redacted);
end;
$$;
revoke all on function public.provider_event_retention_plan() from public, anon, authenticated;
revoke all on function public.run_provider_event_retention(boolean) from public, anon, authenticated;
grant execute on function public.provider_event_retention_plan() to service_role;
grant execute on function public.run_provider_event_retention(boolean) to service_role;

-- 3. Credential evidence retention (config only) and the purge skipping all evidence ---------------------------------------
-- credentialing-rules-begin
insert into public.credentialing_config (version, is_active, effective_from, rules) values (6, false, '2026-10-16', $json$
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
  "reverify_notice_days": 30,
  "verification_evidence_retention_years_after_employment": 6
}
$json$::jsonb);
-- credentialing-rules-end

do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('private.credential_purge_reason(public.clinician_documents)'::regprocedure);
  v_new := replace(v_def,
    E'    when exists (select 1 from public.clinician_primary_source_verifications v where v.evidence_document_id = d.id) then null\n',
    E'    when exists (select 1 from public.clinician_primary_source_verifications v where v.evidence_document_id = d.id) then null\n' ||
    E'    when exists (select 1 from public.clinician_licence_verifications v where v.evidence_document_id = d.id) then null\n' ||
    E'    when exists (select 1 from public.clinician_checks c where c.evidence_document_id = d.id) then null\n');
  if v_new = v_def then raise exception 'FU-notify: credential_purge_reason marker not found (definition drifted)'; end if;
  execute v_new;
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.run_provider_event_retention(boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.run_provider_event_retention(boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.provider_event_retention_plan()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.provider_event_retention_plan()', 'EXECUTE') then
    raise exception 'FU-notify assertion: a retention function is executable by anon or authenticated';
  end if;
  if coalesce((select config ->> 'purgeEnabled' from public.provider_event_retention_config where is_active), 'true') <> 'false' then
    raise exception 'FU-notify assertion: the webhook retention purge must be born off';
  end if;
  if exists (select 1 from cron.job where command ilike '%run_provider_event_retention%') then
    raise exception 'FU-notify assertion: the retention purge must not be scheduled';
  end if;
end $$;
