-- Tarragon Health
-- Live proof for private.stamp_protocol_version_approver
-- (20260812034845_protocol_versions_self_attribution.sql).
--
-- Before this fix, protocol_versions_insert (20260712210000) was
-- `with check (private.is_org_staff(organisation_id))` only -- "only the
-- Clinical Director signs a protocol" was enforced exclusively client-side in
-- apps/web/src/lib/queries/protocol-versions.ts's getCallerOrgAndDirector().
-- Any authenticated org-staff session could call the REST API directly and
-- INSERT a protocol_versions row with approved_by set to a completely
-- different clinical_staff member's id -- forging that person's signature on
-- a clinical protocol version. Case 2 below is that exact forgery, reproduced
-- and now proved corrected.
--
-- Cases (each negative paired with a positive control):
--   1. Director signs with their own id           -> succeeds, kept as-is
--   2. Director signs, approved_by forged to victim -> succeeds, but
--      approved_by is silently forced back to the caller's own id (THE FIX --
--      this is the exact forgery this migration closes)
--   1b. approved_at backdated by the client        -> forced to now(), not
--       the backdated value (folded into case 1's assertions)
--   3. Non-director tier_1 clinician attempts to sign -> BLOCKED 42501
--   4. Non-director care_coordinator attempts to sign, with approved_by
--      forged to the victim -> BLOCKED 42501 entirely (the precise account
--      shape -- doctor_tier='care_coordinator', is_clinical_director=false --
--      the live exploit was proved against)
--   5. An inactive (deactivated) Clinical Director attempts to sign -> BLOCKED
--      42501 (matches getCallerOrgAndDirector()'s .eq('active', true))
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: comment out the
-- `new.approved_by := v_staff_id;` line in the trigger function (leaving only
-- the director-membership check). Case 2 must FAIL, showing the victim's id
-- persisted as approved_by instead of the caller's own.
--
-- Run: npx supabase db query --linked -f packages/db/tests/protocol_version_self_attribution.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org           uuid := '00000000-0000-0000-0000-000000000001';
  v_clin          uuid;
  v_staff_id      uuid;
  v_victim_id     uuid;
  v_pv_id         uuid;
  v_approved_by   uuid;
  v_approved_at   timestamptz;
  v_blocked       boolean;
begin
  -- Same fixture discipline as refill_confirmation_attribution.sql: a real
  -- clinician-role profile with no pre-existing clinical_staff row, so the
  -- probe cannot collide with the founder's real Clinical Director record.
  select p.id into v_clin from public.profiles p
   where p.organisation_id = v_org
     and p.role = 'clinician'
     and not exists (select 1 from public.clinical_staff cs where cs.profile_id = p.id)
   limit 1;

  if v_clin is null then
    raise exception 'Need one clinician-role profile with no clinical_staff row in org %', v_org;
  end if;

  -- The "signer" -- starts as an active Clinical Director. Indemnity fields
  -- are set because clinical_staff_enforce_indemnity refuses to activate a
  -- director record without current cover.
  insert into public.clinical_staff (
    organisation_id, profile_id, full_name, active, license_verified_at,
    is_clinical_director, doctor_tier,
    indemnity_insurer, indemnity_policy_number, indemnity_expires_at
  ) values (
    v_org, v_clin, 'Protocol Attribution Probe (Signer)', true, now(),
    true, null,
    'Probe Indemnity Ltd', 'PROBE-PROTOCOL-SIGNER', now() + interval '1 year'
  ) returning id into v_staff_id;

  -- The "victim" -- a second, distinct clinical_staff identity to forge
  -- approved_by into. Synthetic (profile_id null -- the column is nullable)
  -- so this never touches a real login; tier_1 needs no indemnity fields.
  insert into public.clinical_staff (
    organisation_id, profile_id, full_name, active, license_verified_at,
    is_clinical_director, doctor_tier
  ) values (
    v_org, null, 'Protocol Attribution Probe (Victim)', true, now(), false, 'tier_1'
  ) returning id into v_victim_id;

  ---------------------------------------------------------------- case 1 (+1b)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.protocol_versions (
    organisation_id, protocol_id, version_number, title, change_summary,
    approved_by, approved_at
  ) values (
    v_org, 'attribution_probe_case1', 1, 'Probe Protocol v1', 'case 1 baseline',
    v_staff_id, '2020-01-01'::timestamptz
  ) returning id into v_pv_id;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select approved_by, approved_at into v_approved_by, v_approved_at
    from public.protocol_versions where id = v_pv_id;
  insert into test_result values (1, 'Director signs with own id -> kept, approved_at not backdated',
    case when v_approved_by = v_staff_id and v_approved_at > now() - interval '1 minute'
      then 'PASS' else 'FAIL' end,
    'approved_by=' || v_approved_by || ' approved_at=' || v_approved_at);

  ---------------------------------------------------------------- case 2
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.protocol_versions (
    organisation_id, protocol_id, version_number, title, change_summary, approved_by
  ) values (
    v_org, 'attribution_probe_case2', 1, 'Probe Protocol v2', 'case 2 forged attribution',
    v_victim_id
  ) returning id into v_pv_id;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select approved_by into v_approved_by from public.protocol_versions where id = v_pv_id;
  insert into test_result values (2, 'Director forges approved_by to victim -> forced back to own id (THE FIX)',
    case when v_approved_by = v_staff_id then 'PASS' else 'FAIL' end,
    'approved_by=' || v_approved_by || ' (victim was ' || v_victim_id || ')');

  ---------------------------------------------------------------- case 3
  update public.clinical_staff
     set is_clinical_director = false, doctor_tier = 'tier_1'
   where id = v_staff_id;

  v_blocked := false;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    insert into public.protocol_versions (
      organisation_id, protocol_id, version_number, title, change_summary, approved_by
    ) values (
      v_org, 'attribution_probe_case3', 1, 'Probe Protocol v3', 'case 3 tier_1 attempt',
      v_staff_id
    );
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (3, 'Non-director tier_1 clinician attempts to sign -> BLOCKED',
    case when v_blocked then 'PASS' else 'FAIL' end,
    case when v_blocked then '42501 raised' else 'insert allowed - BUG' end);

  ---------------------------------------------------------------- case 4
  -- The precise account shape the live exploit was proved against: a
  -- non-director care_coordinator, forging approved_by to a different
  -- clinical_staff member.
  update public.clinical_staff
     set doctor_tier = 'care_coordinator'
   where id = v_staff_id;

  v_blocked := false;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    insert into public.protocol_versions (
      organisation_id, protocol_id, version_number, title, change_summary, approved_by
    ) values (
      v_org, 'attribution_probe_case4', 1, 'Probe Protocol v4', 'case 4 care_coordinator forgery attempt',
      v_victim_id
    );
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (4, 'Non-director care_coordinator forges approved_by to victim -> BLOCKED',
    case when v_blocked then 'PASS' else 'FAIL' end,
    case when v_blocked then '42501 raised' else 'forged insert allowed - BUG' end);

  ---------------------------------------------------------------- case 5
  update public.clinical_staff
     set is_clinical_director = true, doctor_tier = null, active = false
   where id = v_staff_id;

  v_blocked := false;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    insert into public.protocol_versions (
      organisation_id, protocol_id, version_number, title, change_summary, approved_by
    ) values (
      v_org, 'attribution_probe_case5', 1, 'Probe Protocol v5', 'case 5 inactive director attempt',
      v_staff_id
    );
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (5, 'Inactive (deactivated) Clinical Director attempts to sign -> BLOCKED',
    case when v_blocked then 'PASS' else 'FAIL' end,
    case when v_blocked then '42501 raised' else 'insert allowed - BUG' end);
end $$;

select
  'CASE ' || case_num || ' [' || outcome || '] ' || label ||
    case when detail = '' then '' else ' -- ' || detail end as line
from test_result
order by case_num;

rollback;
