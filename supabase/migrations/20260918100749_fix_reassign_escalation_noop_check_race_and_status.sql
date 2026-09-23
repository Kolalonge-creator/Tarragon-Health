-- Tarragon Health
-- Two more findings from continued /code-review ultra passes on public.reassign_escalation()
-- (20260918095533's same-doctor no-op guard):
--
-- 1. TOCTOU race: the SELECT of assigned_doctor_id and the later UPDATE were two separate
--    statements with no row lock. Two concurrent reassignments of the same case to the same
--    doctor could both pass the same-doctor check (both SELECTs run before either UPDATE
--    commits), and whichever UPDATE runs second becomes a real no-op -- reproducing, in a race
--    window, the exact "reason silently dropped" bug 20260918095533 was written to close. Fixed
--    by taking a row lock (`for update`) on the SELECT, so a concurrent reassignment of the same
--    case serialises behind this one instead of racing it.
--
-- 2. The no-op guard checked only assigned_doctor_id, not status -- so calling
--    reassign_escalation with the SAME doctor already assigned was rejected even when the
--    resulting UPDATE would be a genuine, auditable change (e.g. status moving from
--    'under_review' back to 'open' for the same doctor, which private.audit_row_change() would
--    correctly capture, reason included). Not reachable via the shipped UI (whose dropdown
--    already excludes the current assignee), but the whole point of this DB-level guard is to be
--    the authoritative check for any future or non-UI caller too -- it should only reject the
--    scenario it exists to prevent (a true no-op), not every same-doctor call. Fixed by checking
--    status alongside assigned_doctor_id: only reject when BOTH are already exactly what the
--    UPDATE would set (doctor unchanged AND status already 'open').

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
  v_reason         text;
  v_current_doctor uuid;
  v_current_status public.escalation_status;
  v_found          boolean;
begin
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is not null and length(v_reason) > 300 then
    raise exception 'Reason must be 300 characters or fewer' using errcode = '22001';
  end if;

  -- `for update` closes a TOCTOU race: without a lock, two concurrent calls
  -- reassigning the same case to the same doctor could both read the SAME
  -- pre-change state, both pass the no-op check below, and whichever UPDATE
  -- commits second becomes a real no-op with its reason silently dropped --
  -- the exact bug this whole check exists to prevent. The lock makes a
  -- concurrent call on the same row wait for this transaction to finish
  -- (RPC-per-request in production, so that's typically milliseconds), not
  -- deadlock -- there is only ever one row locked here.
  select assigned_doctor_id, status into v_current_doctor, v_current_status
    from public.escalations where id = p_escalation_id
    for update;

  -- Only a TRUE no-op is rejected: the doctor is unchanged AND status is
  -- already what this function always sets it to ('open'). A same-doctor
  -- call that would still change status (e.g. 'under_review' -> 'open') is
  -- a real, auditable change and must be allowed through.
  if v_current_doctor is not null
     and v_current_doctor = p_doctor_profile_id
     and v_current_status = 'open'
  then
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
  'CMO reassignment of a case to another doctor (docs/CLAUDE.md Clinical Tier Ladder, the "Assign to..." control), with an optional caller-supplied reason captured into audit_log.reason via app.audit_reason -- see 20260829204722_audit_log_reason_and_result.sql and 20260918085308''s Part 0 fix to private.audit_row_change(). SECURITY INVOKER -- RLS plus private.enforce_escalation_reassignment_authority remain the real, unchanged enforcement boundary; this function adds no privilege of its own. Rejects a TRUE no-op reassignment -- same doctor AND status already ''open'' (22023), locked with SELECT ... FOR UPDATE to close a TOCTOU race between two concurrent same-doctor calls -- otherwise the UPDATE is a no-op, private.audit_row_change() skips it as "nothing changed", and the caller''s reason would silently vanish with no audit_log row at all (found 2026-09-18, tightened 2026-09-18 to still allow a same-doctor status-changing call through). p_reason is capped at 300 chars, always written to app.audit_reason (even when empty) so a stale value from an earlier statement in the same transaction can never be misattributed, and must never carry patient-identifying or clinical detail -- see audit_log.reason''s own column comment. FOUND is captured into v_found immediately after the UPDATE -- the later set_config call is itself a query and would otherwise clobber FOUND before the not-found check ever runs.';

-- Proof, not hope: both findings actually fixed. Step 2 needs a genuine
-- clinical-tier (non-care_coordinator) staff member, since
-- private.enforce_emergency_escalation_tier gates the open->under_review
-- transition to is_clinical_tier -- a bare "any non-patient profile" (an
-- admin, a care coordinator...) can fail that unrelated gate before this
-- proof ever exercises what it's actually testing.
do $$
declare
  v_staff_profile uuid;
  v_org           uuid;
  v_patient       uuid;
  v_case_id       uuid;
  v_rejected      boolean;
  v_new_status    public.escalation_status;
begin
  select p.id, p.organisation_id into v_staff_profile, v_org
    from public.profiles p
    join public.clinical_staff cs on cs.profile_id = p.id
    where cs.active and cs.doctor_tier is not null and cs.doctor_tier <> 'care_coordinator'
    limit 1;
  if v_staff_profile is null then
    raise notice 'SKIP: no active non-care_coordinator clinical_staff profile to test against';
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

  -- 1. True no-op (same doctor, status already 'open') is still rejected.
  insert into public.escalations (organisation_id, patient_id, reason, assigned_doctor_id, status)
  values (v_org, v_patient, 'reassign-noop-tighten proof block (true no-op)', v_staff_profile, 'open')
  returning id into v_case_id;

  v_rejected := false;
  begin
    perform public.reassign_escalation(v_case_id, v_staff_profile, 'should be refused, still a true no-op');
  exception when others then
    if sqlstate = '22023' then
      v_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_rejected then
    raise exception 'FAIL: true no-op (same doctor, status already open) was not rejected';
  end if;

  -- 2. Same doctor but status='under_review' -> a real, auditable change
  --    (status moving to 'open') must be ALLOWED, not rejected. The direct
  --    UPDATE below (not through reassign_escalation) is gated by
  --    private.enforce_emergency_escalation_tier -- v_staff_profile is the
  --    row's own assignee AND a genuine clinical tier, so it's allowed.
  update public.escalations set status = 'under_review' where id = v_case_id;

  begin
    perform public.reassign_escalation(v_case_id, v_staff_profile, 'status reset, same doctor -- must succeed');
  exception when others then
    raise exception 'FAIL: same-doctor call that would change status was wrongly rejected: %', sqlerrm;
  end;

  select status into v_new_status from public.escalations where id = v_case_id;
  if v_new_status is distinct from 'open' then
    raise exception 'FAIL: same-doctor status-changing reassignment did not actually take effect (status=%)', v_new_status;
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'PASS: reassign_escalation still rejects a true no-op, and now allows a same-doctor status-changing call through (2/2 checks)';

  raise exception 'rollback_test_data';
exception
  when others then
    perform set_config('request.jwt.claims', '', true);
    if sqlerrm <> 'rollback_test_data' then
      raise;
    end if;
end $$;
