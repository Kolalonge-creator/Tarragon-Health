-- Plain educated voice (docs/design/COPY-VOICE.md) for the message templates stored in the database.
--
-- Wording only: no number, time limit, refund promise or clinical claim changes. Counts before this migration, measured live
-- 2026-10-30 across 301 notification_template_locales rows: 1 em dash, 2 "your doctor", 9 with contractions in body text;
-- plus one "BP" in lpe_goal_templates. No row is added or removed, so there is no data conversion step.
--
-- Each update is guarded by the template key, channel and exact old text, so a missing or since-edited template is left alone
-- (a fresh replay seeds different row ids). The neutrality trigger (INV-07) still runs on each update.

do $$
declare
  r record;
  n integer;
  changed integer := 0;
begin
  for r in
    select * from (values
      ('diabetes_complication_check_due', 'sms',
       $o$Hi, your diabetes eye screening is due {{due_date}}. Your care team can do this at your next visit — open the app for details. — Tarragon Health$o$,
       $n$Hi, your diabetes eye screening is due {{due_date}}. Your care team can do this at your next visit. Open the app for details. Tarragon Health$n$),
      ('emergency_card_viewed', 'email',
       $o$Tarragon Health: your emergency card link was viewed on {{viewed_on}}. If that wasn't expected, replace it at any time from your dashboard.$o$,
       $n$Tarragon Health: your emergency card link was viewed on {{viewed_on}}. If that was not expected, replace it at any time from your dashboard.$n$),
      ('emergency_followup', 'sms',
       $o$Hi {{patient_name}}, we noticed you recently reported an emergency. We hope you're okay. When you can, open the Tarragon Health app to let your care team know how you're doing. Tarragon Health$o$,
       $n$Hi {{patient_name}}, we noticed you recently reported an emergency. We hope you are okay. When you can, open the Tarragon Health app to let your care team know how you are doing. Tarragon Health$n$),
      ('service_purchase_expiring', 'in_app',
       $o${{label}} runs out on {{expires_on}}. Buy it again to keep it going, or let it lapse if you're done.$o$,
       $n${{label}} runs out on {{expires_on}}. Buy it again to keep it going, or let it lapse if you are done.$n$),
      ('service_purchase_expiring', 'email',
       E'Hi,\n\n{{label}} on your Tarragon Health account runs out on {{expires_on}}.\n\nNothing renews on its own and no card is kept on file -- if you''d like to keep it going, buy it again from the app before then. If you''re done with it, there''s nothing you need to do.\n\n-- Tarragon Health',
       E'Hi,\n\n{{label}} on your Tarragon Health account runs out on {{expires_on}}.\n\nNothing renews on its own and no card is kept on file. If you would like to keep it going, buy it again from the app before then. If you are done with it, there is nothing you need to do.\n\nTarragon Health'),
      ('sponsor_person_quiet', 'in_app',
       $o${{person_name}} hasn't opened the app in {{quiet_days}} days; a call might help$o$,
       $n${{person_name}} has not opened the app in {{quiet_days}} days. A call might help.$n$),
      ('video_visit_alternate_proposed', 'sms',
       $o$Your doctor offered different times for your video visit. Pick one in the app within 24 hours, or you'll be refunded in full. Tarragon Health$o$,
       $n$A doctor offered different times for your video visit. Pick one in the app within 24 hours, or you will be refunded in full. Tarragon Health$n$),
      ('video_visit_alternate_proposed', 'in_app',
       $o$Your doctor offered a different time for your video visit: pick one$o$,
       $n$A doctor offered a different time for your video visit: pick one$n$),
      ('video_visit_declined', 'sms',
       $o$We couldn't schedule your video visit ({{reason}}). Your payment will be refunded in full. You can request another time in the app. Tarragon Health$o$,
       $n$We could not schedule your video visit ({{reason}}). Your payment will be refunded in full. You can request another time in the app. Tarragon Health$n$),
      ('vitals_reminder', 'sms',
       $o$Hi, it's time to log your vitals (due {{due_date}}). Tap to log it: https://app.tarragonhealth.ng/patient/vitals Tarragon Health$o$,
       $n$Hi, it is time to log your vitals (due {{due_date}}). Tap to log it: https://app.tarragonhealth.ng/patient/vitals Tarragon Health$n$),
      ('wellness_challenge_ending', 'sms',
       $o$Hi, your "{{challenge_title}}" challenge ends in 24 hours and you're at {{progress}}/{{target}}. Finish it in the Tarragon Health app. Tarragon Health$o$,
       $n$Hi, your "{{challenge_title}}" challenge ends in 24 hours and you are at {{progress}}/{{target}}. Finish it in the Tarragon Health app. Tarragon Health$n$)
    ) as t(template_key, channel, old_body, new_body)
  loop
    -- Keyed on the template and channel, not on a row id: ids are generated per database. A row that is missing, already
    -- changed or edited by someone since is left alone.
    update public.notification_template_locales
       set body = r.new_body
     where template_key = r.template_key and channel::text = r.channel and body = r.old_body;
    get diagnostics n = row_count;
    changed := changed + n;
  end loop;
  raise notice 'copy voice: % template bodies reworded', changed;

  update public.lpe_goal_templates
     set description = 'Record a home blood pressure reading as your care team asks.'
   where key = 'log_bp'
     and description = 'Record a home BP reading as your care team asks.';

  -- Report, do not fail: a fresh replay seeds its own rows, so a remaining hit there is information, not a broken migration.
  select count(*) into n from public.notification_template_locales
   where template_key in ('diabetes_complication_check_due','emergency_card_viewed','emergency_followup','service_purchase_expiring','sponsor_person_quiet','video_visit_alternate_proposed','video_visit_declined','vitals_reminder','wellness_challenge_ending')
     and (body ~* '—|–|\myour doctor\M' or subject ~* '—|–|\myour doctor\M');
  raise notice 'copy voice: % touched templates still carry a dash or "your doctor"', n;
end $$;
