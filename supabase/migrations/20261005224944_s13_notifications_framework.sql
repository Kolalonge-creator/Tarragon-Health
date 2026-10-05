-- S13: notifications framework with the INV-07 lint (spec 4.9, Section 10).
--
-- Extends the live notification system (notifications, notification_templates and
-- notification_template_locales, patient_notification_preferences, push_subscriptions,
-- profiles.discreet_mode from S02); nothing is rebuilt.
--
-- What this adds:
--   1. notification_forbidden_terms: the INV-07 term list as data, and
--      private.notification_text_violations(text) which applies it. A trigger on
--      notification_template_locales refuses an ACTIVE row that names a condition, reading, result,
--      medicine, a clinical number or unit, or reads a clinical placeholder (OQ-06: generic copy
--      everywhere). The code copy is supabase/functions/_shared/notifications/neutral.ts; a Jest test
--      fails if the two lists differ.
--   2. The 39 live active locale rows that broke the rule are rewritten below, and SMS rows for
--      patient-facing templates are deactivated (OQ-05, INV-08: SMS is verification codes and
--      clinician paging only). Counts at writing: 39 rows named clinical content; 76 sms rows had
--      failed and none were sent, so no patient message is lost.
--   3. notification_rules_config (versioned, PROPOSED values) and notification_settings (quiet hours),
--      written only through set_my_notification_settings(), which also writes profiles.discreet_mode.
--   4. notification_delivery_events (append only) and notification_email_suppressions, written by
--      the sender, the Expo receipt checker and the Resend webhook through service-role RPCs.
-- Row counts at writing: notification_settings, notification_delivery_events and
-- notification_email_suppressions are new (no conversion). Quiet hours default ON (21:00 to 07:00
-- Africa/Lagos) for everyone without a row; critical rows and the in-app inbox are never deferred.

create table public.notification_forbidden_terms (
  term       text not null,
  kind       text not null check (kind in ('term', 'param')),
  is_active  boolean not null default true,
  version    integer not null default 1,
  created_at timestamptz not null default now(),
  primary key (term, kind)
);
comment on table public.notification_forbidden_terms is
  'INV-07 lint list. kind term: a word (a trailing * is any ending) that may not appear in notification text. kind param: a placeholder name a template may not read. Code copy: supabase/functions/_shared/notifications/neutral.ts.';
alter table public.notification_forbidden_terms enable row level security;
create policy notification_forbidden_terms_admin_read on public.notification_forbidden_terms
  for select to authenticated using (private.is_admin());
grant select on public.notification_forbidden_terms to authenticated;

insert into public.notification_forbidden_terms (term, kind) values
  ('diabet*', 'term'),
  ('hypertens*', 'term'),
  ('blood pressure', 'term'),
  ('bp', 'term'),
  ('sugar', 'term'),
  ('glucose', 'term'),
  ('glucometer', 'term'),
  ('cholesterol', 'term'),
  ('lipid*', 'term'),
  ('hba1c', 'term'),
  ('a1c', 'term'),
  ('asthma*', 'term'),
  ('ckd', 'term'),
  ('kidney*', 'term'),
  ('heart*', 'term'),
  ('cardiac', 'term'),
  ('cardio*', 'term'),
  ('stroke', 'term'),
  ('cancer*', 'term'),
  ('tumour*', 'term'),
  ('tumor*', 'term'),
  ('hiv', 'term'),
  ('hepatitis', 'term'),
  ('sti', 'term'),
  ('std', 'term'),
  ('pregnan*', 'term'),
  ('fertility', 'term'),
  ('menstrual', 'term'),
  ('contracept*', 'term'),
  ('antenatal', 'term'),
  ('postnatal', 'term'),
  ('malaria', 'term'),
  ('tuberculosis', 'term'),
  ('sickle*', 'term'),
  ('epilep*', 'term'),
  ('depress*', 'term'),
  ('anxiety', 'term'),
  ('mental', 'term'),
  ('obes*', 'term'),
  ('overweight', 'term'),
  ('pressure', 'term'),
  ('reading*', 'term'),
  ('result*', 'term'),
  ('lab', 'term'),
  ('labs', 'term'),
  ('laboratory', 'term'),
  ('scan', 'term'),
  ('scans', 'term'),
  ('x-ray', 'term'),
  ('ecg', 'term'),
  ('biopsy', 'term'),
  ('screening*', 'term'),
  ('positive', 'term'),
  ('negative', 'term'),
  ('abnormal', 'term'),
  ('elevated', 'term'),
  ('diagnos*', 'term'),
  ('symptom*', 'term'),
  ('treatment*', 'term'),
  ('medicine*', 'term'),
  ('medication*', 'term'),
  ('drug*', 'term'),
  ('tablet*', 'term'),
  ('pill*', 'term'),
  ('dose*', 'term'),
  ('dosage*', 'term'),
  ('prescri*', 'term'),
  ('refill*', 'term'),
  ('insulin', 'term'),
  ('metformin', 'term'),
  ('amlodipine', 'term'),
  ('lisinopril', 'term'),
  ('losartan', 'term'),
  ('statin*', 'term'),
  ('antibiotic*', 'term'),
  ('vaccin*', 'term'),
  ('inhaler*', 'term'),
  ('drug_name', 'param'),
  ('drug', 'param'),
  ('medicine', 'param'),
  ('medication', 'param'),
  ('medication_name', 'param'),
  ('condition', 'param'),
  ('condition_label', 'param'),
  ('diagnosis', 'param'),
  ('reading', 'param'),
  ('value', 'param'),
  ('systolic', 'param'),
  ('diastolic', 'param'),
  ('glucose', 'param'),
  ('test_name', 'param'),
  ('result', 'param'),
  ('result_text', 'param'),
  ('vaccine_name', 'param'),
  ('screening_name', 'param'),
  ('symptom', 'param'),
  ('details', 'param');

create function private.notification_text_violations(p_text text) returns text[]
language plpgsql stable set search_path = pg_catalog, public as $fn$
declare
  v_out text[] := '{}';
  v_bare text;
  v_key text;
  v_term record;
begin
  if p_text is null then return v_out; end if;
  for v_key in select m[1] from regexp_matches(p_text, '\{\{\s*(\w+)\s*\}\}', 'g') as m loop
    if exists (select 1 from public.notification_forbidden_terms t where t.kind = 'param' and t.is_active and t.term = v_key) then
      v_out := v_out || ('param:' || v_key);
    end if;
  end loop;
  v_bare := regexp_replace(p_text, '\{\{\s*\w+\s*\}\}', ' ', 'g');
  for v_term in select t.term from public.notification_forbidden_terms t where t.kind = 'term' and t.is_active loop
    if v_bare ~* ('(^|[^a-z0-9])'
        || regexp_replace(regexp_replace(rtrim(v_term.term, '*'), '([.+?^${}()|\[\]\\])', '\\\1', 'g'), ' ', '\s+', 'g')
        || case when v_term.term like '%*' then '[a-z]*' else '' end
        || '($|[^a-z0-9])') then
      v_out := v_out || ('term:' || v_term.term);
    end if;
  end loop;
  if v_bare ~* '\m\d{2,3}\s*/\s*\d{2,3}\M' then v_out := array_append(v_out, 'number:pair'::text); end if;
  if v_bare ~* '\m\d+([.,]\d+)?\s*(mmhg|mg/dl|mmol/l|mmol|mg|mcg|ml|bpm|kg)\M' then v_out := array_append(v_out, 'number:unit'::text); end if;
  return v_out;
end $fn$;

revoke all on function private.notification_text_violations(text) from public;
grant execute on function private.notification_text_violations(text) to authenticated, service_role;

create function private.enforce_notification_locale_neutral() returns trigger
language plpgsql set search_path = pg_catalog, public as $fn$
declare v text[];
begin
  if not new.is_active then return new; end if;
  v := private.notification_text_violations(coalesce(new.subject, '') || ' ' || new.body);
  if cardinality(v) > 0 then
    raise exception 'INV-07: template % (%) names clinical content: %', new.template_key, new.channel, array_to_string(v, ', ')
      using errcode = 'check_violation';
  end if;
  return new;
end $fn$;

-- ---------------------------------------------------------------------------
-- Rewrite the live rows that break the rule, deactivate patient SMS, then switch the trigger on.
-- ---------------------------------------------------------------------------
update public.notification_template_locales l
   set is_active = false
  from public.notification_templates t
 where t.key = l.template_key and l.channel = 'sms' and l.is_active and t.audience <> 'clinician';

with fix(template_key, channel, subject, body) as (values
  ('abnormal_result_clinician_alert', 'sms', null, 'New priority case. Open your Tarragon Health worklist. Tarragon Health'),
  ('health_passport_verified', 'in_app', null, 'Your document is verified'),
  ('lab_order_lab_alert', 'email', 'New Tarragon Health order {{order_number}}', 'A patient has a confirmed order to be received. The details are in the partner portal. Order {{order_number}}.'),
  ('lab_order_patient_confirmation', 'email', 'Your Tarragon Health order {{order_number}} is confirmed', 'Your order is confirmed. Show order {{order_number}} and your patient ID when you arrive.'),
  ('lab_order_patient_confirmation', 'in_app', null, 'Your order is confirmed'),
  ('lab_order_requested_patient', 'email', 'Your care team made a request for you', 'Your care team made a request for you. A printable PDF is attached. Order {{order_number}}.'),
  ('lab_order_requested_patient', 'in_app', null, 'Your care team made a request for you'),
  ('medication_adherence_checkin', 'in_app', null, 'A quick check-in is waiting for you'),
  ('medication_prescribed_patient', 'email', 'Your care team added something new for you', 'Your care team added something new for you. Open the Tarragon Health app to see it.'),
  ('medication_prescribed_patient', 'in_app', null, 'Your care team added something new for you'),
  ('medication_refill_reminder', 'in_app', null, 'A reminder is coming up. Open the app to see when.'),
  ('medication_review_due', 'in_app', null, 'A review with your care team is due'),
  ('prescription_updated_patient', 'email', 'Your care team updated a document for you', 'Your care team updated a document for you. Open the Tarragon Health app to get the new one. Any copy you saved earlier no longer works.'),
  ('prescription_updated_patient', 'push', null, 'A document was updated. Open the app to get the new one.'),
  ('result_document_available', 'in_app', null, 'Something new is waiting in your record'),
  ('result_interpretation_ready', 'in_app', null, 'Your care team sent you a note about something you uploaded'),
  ('second_condition_needs_upgrade', 'in_app', null, 'Your care team has an update about your plan. Open the app to see it'),
  ('sponsor_person_quiet', 'email', '{{person_name}} has been quiet for {{quiet_days}} days', '{{person_name}} has not opened the app in {{quiet_days}} days. A call from you often does more than a reminder from us.'),
  ('sponsor_person_quiet', 'in_app', null, '{{person_name}} hasn''t opened the app in {{quiet_days}} days; a call might help'),
  ('vaccination_due', 'in_app', null, 'A reminder is due'),
  ('vaccination_escalated', 'in_app', null, 'A reminder is still waiting: your care team may follow up'),
  ('vaccination_overdue', 'in_app', null, 'A reminder is still waiting'),
  ('vaccination_upcoming', 'in_app', null, 'A reminder is coming up soon'),
  ('vaccination_verified', 'email', 'Your care team has reviewed a document you uploaded', 'Your care team has reviewed a document you uploaded. Open the Tarragon Health app to see it.')
)
update public.notification_template_locales l
   set subject = fix.subject, body = fix.body
  from fix
 where l.template_key = fix.template_key and l.channel::text = fix.channel and l.is_active;

create trigger notification_template_locales_neutral
  before insert or update of subject, body, is_active on public.notification_template_locales
  for each row execute function private.enforce_notification_locale_neutral();

-- ---------------------------------------------------------------------------
-- Versioned rules (PROPOSED) and quiet hours
-- ---------------------------------------------------------------------------
create table public.notification_rules_config (
  id         uuid primary key default gen_random_uuid(),
  version    integer not null unique,
  is_active  boolean not null default false,
  config     jsonb not null check (jsonb_typeof(config) = 'object'),
  note       text,
  created_at timestamptz not null default now()
);
create unique index notification_rules_config_one_active on public.notification_rules_config ((true)) where is_active;
comment on table public.notification_rules_config is
  'PROPOSED notification rules (quietHours start/end, routinePushPerDay, receiptCheckMinutes, receiptGiveUpHours). Mirrored in packages/shared proposed-config as notifications.rules. A change is a new row (INV-16).';
alter table public.notification_rules_config enable row level security;
create policy notification_rules_config_admin_read on public.notification_rules_config
  for select to authenticated using (private.is_admin());
grant select on public.notification_rules_config to authenticated;
insert into public.notification_rules_config (version, is_active, config, note) values
  (1, true, '{"quietHours":{"enabled":true,"start":"21:00","end":"07:00"},"routinePushPerDay":4,"receiptCheckMinutes":15,"receiptGiveUpHours":24}'::jsonb,
   'S13 PROPOSED: quiet hours 21:00 to 07:00 Africa/Lagos, 4 routine pushes a day, Expo receipt check after 15 minutes.');

create table public.notification_settings (
  profile_id      uuid primary key references public.profiles(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id),
  quiet_enabled   boolean not null default true,
  quiet_start     time not null default '21:00',
  quiet_end       time not null default '07:00',
  updated_at      timestamptz not null default now(),
  check (quiet_start <> quiet_end)
);
alter table public.notification_settings enable row level security;
create policy notification_settings_own_read on public.notification_settings
  for select to authenticated using (profile_id = (select auth.uid()));
grant select on public.notification_settings to authenticated;

create function public.set_my_notification_settings(p_quiet_enabled boolean, p_quiet_start time, p_quiet_end time, p_discreet boolean)
returns void language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare v_uid uuid := auth.uid(); v_org uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_quiet_start is null or p_quiet_end is null or p_quiet_start = p_quiet_end then
    raise exception 'quiet hours need two different times' using errcode = '22023';
  end if;
  select organisation_id into v_org from public.profiles where id = v_uid;
  if v_org is null then raise exception 'no profile' using errcode = '42501'; end if;
  insert into public.notification_settings (profile_id, organisation_id, quiet_enabled, quiet_start, quiet_end)
  values (v_uid, v_org, coalesce(p_quiet_enabled, true), p_quiet_start, p_quiet_end)
  on conflict (profile_id) do update
    set quiet_enabled = excluded.quiet_enabled, quiet_start = excluded.quiet_start,
        quiet_end = excluded.quiet_end, updated_at = now();
  if p_discreet is not null then
    update public.profiles set discreet_mode = p_discreet where id = v_uid;
  end if;
end $fn$;
revoke all on function public.set_my_notification_settings(boolean, time, time, boolean) from public, anon;
grant execute on function public.set_my_notification_settings(boolean, time, time, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Delivery tracking
-- ---------------------------------------------------------------------------
create table public.notification_delivery_events (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id),
  event           text not null check (event in ('accepted','receipt_pending','delivered','opened','failed','bounced','complained','deferred_quiet','suppressed_cap','blocked_inv07','token_dead')),
  provider        text check (provider in ('expo','webpush','resend','termii','system')),
  provider_ref    text,
  detail          jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 2048),
  occurred_at     timestamptz not null default now()
);
create index notification_delivery_events_notification_idx on public.notification_delivery_events (notification_id, occurred_at);
create index notification_delivery_events_ref_idx on public.notification_delivery_events (provider_ref) where provider_ref is not null;
create index notification_delivery_events_pending_idx on public.notification_delivery_events (occurred_at) where event = 'receipt_pending';
comment on table public.notification_delivery_events is
  'Append only. One row per step a notification went through. detail holds ids and reason codes only, never message content. accepted and delivered mean the provider accepted or the device reported it; neither proves the person saw it.';
alter table public.notification_delivery_events enable row level security;
create policy notification_delivery_events_admin_read on public.notification_delivery_events
  for select to authenticated using (private.is_admin());
grant select on public.notification_delivery_events to authenticated;

create function private.notification_delivery_events_append_only() returns trigger
language plpgsql set search_path = pg_catalog as $fn$
begin
  raise exception 'notification_delivery_events is append only' using errcode = '42501';
end $fn$;
create trigger notification_delivery_events_no_change
  before update or delete on public.notification_delivery_events
  for each row execute function private.notification_delivery_events_append_only();

create table public.notification_email_suppressions (
  email      text primary key check (email = lower(email)),
  reason     text not null check (reason in ('bounced','complained')),
  created_at timestamptz not null default now()
);
alter table public.notification_email_suppressions enable row level security;
create policy notification_email_suppressions_admin_read on public.notification_email_suppressions
  for select to authenticated using (private.is_admin());
grant select on public.notification_email_suppressions to authenticated;

create function public.record_notification_delivery_event(
  p_notification_id uuid, p_event text, p_provider text default null, p_provider_ref text default null,
  p_detail jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare v_org uuid; v_id uuid; v_sub uuid; v_email text;
begin
  select organisation_id into v_org from public.notifications where id = p_notification_id;
  if v_org is null then raise exception 'unknown notification' using errcode = '22023'; end if;
  insert into public.notification_delivery_events (notification_id, organisation_id, event, provider, provider_ref, detail)
  values (p_notification_id, v_org, p_event, p_provider, p_provider_ref, coalesce(p_detail, '{}'::jsonb))
  returning id into v_id;
  if p_event = 'delivered' then
    update public.notifications set delivered_at = coalesce(delivered_at, now()) where id = p_notification_id;
  elsif p_event = 'opened' then
    update public.notifications set opened_at = coalesce(opened_at, now()) where id = p_notification_id;
  elsif p_event = 'token_dead' then
    begin v_sub := (p_detail ->> 'subscription_id')::uuid; exception when others then v_sub := null; end;
    if v_sub is not null then
      update public.push_subscriptions set disabled_at = coalesce(disabled_at, now()) where id = v_sub;
    end if;
  elsif p_event in ('bounced', 'complained') then
    v_email := lower(nullif(p_detail ->> 'email', ''));
    if v_email is not null then
      insert into public.notification_email_suppressions (email, reason) values (v_email, p_event)
      on conflict (email) do nothing;
    end if;
  end if;
  return v_id;
end $fn$;

-- Receipts still owed: an Expo ticket older than p_min_age_minutes with no later outcome for the same ticket.
create function public.claim_expo_receipt_checks(p_limit integer default 100, p_min_age_minutes integer default 15)
returns table (event_id uuid, notification_id uuid, provider_ref text, subscription_id uuid)
language sql stable security definer set search_path = pg_catalog, public as $fn$
  select e.id, e.notification_id, e.provider_ref, nullif(e.detail ->> 'subscription_id', '')::uuid
    from public.notification_delivery_events e
   where e.event = 'receipt_pending'
     and e.occurred_at <= now() - make_interval(mins => greatest(p_min_age_minutes, 1))
     and e.occurred_at >= now() - interval '48 hours'
     and not exists (
       select 1 from public.notification_delivery_events r
        where r.provider_ref = e.provider_ref and r.id <> e.id and r.event in ('delivered', 'failed', 'token_dead'))
   order by e.occurred_at
   limit least(greatest(p_limit, 1), 500)
$fn$;

revoke all on function public.record_notification_delivery_event(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_notification_delivery_event(uuid, text, text, text, jsonb) to service_role;
revoke all on function public.claim_expo_receipt_checks(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_expo_receipt_checks(integer, integer) to service_role;

-- Expo receipts are checked every 10 minutes. Needs the Vault secret notification_jobs_secret and the edge
-- secret NOTIFICATION_JOBS_SECRET (same value); without them the function answers 401 and nothing is checked.
select cron.schedule(
  'expo-push-receipts',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/expo-push-receipts',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
      'x-notification-jobs-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notification_jobs_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 20000
  ) as request_id;
  $$
);

-- ---------------------------------------------------------------------------
-- Proof the migration did its job
-- ---------------------------------------------------------------------------
do $do$
declare v_bad integer; v_sms integer; v_terms integer;
begin
  select count(*) into v_bad from public.notification_template_locales l
   where l.is_active and cardinality(private.notification_text_violations(coalesce(l.subject, '') || ' ' || l.body)) > 0;
  if v_bad <> 0 then raise exception 'S13: % active locale rows still name clinical content', v_bad; end if;
  select count(*) into v_sms from public.notification_template_locales l join public.notification_templates t on t.key = l.template_key
   where l.is_active and l.channel = 'sms' and t.audience <> 'clinician';
  if v_sms <> 0 then raise exception 'S13: % patient sms rows are still active', v_sms; end if;
  select count(*) into v_terms from public.notification_forbidden_terms;
  if v_terms < 90 then raise exception 'S13: term list not seeded (%)', v_terms; end if;
  if has_function_privilege('anon', 'public.set_my_notification_settings(boolean,time,time,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_notification_delivery_event(uuid,text,text,text,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_notification_delivery_event(uuid,text,text,text,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.claim_expo_receipt_checks(integer,integer)', 'EXECUTE') then
    raise exception 'S13: a function is executable by a role that must not run it';
  end if;
end $do$;
