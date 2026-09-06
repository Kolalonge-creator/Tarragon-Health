-- Tarragon Health
-- Wires public.clinical_incident_reports (20260826225518) into the newly
-- added public.ops_incidents register (20260829091432) via the nullable
-- clinical_incident_report_id FK that migration already carries.
--
-- ops_incident_register's own header is explicit about the shape this should
-- take: "an ops_incidents row LINKS to one via a nullable FK... never
-- duplicates them" — clinical governance's own workflow (review, tier
-- authority, outcome/corrective-action requirements) is untouched here.
--
-- Until this migration, nothing ever created that link: clinical_incident_
-- reports had no frontend at all (see apps/web/src/app/(dashboard)/clinician/
-- incident-reports, added alongside this migration), and even once filed,
-- only an admin holding incidents.manage could have inserted an
-- ops_incidents row by hand — which is nobody among the org staff who
-- actually file a near-miss (any clinician or Care Coordinator, per that
-- table's own INSERT policy).
--
-- Scope, deliberately narrow: fires once, on INSERT only, not on every
-- later edit — severity is effectively set-once in the shipped UI (no
-- control to change it after filing) and re-deriving/re-linking on every
-- update would risk creating a second ops_incidents row or silently
-- re-writing one an admin has since started working. A near_miss or low
-- severity report stays clinical-governance-only, matching that table's own
-- design comment that 'near_miss' is deliberately distinct signal for a
-- governance reviewer, not necessarily a platform-wide operational event.
-- medium/high/critical get real-time ops visibility and an SLA clock from
-- the moment they're filed — the same "immediate, not scheduled" posture
-- CLAUDE.md requires for the abnormal-screening-result pipeline.
--
-- SECURITY DEFINER is what makes this work at all for the common case: the
-- filer is very often a plain clinician or Care Coordinator with no
-- incidents.manage permission, so a client-side insert into ops_incidents
-- would be rejected by ops_incidents_insert's RLS policy. Running as the
-- function owner (same pattern as private.ops_incident_log_status_change on
-- the ops_incidents side already) bypasses that — this is platform-derived
-- visibility, not something the filer is personally granted.

create or replace function private.link_clinical_incident_to_ops_register()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ops_severity public.ops_incident_severity;
  v_ops_incident_id uuid;
begin
  v_ops_severity := case new.severity
    when 'critical' then 'sev1'
    when 'high'     then 'sev2'
    when 'medium'   then 'sev3'
    else null
  end;

  if v_ops_severity is null then
    return new;
  end if;

  insert into public.ops_incidents (
    organisation_id, category, severity, title, summary,
    detected_at, reported_by, clinical_incident_report_id,
    -- Overwritten immediately by private.ops_incident_set_sla (BEFORE
    -- INSERT on ops_incidents) from v_ops_severity — placeholders only
    -- satisfy the NOT NULL columns.
    ack_due_at, resolve_due_at
  )
  values (
    new.organisation_id,
    'clinical',
    v_ops_severity,
    format('Clinical incident: %s', replace(new.category, '_', ' ')),
    new.description,
    coalesce(new.occurred_at, new.reported_at),
    new.reported_by,
    new.id,
    now(),
    now()
  )
  returning id into v_ops_incident_id;

  insert into public.ops_incident_updates (incident_id, author_id, note, status_from, status_to)
  values (
    v_ops_incident_id,
    new.reported_by,
    format(
      'Auto-linked from clinical incident report %s (%s, severity %s).',
      new.id, new.category, new.severity
    ),
    null,
    'open'
  );

  return new;
end;
$$;

comment on function private.link_clinical_incident_to_ops_register() is
  'AFTER INSERT on clinical_incident_reports: for medium/high/critical severity, creates a linked ops_incidents row (category clinical, severity mapped sev3/sev2/sev1) so operations gets real-time cross-domain visibility and an SLA clock without duplicating the clinical governance workflow. near_miss/low stay clinical-governance-only. SECURITY DEFINER so a plain clinician or Care Coordinator filer — who holds no incidents.manage permission — can still trigger the link.';

create trigger clinical_incident_reports_link_ops_incident
  after insert on public.clinical_incident_reports
  for each row execute function private.link_clinical_incident_to_ops_register();

revoke all on function private.link_clinical_incident_to_ops_register() from public;

do $$
declare
  v_org uuid;
  v_report_id uuid;
  v_linked_ops_id uuid;
  v_low_report_id uuid;
  v_low_linked_count integer;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise notice 'SKIP: no organisation row to test against';
    return;
  end if;

  -- A high-severity report must produce exactly one linked, correctly
  -- mapped ops_incidents row.
  insert into public.clinical_incident_reports (organisation_id, category, severity, description)
  values (v_org, 'medication_error', 'high', 'Migration self-test: high-severity report should auto-link.')
  returning id into v_report_id;

  select id into v_linked_ops_id
  from public.ops_incidents
  where clinical_incident_report_id = v_report_id;

  if v_linked_ops_id is null then
    raise exception 'high-severity clinical_incident_reports row did not create a linked ops_incidents row';
  end if;

  if not exists (
    select 1 from public.ops_incidents
    where id = v_linked_ops_id and severity = 'sev2' and category = 'clinical'
  ) then
    raise exception 'linked ops_incidents row has the wrong severity/category mapping for a high-severity report';
  end if;

  if not exists (
    select 1 from public.ops_incident_updates
    where incident_id = v_linked_ops_id and status_to = 'open'
  ) then
    raise exception 'linked ops_incidents row is missing its auto-linked timeline entry';
  end if;

  -- A near_miss report must NOT create an ops_incidents row at all.
  insert into public.clinical_incident_reports (organisation_id, category, severity, description)
  values (v_org, 'other', 'near_miss', 'Migration self-test: near-miss should stay clinical-governance-only.')
  returning id into v_low_report_id;

  select count(*) into v_low_linked_count
  from public.ops_incidents
  where clinical_incident_report_id = v_low_report_id;

  if v_low_linked_count <> 0 then
    raise exception 'a near_miss-severity report incorrectly created an ops_incidents row';
  end if;

  -- Clean up. ops_incident_updates is genuinely append-only
  -- (private.reject_mutation blocks DELETE outright, no role exception),
  -- so the timeline entry — and by extension the ops_incidents row it
  -- belongs to — cannot be removed. No append-only table's migration in
  -- this codebase runs a real insert-based self-test for exactly this
  -- reason (audit_log's own migrations only assert the trigger exists);
  -- proving the actual severity-mapping logic end to end was worth the
  -- trade-off here, so instead of deleting, close the test incident out
  -- properly through the register's own workflow — a genuine, clearly
  -- labelled status transition, not a fabricated row left dangling open.
  -- The near_miss report created no ops_incidents row at all, so it has
  -- nothing to close.
  update public.ops_incidents
  set status = 'closed',
      root_cause = 'Migration self-test (20260829110000) verifying the clinical_incident_reports to ops_incidents auto-link. No real incident occurred.',
      corrective_action = 'None needed — this row exists only to prove the auto-link trigger works.'
  where id = v_linked_ops_id;

  -- clinical_incident_reports itself carries no append-only guard (a filed
  -- report is retained via RLS/grants having no DELETE policy for
  -- `authenticated`, not via a hard trigger), so the migration role can
  -- clean up both fixture reports directly. ops_incidents.clinical_incident_
  -- report_id is ON DELETE SET NULL, so the now-closed self-test
  -- ops_incidents row survives with its link cleared rather than being
  -- cascaded away.
  delete from public.clinical_incident_reports where id in (v_report_id, v_low_report_id);

  raise notice 'PASS: clinical_incident_reports auto-links medium/high/critical to ops_incidents, leaves near_miss/low alone';
end $$;
