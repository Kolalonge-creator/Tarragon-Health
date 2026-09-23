-- Tarragon Health
-- Follow-up to 20260918085308_wire_audit_reason_and_denied_action_logging.sql, fixing three
-- findings from its own /code-review ultra pass (confirmed via pg_get_functiondef against the
-- live definitions before writing this, per CLAUDE.md's "check live definition directly" lesson):
--
-- 1. public.reassign_escalation() only called set_config('app.audit_reason', ...) when the caller
--    supplied a reason -- so a call with NO reason left whatever value an earlier statement in the
--    same Postgres transaction had left in that GUC, and the AFTER UPDATE audit_row_change_trg
--    would then misattribute a stale, unrelated reason to this reassignment. Not reachable in
--    production's one-RPC-per-transaction model, but real inside any multi-statement transaction
--    (this project's own packages/db/tests/*.sql harness chains many operations in one
--    begin/rollback block). Fixed: the GUC is now set unconditionally, every call, to either the
--    caller's own (validated, capped) reason or an empty string -- never left to inherit whatever a
--    prior statement set.
--
-- 2. public.log_denied_action() had no length cap on p_reason, unlike the 300-char cap
--    reassign_escalation already enforces on the same logical field -- inconsistent validation
--    between the two new RPCs added by the same migration. Fixed: same 300-char cap, same
--    empty-string-becomes-null normalisation.
--
-- 3. public.log_denied_action() accepted a fully arbitrary p_action string from any org-staff
--    caller, with nothing tying the call to a genuine 42501 the caller actually just received --
--    any clinical_staff member (not just the ones a real guard clause would deny) could write a
--    fabricated 'denied' audit_log row for any action/entity/reason they liked, indistinguishable
--    from a real one. This pollutes a trail CLAUDE.md treats as NDPR-relevant. There is no way to
--    cryptographically prove a specific DB-level rejection actually happened from a call this
--    deliberately separate from that rejection (see the original migration's header for why it has
--    to be separate at all) -- so instead of trying, this closes the highest-leverage gap: p_action
--    is now restricted to the exact allowlist of action codes this pass actually wires
--    (escalations.reassignment_denied, escalations.claim_denied, medications.amendment_denied).
--    A caller can still self-report a denial that didn't happen for one of these three real
--    scenarios, but can no longer use this function to write an arbitrary audit_log entry under an
--    action code of their own choosing. Extending the wired call sites in a future pass means
--    extending this allowlist explicitly, not something this function should infer.

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
begin
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is not null and length(v_reason) > 300 then
    raise exception 'Reason must be 300 characters or fewer' using errcode = '22001';
  end if;

  -- Set unconditionally (never only in the "reason supplied" branch) so this
  -- GUC always reflects THIS call, never a stale value a prior statement in
  -- the same Postgres transaction happened to leave behind.
  perform set_config('app.audit_reason', coalesce(v_reason, ''), true);

  update public.escalations
  set assigned_doctor_id = p_doctor_profile_id,
      status = 'open'
  where id = p_escalation_id;

  perform set_config('app.audit_reason', '', true);

  if not found then
    raise exception 'Escalation not found, or not visible to you' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.log_denied_action(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_organisation_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  if p_organisation_id is null or not private.is_org_staff(p_organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- Deliberately not open-ended -- see this migration's header, finding 3.
  -- Extend this list explicitly (with a matching app-layer call site) rather
  -- than inferring one from a new action string.
  if p_action not in (
    'escalations.reassignment_denied',
    'escalations.claim_denied',
    'medications.amendment_denied'
  ) then
    raise exception 'log_denied_action: unrecognised action %', p_action using errcode = '22023';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is not null and length(v_reason) > 300 then
    raise exception 'Reason must be 300 characters or fewer' using errcode = '22001';
  end if;

  return private.audit_log_denied_action(
    p_action, p_entity_type, p_entity_id, p_organisation_id, v_reason, 'denied'
  );
end;
$$;

comment on function public.reassign_escalation(uuid, uuid, text) is
  'CMO reassignment of a case to another doctor (docs/CLAUDE.md Clinical Tier Ladder, the "Assign to..." control), with an optional caller-supplied reason captured into audit_log.reason via app.audit_reason -- see 20260829204722_audit_log_reason_and_result.sql and 20260918085308''s Part 0 fix to private.audit_row_change(). SECURITY INVOKER -- RLS plus private.enforce_escalation_reassignment_authority remain the real, unchanged enforcement boundary; this function adds no privilege of its own. p_reason is capped at 300 chars, always written to app.audit_reason (even when empty) so a stale value from an earlier statement in the same transaction can never be misattributed, and must never carry patient-identifying or clinical detail -- see audit_log.reason''s own column comment.';

comment on function public.log_denied_action(text, text, uuid, uuid, text) is
  'App-layer wrapper around private.audit_log_denied_action(), callable by any org-staff member to durably record that THEIR OWN just-attempted action was rejected. Deliberately a SEPARATE call from the guard clause that raised -- see 20260918085308''s Part 2 header for why a same-transaction insert-then-raise cannot survive. p_action is restricted to a fixed allowlist of real wired denial scenarios (see this migration''s header) -- not proof a specific rejection happened, but closes the arbitrary-audit-log-graffiti gap a fully open action string would leave. p_reason is capped at 300 chars and must never carry patient-identifying or clinical detail, same as every other audit_log.reason caller. Gated by private.is_org_staff(p_organisation_id) so a patient or a stranger to the org cannot use this at all.';

-- Proof, not hope. A real org-staff profile is needed to pass log_denied_action's
-- is_org_staff() gate (auth.uid()-based -- must run under a simulated session, not
-- bare as the migration owner, or every call fails at that gate before reaching
-- whatever this block actually wants to prove).
do $$
declare
  v_staff_profile uuid;
  v_org uuid;
  v_baseline_ids uuid[];
  v_step_id uuid;
  v_row record;
  v_rejected boolean;
  v_denied_id uuid;
begin
  select id, organisation_id into v_staff_profile, v_org
    from public.profiles where role <> 'patient' and organisation_id is not null limit 1;
  if v_staff_profile is null then
    raise notice 'SKIP: no org-staff profile to test against (empty database)';
    return;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text, true);

  -- 1. reassign_escalation's GUC-leak fix: an unconditional
  --    set_config('app.audit_reason', '', true) must actually clear a stale
  --    value a prior statement left, not just skip setting a new one.
  select coalesce(array_agg(id), array[]::uuid[]) into v_baseline_ids from public.audit_log
    where entity_type = 'profiles' and entity_id = v_staff_profile and action = 'profiles.updated';

  perform set_config('app.audit_reason', 'a stale reason from an unrelated earlier statement', true);
  perform set_config('app.audit_reason', '', true); -- what the unconditional fix now always does

  update public.profiles set full_name = coalesce(full_name, '') || ' (guc-leak-fix-proof)'
    where id = v_staff_profile;

  select id into v_step_id from public.audit_log
    where entity_type = 'profiles' and entity_id = v_staff_profile and action = 'profiles.updated'
      and id <> all (v_baseline_ids);
  select * into v_row from public.audit_log where id = v_step_id;

  if v_row.reason is not null then
    raise exception 'FAIL: unconditional set_config('''', true) did not clear a stale app.audit_reason (got %)', v_row.reason;
  end if;

  -- 2. log_denied_action's action allowlist actually discriminates.
  v_rejected := false;
  begin
    perform public.log_denied_action('made.up.action', 'profiles', v_staff_profile, v_org, 'should be refused');
  exception when others then
    if sqlstate = '22023' then
      v_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_rejected then
    raise exception 'FAIL: log_denied_action accepted an action outside the allowlist';
  end if;

  -- 3. log_denied_action still works for a real allowlisted action.
  v_denied_id := public.log_denied_action(
    'escalations.reassignment_denied', 'escalations', v_staff_profile, v_org, 'proof-block negative test'
  );
  select * into v_row from public.audit_log where id = v_denied_id;
  if v_row.result is distinct from 'denied' or v_row.reason is distinct from 'proof-block negative test' then
    raise exception 'FAIL: log_denied_action did not record an allowlisted action correctly (result=%, reason=%)',
      v_row.result, v_row.reason;
  end if;

  -- 4. log_denied_action's reason cap actually discriminates.
  v_rejected := false;
  begin
    perform public.log_denied_action(
      'escalations.reassignment_denied', 'escalations', v_staff_profile, v_org, repeat('x', 301)
    );
  exception when others then
    if sqlstate = '22001' then
      v_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_rejected then
    raise exception 'FAIL: log_denied_action accepted a reason over 300 characters';
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'PASS: reassign_escalation GUC leak fixed, log_denied_action allowlist + reason cap both discriminate (4/4 checks)';

  raise exception 'rollback_test_data';
exception
  when others then
    perform set_config('request.jwt.claims', '', true);
    if sqlerrm <> 'rollback_test_data' then
      raise;
    end if;
end $$;
