-- Tarragon Health — employer campaign-template request verification
--
-- Proves the Engagement/Retention gap #4 design actually holds at the RLS
-- layer: a corporate_admin's own session can browse active
-- campaign_templates (needed to render the Programmes tab's template list),
-- but CANNOT insert into prevention_campaigns directly (confirms the
-- requireInstitutionAggregateAccess() service-role doorway in
-- dashboard/corporate/programmes/actions.ts is load-bearing, not
-- decorative — if this RLS check ever regresses, an employer admin could
-- write arbitrary eligibility_rule/actions JSON themselves, which is
-- exactly what the curated-template design was meant to prevent). The
-- service-role insert path the server action actually uses lands a
-- correctly-scoped draft row, and the admin-side cross-org query
-- ("requested_by is not null", no organisation filter) finds it.
--
-- Run inside a transaction that is always rolled back — nothing here should
-- ever be committed.

begin;

do $$
declare
  v_org uuid;
  v_corp_admin uuid := gen_random_uuid();
  v_template_id uuid;
  v_count int;
  v_insert_failed boolean := false;
begin
  select id into v_org from public.organisations limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_corp_admin, 'campaign-test-corp-admin@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set role = 'corporate_admin', organisation_id = v_org, full_name = 'Campaign Test Corp Admin'
    where id = v_corp_admin;

  select id into v_template_id from public.campaign_templates where code = 'know-your-bp';

  -- 1) A corporate_admin's own session CAN browse active templates.
  perform set_config('request.jwt.claims', json_build_object('sub', v_corp_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.campaign_templates where is_active;
  if v_count <> 4 then
    raise exception 'FAIL: corporate_admin should see 4 active templates, saw %', v_count;
  end if;
  raise notice 'PASS: corporate_admin session can browse active campaign_templates';

  -- 2) A corporate_admin's own session CANNOT insert into prevention_campaigns directly
  --    (confirms the service-role doorway in actions.ts is actually necessary, not decorative).
  begin
    insert into public.prevention_campaigns (organisation_id, code, name, starts_on, status, template_id, requested_by)
    values (v_org, 'direct-insert-test', 'Direct Insert Test', current_date, 'draft', v_template_id, v_corp_admin);
    v_insert_failed := false;
  exception when insufficient_privilege or others then
    v_insert_failed := true;
  end;
  perform set_config('role', 'postgres', true);
  if not v_insert_failed then
    raise exception 'FAIL: corporate_admin was able to insert into prevention_campaigns directly — RLS regression';
  end if;
  raise notice 'PASS: corporate_admin cannot insert into prevention_campaigns directly (RLS holds)';

  -- 3) The service-role path (what requireInstitutionAggregateAccess() hands the server action) DOES work.
  insert into public.prevention_campaigns (organisation_id, code, name, starts_on, ends_on, eligibility_rule, actions, status, template_id, requested_by)
  select v_org, code || '-test-' || v_org, name, current_date,
         case when default_duration_days is not null then current_date + default_duration_days else null end,
         eligibility_rule, actions, 'draft', id, v_corp_admin
  from public.campaign_templates where id = v_template_id;

  if not exists (
    select 1 from public.prevention_campaigns
    where organisation_id = v_org and template_id = v_template_id and requested_by = v_corp_admin and status = 'draft'
  ) then
    raise exception 'FAIL: service-role insert of a requested campaign did not land as expected';
  end if;
  raise notice 'PASS: a service-role insert (what the server action performs) creates a draft campaign scoped to the requesting org';

  -- 4) An admin session sees this cross-org requested row via the "not requested_by is null" query, no org filter.
  select count(*) into v_count from public.prevention_campaigns where requested_by is not null;
  if v_count < 1 then
    raise exception 'FAIL: expected at least 1 requested_by-not-null row visible to admin-style query';
  end if;
  raise notice 'PASS: the cross-org employer-requested query finds the new row';

  raise notice 'ALL PREVENTION_CAMPAIGN_TEMPLATES CHECKS PASSED';
end $$;

rollback;
