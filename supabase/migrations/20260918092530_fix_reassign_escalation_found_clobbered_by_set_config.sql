-- Tarragon Health
-- Fixes a real bug in public.reassign_escalation(), present since it was first added in
-- 20260918085308_wire_audit_reason_and_denied_action_logging.sql and unchanged by the
-- 20260918091640 follow-up: its "escalation not found" check was dead code.
--
-- PL/pgSQL's special FOUND variable is set by the UPDATE statement (true when it affects at
-- least one row), but the very next statement -- `perform set_config('app.audit_reason', '',
-- true);` -- immediately overwrites FOUND again, because PERFORM sets FOUND from whatever query
-- it runs, and set_config() is a normal scalar function that always returns exactly one row. So
-- by the time `if not found then raise exception 'Escalation not found...'` runs, FOUND reflects
-- the set_config call, not the UPDATE -- always true, the check can never fire.
--
-- Effect: calling reassign_escalation with an escalation_id that doesn't exist, or that RLS makes
-- invisible to the caller (stale worklist, a race with another session resolving/deleting the
-- case, a wrong-org id), silently does nothing and returns success -- the CMO is told the
-- reassignment worked when it didn't. Fixed by capturing FOUND into a local variable
-- IMMEDIATELY after the UPDATE, before anything else can run a query and clobber it.

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
  v_reason text;
  v_found  boolean;
begin
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is not null and length(v_reason) > 300 then
    raise exception 'Reason must be 300 characters or fewer' using errcode = '22001';
  end if;

  perform set_config('app.audit_reason', coalesce(v_reason, ''), true);

  update public.escalations
  set assigned_doctor_id = p_doctor_profile_id,
      status = 'open'
  where id = p_escalation_id;

  -- Captured immediately -- nothing may run a query between the UPDATE and
  -- this line, or it clobbers FOUND again (see this migration's header).
  v_found := found;

  perform set_config('app.audit_reason', '', true);

  if not v_found then
    raise exception 'Escalation not found, or not visible to you' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.reassign_escalation(uuid, uuid, text) is
  'CMO reassignment of a case to another doctor (docs/CLAUDE.md Clinical Tier Ladder, the "Assign to..." control), with an optional caller-supplied reason captured into audit_log.reason via app.audit_reason -- see 20260829204722_audit_log_reason_and_result.sql and 20260918085308''s Part 0 fix to private.audit_row_change(). SECURITY INVOKER -- RLS plus private.enforce_escalation_reassignment_authority remain the real, unchanged enforcement boundary; this function adds no privilege of its own. p_reason is capped at 300 chars, always written to app.audit_reason (even when empty) so a stale value from an earlier statement in the same transaction can never be misattributed, and must never carry patient-identifying or clinical detail -- see audit_log.reason''s own column comment. FOUND is captured into v_found immediately after the UPDATE (20260918<followup> fix) -- the later set_config call is itself a query and would otherwise clobber FOUND before the not-found check ever runs.';

-- Proof, not hope: a nonexistent escalation_id now genuinely raises, under a simulated org-staff
-- session (RLS/auth.uid() context, matching the sibling proof blocks in this same migration
-- sequence) rather than silently returning success.
do $$
declare
  v_staff_profile uuid;
  v_rejected boolean;
begin
  select id into v_staff_profile from public.profiles where role <> 'patient' and organisation_id is not null limit 1;
  if v_staff_profile is null then
    raise notice 'SKIP: no org-staff profile to test against (empty database)';
    return;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text, true);

  v_rejected := false;
  begin
    perform public.reassign_escalation(gen_random_uuid(), v_staff_profile, 'proof-block negative test');
  exception when others then
    if sqlstate = 'P0002' then
      v_rejected := true;
    else
      raise;
    end if;
  end;

  perform set_config('request.jwt.claims', '', true);

  if not v_rejected then
    raise exception 'FAIL: reassign_escalation on a nonexistent escalation_id did not raise -- the FOUND-clobber bug is still live';
  end if;

  raise notice 'PASS: reassign_escalation now genuinely rejects a nonexistent/invisible escalation_id';

  raise exception 'rollback_test_data';
exception
  when others then
    perform set_config('request.jwt.claims', '', true);
    if sqlerrm <> 'rollback_test_data' then
      raise;
    end if;
end $$;
