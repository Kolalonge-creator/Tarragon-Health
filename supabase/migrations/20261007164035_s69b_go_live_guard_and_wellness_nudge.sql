-- S69b: (1) the INV-14 go-live guard for community cohorts, (2) the INV-07 fix for the solo wellness challenge ending nudge.
--
-- Numbering note: this file is stamped after 20261007153917 on purpose. It patches two functions that S28c redefined, and a fresh
-- replay must apply it AFTER every other redefinition of them.
--
-- (1) The guard. go_live_conditions and attest_go_live_condition are redefined by several sessions, so this migration does NOT paste a new
-- copy of either: it reads the live definition, inserts the community branch / the two attestable codes, and re-creates it. If another
-- session changed the surrounding text so the anchor is not found, the migration fails loudly rather than silently dropping a branch.
-- Conditions: a CMO-approved challenge template (read from the data), a recorded DPIA and counsel's confirmation of the NDPA 2023
-- section references (both attestations by a person). Switch role: admin. Enforced in: private.community_open (every cohort, invite,
-- join, contribution and board function for a real person). Not enforced in: leaving, withdrawing consent and turning community off,
-- which must always work.
--
-- (2) The nudge. private.queue_wellness_challenge_ending_nudges (2026-08-09) put the challenge title and the progress figure into the
-- payload, and the sender renders them into the push and the in-app line ("5-Day Vitals Streak ... 3/5"). INV-07 says no notice names
-- a reading or a result; a challenge named after vitals logging with a progress count is close enough that it is made neutral. The
-- notice now says only that a challenge ends soon. Live counts at writing: not read here (the change adds no data).

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('community_cohorts_enabled', 'Community cohorts and challenges',
   'Creating or joining a cohort, cohort invites, challenge contributions, cohort totals and the cohort board (real people; test accounts pass)',
   'At least one challenge template signed by the Chief Medical Officer; a data protection impact assessment recorded; counsel has confirmed the NDPA 2023 references; admin confirmation',
   'admin',
   array['private.community_open (community_create, community_create_invite, community_preview_invite, community_join, community_my_cohorts, community_roster, community_start_challenge, community_challenges, contribute_to_challenge, community_board)'],
   'Leaving a cohort, withdrawing consent to totals, turning community off, reporting, and a moderator removing a member or closing a cohort are never behind it. Live group audio sessions are a separate switch (platform_modules group_sessions) and are not built.')
on conflict (key) do nothing;

do $$
declare
  v_def text; v_new text;
  v_branch constant text := $branch$elsif p_key = 'community_cohorts_enabled' then
    return jsonb_build_array(
      private.go_live_cond('challenge_templates_approved', 'At least one challenge template signed by the Chief Medical Officer',
        exists (select 1 from public.challenge_templates where status = 'approved'), 'data',
        (select count(*) from public.challenge_templates where status = 'approved') || ' approved'),
      private.go_live_cond('dpia_recorded', 'A data protection impact assessment for cohort membership is recorded', private.go_live_attested(p_key, 'dpia_recorded'), 'attestation', null),
      private.go_live_cond('counsel_ndpa_confirmed', 'Counsel has confirmed the NDPA 2023 section references for cohort consent', private.go_live_attested(p_key, 'counsel_ndpa_confirmed'), 'attestation', null),
      private.go_live_cond('admin_confirmation', 'Admin confirmation', true, 'switch', 'Given by an admin pressing the switch'));
  $branch$;
begin
  v_def := pg_get_functiondef('private.go_live_conditions(text,uuid)'::regprocedure);
  if position('community_cohorts_enabled' in v_def) = 0 then
    if position('elsif p_key = ''public_signup_enabled'' then' in v_def) = 0 then raise exception 'S69b: anchor not found in go_live_conditions, rebase this migration'; end if;
    v_new := replace(v_def, 'elsif p_key = ''public_signup_enabled'' then', v_branch || 'elsif p_key = ''public_signup_enabled'' then');
    execute v_new;
  end if;

  v_def := pg_get_functiondef('public.attest_go_live_condition(text,text,boolean,text)'::regprocedure);
  if position('community_cohorts_enabled' in v_def) = 0 then
    if position('(''public_signup_enabled'', ''stage2_exit_criteria_met''))' in v_def) = 0 then raise exception 'S69b: anchor not found in attest_go_live_condition, rebase this migration'; end if;
    v_new := replace(v_def, '(''public_signup_enabled'', ''stage2_exit_criteria_met''))',
                     '(''public_signup_enabled'', ''stage2_exit_criteria_met''), (''community_cohorts_enabled'', ''dpia_recorded''), (''community_cohorts_enabled'', ''counsel_ndpa_confirmed''))');
    execute v_new;
  end if;
end $$;

revoke all on function private.go_live_conditions(text, uuid) from public;
revoke all on function public.attest_go_live_condition(text, text, boolean, text) from public, anon;
grant execute on function public.attest_go_live_condition(text, text, boolean, text) to authenticated;

-- (2) neutral nudge: the payload is empty, so no title, count or target can reach any channel
create or replace function private.queue_wellness_challenge_ending_nudges()
 returns void
 language sql
 security definer
 set search_path to ''
as $function$
  with candidates as (
    select
      e.id,
      e.organisation_id,
      e.patient_id,
      c.target_count,
      private.wellness_challenge_metric_count(
        e.patient_id, c.metric, e.started_at, least(now(), e.target_end_at)
      ) as progress
    from public.patient_challenge_enrolments e
    join public.wellness_challenges c on c.id = e.challenge_id
    where e.status = 'active'
      and e.reminder_sent_at is null
      and e.target_end_at > now()
      and e.target_end_at <= now() + interval '24 hours'
  ),
  due as (
    select * from candidates where progress < target_count
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, private.patient_reminder_channel(patient_id), 'pending', 'wellness_challenge_ending', '{}'::jsonb
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, 'in_app', 'pending', 'wellness_challenge_ending', '{}'::jsonb
    from due
    returning id
  )
  update public.patient_challenge_enrolments e
    set reminder_sent_at = now()
  from due
  where e.id = due.id;
$function$;

update public.notification_template_locales
   set body = 'Your challenge ends soon, keep going'
 where template_key = 'wellness_challenge_ending' and locale = 'en' and channel = 'in_app';

do $$
begin
  if jsonb_array_length(private.go_live_conditions('community_cohorts_enabled', null)) <> 4 then raise exception 'S69b: the community guard has no conditions'; end if;
  if exists (select 1 from public.go_live_guards where key = 'community_cohorts_enabled' and is_on) then raise exception 'S69b: the guard was born on'; end if;
  if position('challenge_title' in pg_get_functiondef('private.queue_wellness_challenge_ending_nudges()'::regprocedure)) > 0 then raise exception 'S69b: the nudge still carries the title'; end if;
end $$;
