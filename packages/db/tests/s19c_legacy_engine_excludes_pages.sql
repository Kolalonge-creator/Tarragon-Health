-- S19c guard: the LIVE legacy critical alert engine must keep excluding page notifications (source_table 'pages' and 'page_tests').
--
-- Why a separate script: the engine is replaced by other migrations from time to time (patient ladder, new exclusions). A later
-- create-or-replace that starts from an older copy would silently drop the exclusion, and a failed page push could then climb the
-- engine's ladder to an SMS rung again (CMO decision 10: no SMS for pages). This fails the replay if that happens.
--
-- It checks the definition AND the behaviour (a failed critical page notification gets no next hop, an ordinary critical one does),
-- then sabotages the engine by stripping the clause in a copy and requires the behavioural check to flip.
begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
grant all on results to public;

do $$
declare
  v_def text := pg_get_functiondef('private.escalate_unconfirmed_critical_notifications()'::regprocedure);
  v_org uuid; v_rcpt uuid; v_page uuid; v_other uuid; v_n_page integer; v_n_other integer;
  v_stripped text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_rcpt from public.profiles order by created_at limit 1;
  insert into results values ('the definition excludes pages and page_tests', 'true', (v_def like '%not in (''pages'', ''page_tests'')%')::text);

  -- two failed critical notifications, one a page's, one an ordinary alert's
  insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, priority, source_table, source_id, created_at)
    values (v_rcpt, v_org, 'push', 'on_call_page', '{}', 'failed', 'critical', 'pages', gen_random_uuid(), now() - interval '10 minutes') returning id into v_page;
  insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, priority, created_at)
    values (v_rcpt, v_org, 'push', 'vitals_red_flag_clinician_alert', '{}', 'failed', 'critical', now() - interval '10 minutes') returning id into v_other;
  perform private.escalate_unconfirmed_critical_notifications();
  select count(*) into v_n_page from public.notifications where escalated_from_id = v_page;
  select count(*) into v_n_other from public.notifications where escalated_from_id = v_other;
  insert into results values ('a failed page notification gets no next hop', '0', v_n_page::text);
  insert into results values ('control: a failed ordinary critical notification does get one', '1', v_n_other::text);

  -- SABOTAGE: strip the exclusion from a copy of the live engine; the same page notification must now be escalated
  v_stripped := regexp_replace(v_def, E'\\n\\s*-- S19c[^\\n]*\\n\\s*and coalesce\\(n\\.source_table, ''''\\) not in \\(''pages'', ''page_tests''\\)', '', 'n');
  if v_stripped = v_def then
    v_stripped := replace(v_def, 'and coalesce(n.source_table, '''') not in (''pages'', ''page_tests'')', 'and true');
  end if;
  if v_stripped = v_def then raise exception 'VACUOUS TEST: could not strip the exclusion to sabotage the engine'; end if;
  delete from public.notifications where escalated_from_id in (v_page, v_other);
  execute v_stripped;
  perform private.escalate_unconfirmed_critical_notifications();
  select count(*) into v_n_page from public.notifications where escalated_from_id = v_page;
  insert into results values ('SABOTAGE: with the exclusion stripped the page notification IS escalated (so the check can fail)', '0', v_n_page::text);
end $$;

do $$
declare v_bad text;
begin
  select string_agg(check_name || ' => expected ' || expected || ' got ' || actual, '; ') into v_bad
    from results where check_name not like 'SABOTAGE%' and expected is distinct from actual;
  if v_bad is not null then raise exception 'S19c legacy engine guard FAILED: %', v_bad; end if;
  if exists (select 1 from results where check_name like 'SABOTAGE%' and expected = actual) then
    raise exception 'VACUOUS TEST: stripping the exclusion did not change the behavioural check';
  end if;
end $$;

select check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
  from results where check_name not like 'SABOTAGE%' order by check_name;

rollback;
