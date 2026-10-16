-- INV-08 proof: a pending sms or voice notification row is suppressed whichever producer inserts it; email, push and in-app are untouched;
-- history is not rewritten. Own fixtures; BEGIN/ROLLBACK; sabotage at the end.
begin;

do $$
declare
  v_org uuid; v_pat uuid; v_cc public.notification_content_class; v_tpl text;
  v_sms uuid; v_voice uuid; v_email uuid; v_push uuid; v_failed uuid; v_crit uuid; v_st text; v_fa timestamptz;
begin
  select organisation_id, id into v_org, v_pat from public.profiles where role = 'patient' and organisation_id is not null limit 1;
  select content_class, template into v_cc, v_tpl from public.notifications where template is not null limit 1;
  if v_org is null or v_pat is null then raise exception 'fixture missing'; end if;
  v_cc := coalesce(v_cc, 'non_clinical');
  v_tpl := coalesce(v_tpl, 'security.new_device_signin');

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class) values (v_org, v_pat, 'sms', 'pending', v_tpl, '{}', v_cc) returning id into v_sms;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class) values (v_org, v_pat, 'voice', 'pending', v_tpl, '{}', v_cc) returning id into v_voice;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class) values (v_org, v_pat, 'email', 'pending', v_tpl, '{}', v_cc) returning id into v_email;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class) values (v_org, v_pat, 'push', 'pending', v_tpl, '{}', v_cc) returning id into v_push;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class) values (v_org, v_pat, 'sms', 'failed', v_tpl, '{}', v_cc) returning id into v_failed;

  select status::text into v_st from public.notifications where id = v_sms;
  if v_st <> 'suppressed' then raise exception 'FAIL: a pending sms row stayed %', v_st; end if;
  select status::text into v_st from public.notifications where id = v_voice;
  if v_st <> 'suppressed' then raise exception 'FAIL: a pending voice row stayed %', v_st; end if;
  if (select last_error from public.notifications where id = v_sms) not like 'INV-08%' then raise exception 'FAIL: reason not recorded'; end if;
  -- controls: the other channels are untouched, and a row inserted already failed is not rewritten
  select status::text into v_st from public.notifications where id = v_email;
  if v_st <> 'pending' then raise exception 'FAIL: an email row was changed to %', v_st; end if;
  select status::text into v_st from public.notifications where id = v_push;
  if v_st <> 'pending' then raise exception 'FAIL: a push row was changed to %', v_st; end if;
  select status::text into v_st from public.notifications where id = v_failed;
  if v_st <> 'failed' then raise exception 'FAIL: history was rewritten (%)', v_st; end if;
  -- a CRITICAL sms row must end as failed (not suppressed), so the escalation engine still records an exhausted ladder and raises its admin alarm
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class, priority) values (v_org, v_pat, 'sms', 'pending', v_tpl, '{}', v_cc, 'critical') returning id into v_crit;
  select status::text, failed_at into v_st, v_fa from public.notifications where id = v_crit;
  if v_st <> 'failed' or v_fa is null then raise exception 'FAIL: a critical sms hop ended % (failed_at %), which would silence the exhausted-ladder alarm', v_st, v_fa; end if;
  select status::text into v_st from public.notifications where id = v_sms;
  if v_st <> 'suppressed' then raise exception 'FAIL: a non-critical sms row is no longer suppressed (%)', v_st; end if;
  raise notice 'PASS: sms and voice are suppressed at insert (critical ones fail so the alarm fires), other channels untouched';

  -- SABOTAGE: drop the trigger and show a pending sms row would then stay pending
  drop trigger notifications_suppress_sms_voice on public.notifications;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class) values (v_org, v_pat, 'sms', 'pending', v_tpl, '{}', v_cc) returning id into v_sms;
  select status::text into v_st from public.notifications where id = v_sms;
  if v_st <> 'pending' then raise exception 'sabotage did not leave the sms pending, the test would not discriminate'; end if;
  raise notice 'PASS: sabotage confirmed';
end $$;

rollback;
