-- Tarragon Health
-- Flag cross-org PHI access on the two existing audit-write paths
--
-- Context: private.is_org_staff() (the function gating ~110+ patient-scoped tables) admits the
-- `admin` role unconditionally, for every organisation — a deliberate design choice (see
-- proxy.ts's own comment: "super admin has full platform control ... for oversight"), not a bug.
-- Founder decision 2026-08-29: keep that access as-is (removing it risks breaking the founder's
-- own solo-operator support/debug workflow), but make it accountable rather than silent. Writes
-- to the 21+ clinical-core tables already land in public.audit_log via
-- private.audit_row_change() (20260812030853), and the one highest-value PHI read path already
-- logs via public.log_patient_record_view() (20260812034612) — both already capture actor_id via
-- auth.uid(). Neither previously flagged whether that actor was acting *outside their own
-- organisation* (the specific shape of the admin-bypass risk, and equally relevant if an
-- org-staff RLS predicate is ever misconfigured again the way CLAUDE.md documents happening
-- twice before). This migration adds that one boolean to both existing event payloads. No RLS,
-- grant, or access-control behaviour changes at all — purely additive audit-trail enrichment.
--
-- Query pattern for a compliance review or incident investigation:
--   select * from public.audit_log where (event->>'cross_org_actor')::boolean is true
--   order by created_at desc;
--
-- Verified live 2026-08-29 in a begin/rollback transaction (no trace left): an update that moves
-- a profile to a different (fabricated, rolled back) organisation while the acting profile stays
-- in its own org produced cross_org_actor=true; a same-org update on a different profile produced
-- cross_org_actor=false. Both as expected.

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid;
  v_actor_org  uuid;
  v_org        uuid;
  v_entity_id  uuid;
  v_action     text;
  v_changed    text[];
  v_old        jsonb;
  v_new        jsonb;
  v_hash       text;
  v_cross_org  boolean;
begin
  v_actor := coalesce(
    auth.uid(),
    nullif(current_setting('app.audit_actor_id', true), '')::uuid
  );

  if tg_op = 'INSERT' then
    v_new       := to_jsonb(NEW);
    v_entity_id := (v_new ->> 'id')::uuid;
    v_org       := nullif(v_new ->> 'organisation_id', '')::uuid;
    v_action    := tg_table_name || '.created';
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_new) where value is not null;
    v_hash := encode(extensions.digest(v_new::text, 'sha256'), 'hex');

  elsif tg_op = 'UPDATE' then
    v_old       := to_jsonb(OLD);
    v_new       := to_jsonb(NEW);
    v_entity_id := (v_new ->> 'id')::uuid;
    v_org       := nullif(v_new ->> 'organisation_id', '')::uuid;
    v_action    := tg_table_name || '.updated';
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_new) n
      where key <> 'updated_at'
        and n.value is distinct from (v_old -> n.key);

    if v_changed is null then
      -- Nothing changed except (at most) updated_at — a touch, not a real change.
      return NEW;
    end if;

    v_hash := encode(extensions.digest(v_new::text, 'sha256'), 'hex');

  elsif tg_op = 'DELETE' then
    v_old       := to_jsonb(OLD);
    v_entity_id := (v_old ->> 'id')::uuid;
    v_org       := nullif(v_old ->> 'organisation_id', '')::uuid;
    v_action    := tg_table_name || '.deleted';
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_old) where value is not null;
    v_hash := encode(extensions.digest(v_old::text, 'sha256'), 'hex');
  end if;

  if v_actor is not null then
    select organisation_id into v_actor_org from public.profiles where id = v_actor;
  end if;
  v_cross_org := v_actor_org is not null and v_org is not null and v_actor_org <> v_org;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_org, v_actor, v_action, tg_table_name, v_entity_id,
    jsonb_build_object(
      'changed_columns', to_jsonb(coalesce(v_changed, array[]::text[])),
      'row_hash', v_hash,
      'actor_resolved', v_actor is not null,
      'cross_org_actor', v_cross_org
    )
  );

  if tg_op = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

comment on function private.audit_row_change() is
  'Generic AFTER INSERT/UPDATE/DELETE audit trigger. Logs actor, action, entity, the list of '
  'changed column NAMES (never values), a sha256 hash of the full row, and whether the acting '
  'profile''s own organisation_id differs from the row''s (cross_org_actor) to public.audit_log. '
  'See 20260812030853_row_change_audit_triggers.sql for the original design and '
  '20260829222942_flag_cross_org_actor_on_phi_audit_entries.sql for the cross_org_actor addition.';

create or replace function public.log_patient_record_view(p_patient_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org       uuid;
  v_actor_org uuid;
  v_cross_org boolean;
begin
  select organisation_id into v_org from public.profiles where id = p_patient_id;

  if v_org is null or not private.is_org_staff(v_org) then
    raise exception 'not authorised';
  end if;

  select organisation_id into v_actor_org from public.profiles where id = auth.uid();
  v_cross_org := v_actor_org is not null and v_actor_org <> v_org;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_org, auth.uid(), 'clinician.patient_record_viewed', 'patient', p_patient_id,
    jsonb_build_object('cross_org_actor', v_cross_org)
  );
end;
$$;

comment on function public.log_patient_record_view(uuid) is
  'Logs a clinician/doctor/admin opening a patient''s full chart, including whether the actor''s '
  'own organisation differs from the patient''s (cross_org_actor). Called from '
  'apps/web/src/app/(dashboard)/clinician/patients/[patientId]/page.tsx after confirming the '
  'patient exists and is in the caller''s org (which private.is_org_staff() admits admin accounts '
  'to unconditionally by design — this is the accountability trail for that). See '
  '20260812034612_clinician_patient_record_view_audit.sql for the original rationale.';

-- Grants are unaffected by CREATE OR REPLACE (same name+signature), but re-assert them anyway —
-- proof, not hope, matching this project's established discipline for anything touching a
-- SECURITY DEFINER function's ACL-adjacent surface.
do $$
begin
  if has_function_privilege('anon', 'public.log_patient_record_view(uuid)', 'EXECUTE') then
    raise exception 'log_patient_record_view is EXECUTE-able by anon after replace — ACL regressed';
  end if;
  if not has_function_privilege('authenticated', 'public.log_patient_record_view(uuid)', 'EXECUTE') then
    raise exception 'log_patient_record_view is NOT EXECUTE-able by authenticated after replace';
  end if;
end $$;
