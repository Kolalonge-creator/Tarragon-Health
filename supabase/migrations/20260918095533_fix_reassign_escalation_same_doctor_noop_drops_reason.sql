-- Tarragon Health
-- Fixes a real audit-trail gap in public.reassign_escalation() found by a /code-review ultra
-- pass: reassigning a case to the doctor ALREADY assigned to it (while its status is already
-- 'open') is a no-op UPDATE -- assigned_doctor_id and status both end up unchanged, so
-- private.audit_row_change()'s UPDATE branch computes an empty changed-columns list and returns
-- early WITHOUT inserting an audit_log row at all (its own "a touch, not a real change" guard,
-- correct and unchanged for the ~110+ other tables it also fires on). The caller-supplied reason
-- -- the whole point of this RPC -- is silently discarded, with no trace anywhere.
--
-- useAssignableDoctors() (apps/web/src/lib/queries/clinical-staff.ts) lists every active
-- non-care-coordinator doctor including whoever is already assigned, so the "Assign to..."
-- dropdown genuinely lets a CMO re-pick the current assignee (the app-layer fix in the same PR
-- filters this option out of the dropdown, but the DB is still the authoritative gate -- a stale
-- client or a future call site must not be able to silently lose a reason this way).
--
-- Fixed by rejecting the reassignment outright when the target doctor already holds the case --
-- there is nothing to reassign, and a clear error is far better than a reason that vanishes.

create or replace function public.reassign_escalation(
  p_escalation_id uuid,
  p_doctor_profile_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reason  text;
  v_current uuid;
  v_found   boolean;
begin
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is not null and length(v_reason) > 300 then
    raise exception 'Reason must be 300 characters or fewer' using errcode = '22001';
  end if;

  -- Visible under the caller's own RLS, same as the UPDATE below -- an
  -- escalation invisible to the caller reads as NULL here, and the
  -- not-found check further down still catches that case correctly.
  select assigned_doctor_id into v_current
    from public.escalations where id = p_escalation_id;

  if v_current is not null and v_current = p_doctor_profile_id then
    raise exception 'This case is already assigned to that doctor -- nothing to reassign' using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', coalesce(v_reason, ''), true);

  update public.escalations
  set assigned_doctor_id = p_doctor_profile_id,
      status = 'open'
  where id = p_escalation_id;

  v_found := found;

  perform set_config('app.audit_reason', '', true);

  if not v_found then
    raise exception 'Escalation not found, or not visible to you' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.reassign_escalation(uuid, uuid, text) is
  'CMO reassignment of a case to another doctor (docs/CLAUDE.md Clinical Tier Ladder, the "Assign to..." control), with an optional caller-supplied reason captured into audit_log.reason via app.audit_reason -- see 20260829204722_audit_log_reason_and_result.sql and 20260918085308''s Part 0 fix to private.audit_row_change(). SECURITY INVOKER -- RLS plus private.enforce_escalation_reassignment_authority remain the real, unchanged enforcement boundary; this function adds no privilege of its own. Rejects reassigning to the doctor already assigned (22023) -- otherwise the UPDATE is a no-op, private.audit_row_change() skips it as "nothing changed", and the caller''s reason would silently vanish with no audit_log row at all (found 2026-09-18). p_reason is capped at 300 chars, always written to app.audit_reason (even when empty) so a stale value from an earlier statement in the same transaction can never be misattributed, and must never carry patient-identifying or clinical detail -- see audit_log.reason''s own column comment. FOUND is captured into v_found immediately after the UPDATE -- the later set_config call is itself a query and would otherwise clobber FOUND before the not-found check ever runs.';

-- Proof, not hope: reassigning to the doctor already holding the case genuinely raises, under a
-- simulated org-staff session.
do $$
declare
  v_staff_profile uuid;
  v_org           uuid;
  v_patient       uuid;
  v_case_id       uuid;
  v_rejected      boolean;
begin
  select id, organisation_id into v_staff_profile, v_org
    from public.profiles where role <> 'patient' and organisation_id is not null limit 1;
  if v_staff_profile is null then
    raise notice 'SKIP: no org-staff profile to test against (empty database)';
    return;
  end if;

  select id into v_patient from public.profiles
    where organisation_id = v_org and role = 'patient' limit 1;
  if v_patient is null then
    raise notice 'SKIP: no patient profile in org % to build a fixture against', v_org;
    return;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text, true);

  insert into public.escalations (organisation_id, patient_id, reason, assigned_doctor_id, status)
  values (v_org, v_patient, 'reassign-noop-fix proof block', v_staff_profile, 'open')
  returning id into v_case_id;

  v_rejected := false;
  begin
    perform public.reassign_escalation(v_case_id, v_staff_profile, 'should be refused as a no-op');
  exception when others then
    if sqlstate = '22023' then
      v_rejected := true;
    else
      raise;
    end if;
  end;

  perform set_config('request.jwt.claims', '', true);

  if not v_rejected then
    raise exception 'FAIL: reassign_escalation allowed reassigning to the doctor already holding the case';
  end if;

  raise notice 'PASS: reassign_escalation rejects a same-doctor no-op reassignment instead of silently dropping the reason';

  raise exception 'rollback_test_data';
exception
  when others then
    perform set_config('request.jwt.claims', '', true);
    if sqlerrm <> 'rollback_test_data' then
      raise;
    end if;
end $$;
