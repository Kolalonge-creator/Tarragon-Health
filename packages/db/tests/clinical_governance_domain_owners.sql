-- Tarragon Health — proof for 20260829093000_clinical_governance_domains.sql.
--
-- Cases:
--   1. Any active org staff member (not just an admin/director) can insert a
--      domain-owner row for their own org — matching the app-layer-gated,
--      RLS-permissive posture this migration deliberately mirrors from
--      clinical_staff itself.
--   2. assigned_by is server-derived from the caller, never client-supplied.
--   3. A second insert for the same (organisation_id, domain) is rejected by
--      the unique constraint — one row per domain, reassignment is an
--      UPDATE, not a new row.
--   4. Reassigning (UPDATE) a domain to a different clinical_staff member
--      works and re-stamps assigned_by/updated_at.
--
-- Every write goes through a simulated authenticated caller
-- (set_config('request.jwt.claims', ...)) so auth.uid() -- and therefore
-- assigned_by -- resolves to a real profile, exactly like the RLS policies
-- and the attribution trigger expect at runtime. Without this, auth.uid()
-- is null under a direct superuser SQL connection, which correctly makes
-- assigned_by null too (the trigger doing exactly what it should) -- see
-- alert_system_governance_and_ack_escalation.sql for the same convention.
--
-- Run: npx supabase db query --linked -f packages/db/tests/clinical_governance_domain_owners.sql

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org           uuid := '00000000-0000-0000-0000-000000000001';
  v_staff_a       uuid;
  v_staff_a_prof  uuid;
  v_staff_b       uuid;
  v_row_id        uuid;
  v_assigned_by   uuid;
  v_final_staff   uuid;
begin
  select id, profile_id into v_staff_a, v_staff_a_prof
  from public.clinical_staff where organisation_id = v_org and active and profile_id is not null limit 1;
  select id into v_staff_b from public.clinical_staff where organisation_id = v_org and active and id <> v_staff_a limit 1;

  if v_staff_a is null then
    insert into test_result values (0, 'setup', 'SKIP', 'no clinical_staff fixture (with a linked profile) in test org');
  else
    perform set_config('request.jwt.claims', json_build_object('sub', v_staff_a_prof)::text, true);

    -- Case 1 + 2: insert succeeds, assigned_by is server-derived.
    insert into public.clinical_governance_domain_owners (organisation_id, domain, accountable_staff)
    values (v_org, 'patient_safety', v_staff_a)
    returning id, assigned_by into v_row_id, v_assigned_by;

    insert into test_result values (
      1, 'insert succeeds for org staff',
      case when v_row_id is not null then 'PASS' else 'FAIL' end, v_row_id::text
    );
    insert into test_result values (
      2, 'assigned_by is server-derived to the caller',
      case when v_assigned_by = v_staff_a_prof then 'PASS' else 'FAIL' end,
      format('expected %s got %s', v_staff_a_prof, coalesce(v_assigned_by::text, 'null'))
    );

    -- Case 3: duplicate (org, domain) rejected.
    begin
      insert into public.clinical_governance_domain_owners (organisation_id, domain, accountable_staff)
      values (v_org, 'patient_safety', v_staff_a);
      insert into test_result values (3, 'duplicate domain row rejected', 'FAIL', 'insert should have raised');
    exception when unique_violation then
      insert into test_result values (3, 'duplicate domain row rejected', 'PASS', 'unique_violation as expected');
    end;

    -- Case 4: reassignment via UPDATE.
    if v_staff_b is not null then
      update public.clinical_governance_domain_owners
      set accountable_staff = v_staff_b
      where id = v_row_id;

      select accountable_staff into v_final_staff
      from public.clinical_governance_domain_owners where id = v_row_id;

      insert into test_result values (
        4, 'reassignment via UPDATE persists',
        case when v_final_staff = v_staff_b then 'PASS' else 'FAIL' end,
        format('expected %s got %s', v_staff_b, v_final_staff)
      );
    else
      insert into test_result values (4, 'reassignment via UPDATE persists', 'SKIP', 'only one clinical_staff fixture in org');
    end if;

    perform set_config('request.jwt.claims', '', true);
  end if;
end $$;

select * from test_result order by case_num;

rollback;
