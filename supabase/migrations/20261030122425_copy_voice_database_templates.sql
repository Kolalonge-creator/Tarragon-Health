-- Plain educated voice (docs/design/COPY-VOICE.md) for the message templates stored in the database.
--
-- Wording only: no number, time limit, refund promise or clinical claim changes. Counts before this migration, measured live
-- 2026-10-30 across 301 notification_template_locales rows: 1 em dash, 2 "your doctor", 9 with contractions in body text;
-- plus one "BP" in lpe_goal_templates. No row is added or removed, so there is no data conversion step.
--
-- Each update is guarded by the exact old text, so a template someone has edited since is left alone, and the closing block
-- asserts that every targeted row now holds the new text. The neutrality trigger (INV-07) still runs on each update.

do $$
declare
  r record;
  n integer;
begin
  for r in
    select * from (values
      ('fd437b35-5579-44aa-a76f-b27e8dd40dd6'::uuid,
       $o$Hi, your diabetes eye screening is due {{due_date}}. Your care team can do this at your next visit — open the app for details. — Tarragon Health$o$,
       $n$Hi, your diabetes eye screening is due {{due_date}}. Your care team can do this at your next visit. Open the app for details. Tarragon Health$n$),
      ('513c69a6-2a96-459c-a35c-3ca41c171702'::uuid,
       $o$Tarragon Health: your emergency card link was viewed on {{viewed_on}}. If that wasn't expected, replace it at any time from your dashboard.$o$,
       $n$Tarragon Health: your emergency card link was viewed on {{viewed_on}}. If that was not expected, replace it at any time from your dashboard.$n$),
      ('4596c2c0-fbbb-4569-92a1-89b8769a84e8'::uuid,
       $o$Hi {{patient_name}}, we noticed you recently reported an emergency. We hope you're okay. When you can, open the Tarragon Health app to let your care team know how you're doing. Tarragon Health$o$,
       $n$Hi {{patient_name}}, we noticed you recently reported an emergency. We hope you are okay. When you can, open the Tarragon Health app to let your care team know how you are doing. Tarragon Health$n$),
      ('ac91228c-15a6-4c57-b082-32fdcc29ea15'::uuid,
       $o${{label}} runs out on {{expires_on}}. Buy it again to keep it going, or let it lapse if you're done.$o$,
       $n${{label}} runs out on {{expires_on}}. Buy it again to keep it going, or let it lapse if you are done.$n$),
      ('c90330dd-fd95-4a6a-a507-a3ca889e1350'::uuid,
       E'Hi,\n\n{{label}} on your Tarragon Health account runs out on {{expires_on}}.\n\nNothing renews on its own and no card is kept on file -- if you''d like to keep it going, buy it again from the app before then. If you''re done with it, there''s nothing you need to do.\n\n-- Tarragon Health',
       E'Hi,\n\n{{label}} on your Tarragon Health account runs out on {{expires_on}}.\n\nNothing renews on its own and no card is kept on file. If you would like to keep it going, buy it again from the app before then. If you are done with it, there is nothing you need to do.\n\nTarragon Health'),
      ('b218cd35-b460-489b-a6a2-b3330986d87e'::uuid,
       $o${{person_name}} hasn't opened the app in {{quiet_days}} days; a call might help$o$,
       $n${{person_name}} has not opened the app in {{quiet_days}} days. A call might help.$n$),
      ('5106aa86-7ecf-4963-8498-62e71ee73534'::uuid,
       $o$Your doctor offered different times for your video visit. Pick one in the app within 24 hours, or you'll be refunded in full. Tarragon Health$o$,
       $n$A doctor offered different times for your video visit. Pick one in the app within 24 hours, or you will be refunded in full. Tarragon Health$n$),
      ('6fb6b1fd-13f6-4371-8cae-ccb13dee5f3c'::uuid,
       $o$Your doctor offered a different time for your video visit: pick one$o$,
       $n$A doctor offered a different time for your video visit: pick one$n$),
      ('d8532a68-9ea6-4591-afb1-9a17beb22364'::uuid,
       $o$We couldn't schedule your video visit ({{reason}}). Your payment will be refunded in full. You can request another time in the app. Tarragon Health$o$,
       $n$We could not schedule your video visit ({{reason}}). Your payment will be refunded in full. You can request another time in the app. Tarragon Health$n$),
      ('87182cc0-3161-4300-8f65-c03bc4970217'::uuid,
       $o$Hi, it's time to log your vitals (due {{due_date}}). Tap to log it: https://app.tarragonhealth.ng/patient/vitals Tarragon Health$o$,
       $n$Hi, it is time to log your vitals (due {{due_date}}). Tap to log it: https://app.tarragonhealth.ng/patient/vitals Tarragon Health$n$),
      ('b621d540-0bdc-463c-ab32-d49721f5a4e0'::uuid,
       $o$Hi, your "{{challenge_title}}" challenge ends in 24 hours and you're at {{progress}}/{{target}}. Finish it in the Tarragon Health app. Tarragon Health$o$,
       $n$Hi, your "{{challenge_title}}" challenge ends in 24 hours and you are at {{progress}}/{{target}}. Finish it in the Tarragon Health app. Tarragon Health$n$)
    ) as t(id, old_body, new_body)
  loop
    update public.notification_template_locales
       set body = r.new_body
     where id = r.id and body = r.old_body;
    get diagnostics n = row_count;
    if n = 0 and not exists (select 1 from public.notification_template_locales where id = r.id and body = r.new_body) then
      raise exception 'template % is neither the expected old text nor the new text; stopping so nobody''s edit is overwritten', r.id;
    end if;
  end loop;

  update public.lpe_goal_templates
     set description = 'Record a home blood pressure reading as your care team asks.'
   where id = '954a01df-8106-4297-a86b-4c060d9b5bfe'
     and description = 'Record a home BP reading as your care team asks.';

  if exists (
    select 1 from public.notification_template_locales
     where body ~* '—|–|\myour doctor\M'
        or subject ~* '—|–|\myour doctor\M'
  ) then
    raise exception 'a database template still carries an em dash, an en dash or "your doctor"';
  end if;
  if exists (select 1 from public.lpe_goal_templates where description ~ '\mBP\M') then
    raise exception 'lpe_goal_templates still carries "BP"';
  end if;
end $$;
