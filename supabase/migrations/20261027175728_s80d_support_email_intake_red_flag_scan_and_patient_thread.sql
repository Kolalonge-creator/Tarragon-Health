-- S80d (Module 25.4): email intake by staff, a deterministic red-flag scan on every support ticket, and one thread per patient.
--
-- WHAT THIS ADDS
--   1. public.log_email_support_ticket(): a STAFF door that records an email as a support ticket (channel 'email'). A staff member pastes the
--      sender, subject and body; nothing reads a mailbox, nothing parses an email into an action (CLAUDE.md: no automation turns an inbound
--      message on any channel into a platform action). The patient is found by the exact email on the account in the caller's organisation
--      (one match or it refuses), the same shape as log_phone_support_ticket().
--   2. A deterministic red-flag scan on the text of EVERY ticket, whichever channel (app, phone, email), and on every patient reply to a ticket.
--      It reuses the existing shared danger-phrase list private.screen_care_message_for_emergency() (the same list care messages and written
--      questions use) and the same route: a clinician_alerts row at emergency level (type_code message_safety_flag) and a page to the alert's
--      auto-assigned owner, falling back to every admin of the organisation (INV-01 deterministic, no model; INV-05 an urgent hit is paged, not
--      left in a queue). A hit never blocks, edits or closes the ticket. Each hit is written to support_ticket_red_flags (append only) so the
--      queue can show it.
--   3. public.support_patient_thread(): one chronological thread of a patient's tickets and replies across app, phone and email (SECURITY
--      INVOKER, so the existing ticket and comment row-level security decides what the caller sees).
--   4. Phone AND email intake may link a clinical-review item for a non-clinical staff member (the in-place patch of
--      private.enforce_support_ticket_write below; before this only 'phone').
--
-- Counts at write time: support_ticket_red_flags is new and nothing is converted. The scan is NOT behind a go-live guard on purpose: it only
-- adds an alert and a page for a hit, it never withholds anything from a patient.

create table public.support_ticket_red_flags (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  ticket_id        uuid not null references public.support_tickets (id) on delete cascade,
  comment_id       uuid references public.support_ticket_comments (id) on delete cascade,
  channel          public.support_ticket_channel not null,
  matched_phrases  text[] not null check (coalesce(array_length(matched_phrases, 1), 0) > 0),
  alert_id         uuid references public.clinician_alerts (id) on delete set null,
  created_at       timestamptz not null default now()
);
create unique index support_ticket_red_flags_once
  on public.support_ticket_red_flags (ticket_id, coalesce(comment_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index support_ticket_red_flags_org_idx on public.support_ticket_red_flags (organisation_id, created_at desc);
create index support_ticket_red_flags_patient_idx on public.support_ticket_red_flags (patient_id);
create index support_ticket_red_flags_alert_idx on public.support_ticket_red_flags (alert_id) where alert_id is not null;
create index support_ticket_red_flags_comment_idx on public.support_ticket_red_flags (comment_id) where comment_id is not null;
comment on table public.support_ticket_red_flags is
  'S80d: one row per ticket or ticket reply whose text matched the shared danger-phrase screen. Written only by the scan trigger. Stores the matched list phrases, never the message text.';
alter table public.support_ticket_red_flags enable row level security;
revoke all on public.support_ticket_red_flags from public, anon, authenticated;
grant select on public.support_ticket_red_flags to authenticated;
create policy support_ticket_red_flags_staff_read on public.support_ticket_red_flags
  for select to authenticated using (private.is_org_staff(organisation_id));

-- ---------------------------------------------------------------------------
-- The scan. One function, two triggers. A match raises the alert and pages; it never changes the ticket.
-- ---------------------------------------------------------------------------
create function private.scan_support_text(
  p_org uuid, p_patient uuid, p_ticket uuid, p_comment uuid, p_channel public.support_ticket_channel, p_text text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_matches text[];
  v_alert uuid;
  v_recipient uuid;
  v_notified boolean := false;
begin
  v_matches := private.screen_care_message_for_emergency(p_text);
  if v_matches is null or array_length(v_matches, 1) is null then return; end if;

  v_alert := private.raise_clinician_alert(
    p_org, p_patient, 'emergency',
    'Priority 1: potential emergency in a support ticket',
    format('A support %s%s matched the safety screen on: %s. This is an automated keyword flag, not a diagnosis. Open the ticket and read it in full. Excerpt: "%s"',
           case when p_comment is null then 'ticket' else 'ticket reply' end,
           case when p_channel = 'in_app' then '' else ' (logged from ' || p_channel::text || ')' end,
           array_to_string(v_matches, ', '), left(p_text, 500)),
    'clinical', 'message_safety_flag');

  insert into public.support_ticket_red_flags (organisation_id, patient_id, ticket_id, comment_id, channel, matched_phrases, alert_id)
  values (p_org, p_patient, p_ticket, p_comment, p_channel, v_matches, v_alert)
  on conflict do nothing;

  select p.id into v_recipient
    from public.clinician_alerts ca
    join public.clinical_staff cs on cs.id = ca.responsible_clinician_id
    join public.profiles p on p.id = cs.profile_id
   where ca.id = v_alert;
  if v_recipient is not null then
    perform private.notify_clinician_alert(v_alert, v_recipient, 'care_message_safety_flag',
      jsonb_build_object('ticket_id', p_ticket::text, 'source', 'support_ticket', 'matched_phrases', v_matches));
    v_notified := true;
  end if;
  if not v_notified then
    for v_recipient in select id from public.profiles where role = 'admin' and organisation_id = p_org loop
      perform private.notify_clinician_alert(v_alert, v_recipient, 'care_message_safety_flag',
        jsonb_build_object('ticket_id', p_ticket::text, 'source', 'support_ticket', 'matched_phrases', v_matches));
    end loop;
  end if;
end $$;
revoke all on function private.scan_support_text(uuid, uuid, uuid, uuid, public.support_ticket_channel, text) from public, anon, authenticated;

create function private.after_support_ticket_insert_scan() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- the scan must never stop a patient from reaching support: a failure is paged to operations, the ticket is still saved
  begin
    perform private.scan_support_text(new.organisation_id, new.patient_id, new.id, null, new.channel, new.subject || E'\n' || new.description);
  exception when others then
    perform private.page_incident(new.organisation_id, 'support_ticket_scan_failed:' || new.id, 'A support ticket safety scan failed',
      'The safety scan could not run for a new support ticket (see the database log). The ticket is saved. Open it and read it in full.');
  end;
  return null;
end $$;
revoke all on function private.after_support_ticket_insert_scan() from public, anon, authenticated;
create trigger support_tickets_red_flag_scan after insert on public.support_tickets
  for each row execute function private.after_support_ticket_insert_scan();

create function private.after_support_comment_insert_scan() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare t public.support_tickets%rowtype;
begin
  -- only what the patient wrote: a care-team reply or an internal note is the team's own words, not a new patient-reported signal
  if new.author_role <> 'patient' then return null; end if;
  select * into t from public.support_tickets where id = new.ticket_id;
  if not found then return null; end if;
  begin
    perform private.scan_support_text(t.organisation_id, t.patient_id, t.id, new.id, t.channel, new.body);
  exception when others then
    perform private.page_incident(t.organisation_id, 'support_reply_scan_failed:' || new.id, 'A support reply safety scan failed',
      'The safety scan could not run for a patient reply on a support ticket (see the database log). The reply is saved. Open the ticket and read it in full.');
  end;
  return null;
end $$;
revoke all on function private.after_support_comment_insert_scan() from public, anon, authenticated;
create trigger support_ticket_comments_red_flag_scan after insert on public.support_ticket_comments
  for each row execute function private.after_support_comment_insert_scan();

-- ---------------------------------------------------------------------------
-- Phone and email may link the clinical-review item (patched in place from the live definition, asserted)
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('private.enforce_support_ticket_write()'::regprocedure);
  if v_def not like '%old.channel in (''phone'', ''email'')%' then
    v_new := replace(v_def, 'old.channel = ''phone''', 'old.channel in (''phone'', ''email'')');
    if v_new = v_def then raise exception 'S80d: enforce_support_ticket_write anchor not found (definition drifted)'; end if;
    execute v_new;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Staff log an email as a ticket
-- ---------------------------------------------------------------------------
create function public.log_email_support_ticket(
  p_patient_email text, p_sender text, p_subject text, p_body text,
  p_priority public.support_ticket_priority default 'normal', p_clinical_content boolean default false
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_org     uuid;
  v_email   text := lower(btrim(coalesce(p_patient_email, '')));
  v_n       integer;
  v_patient uuid;
  v_ticket  uuid;
  v_alert   uuid;
  v_sender  text := btrim(coalesce(p_sender, ''));
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_uid;
  if v_org is null or not private.is_org_staff(v_org) then
    raise exception 'only staff can log an email' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'enter the patient''s email address as it is on their account' using errcode = '22023'; end if;
  if char_length(v_sender) < 3 or char_length(v_sender) > 200 then raise exception 'write who the email came from (3 to 200 characters)' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_subject, ''))) < 3 or char_length(btrim(coalesce(p_body, ''))) < 10 then
    raise exception 'write a subject and a body of at least 10 characters' using errcode = '22023';
  end if;
  select count(*), min(pr.id::text)::uuid into v_n, v_patient
    from public.profiles pr join auth.users u on u.id = pr.id
   where lower(u.email) = v_email and pr.organisation_id = v_org and pr.role = 'patient';
  if v_n <> 1 then raise exception 'no single patient matches that email address' using errcode = '22023'; end if;

  insert into public.support_tickets (organisation_id, patient_id, category, priority, channel, subject, description, is_clinical)
  values (v_org, v_patient, 'technical', p_priority, 'email', left(btrim(p_subject), 120),
          format('Logged by staff from an email sent by %s. Pasted text, not read from a mailbox.%s%s', v_sender, E'\n\n', btrim(p_body)),
          coalesce(p_clinical_content, false))
  returning id into v_ticket;

  if coalesce(p_clinical_content, false) then
    insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, detail, sla_due_at, category, type_code)
    values (v_org, v_patient, 'clinician_review', 'open', 'Email needs clinical review',
            format('Email logged as a support ticket ("%s"): %s', left(btrim(p_subject), 120), left(btrim(p_body), 1000)),
            now() + interval '24 hours', 'care_management', 'support_ticket_escalation')
    returning id into v_alert;
    perform set_config('tarragon.phone_intake_ticket', v_ticket::text, true);
    update public.support_tickets set escalated_alert_id = v_alert where id = v_ticket;
    perform set_config('tarragon.phone_intake_ticket', '', true);
  end if;

  perform private.log_audit('support.email_ticket_logged', 'support_tickets', v_ticket, jsonb_build_object('clinical', coalesce(p_clinical_content, false)));
  return v_ticket;
end $$;
revoke all on function public.log_email_support_ticket(text, text, text, text, public.support_ticket_priority, boolean) from public, anon;
grant execute on function public.log_email_support_ticket(text, text, text, text, public.support_ticket_priority, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- One thread per patient across channels (SECURITY INVOKER: ticket and comment RLS decide what the caller sees)
-- ---------------------------------------------------------------------------
create function public.support_patient_thread(p_patient uuid, p_limit integer default 200)
returns table (kind text, ticket_id uuid, entry_id uuid, channel public.support_ticket_channel, at timestamptz, author text, body text, is_internal boolean, red_flagged boolean)
language sql stable security invoker set search_path = ''
as $$
  select * from (
    select 'ticket'::text, t.id, t.id, t.channel, t.created_at, 'patient'::text, t.subject || E'\n' || t.description, false,
           exists (select 1 from public.support_ticket_red_flags f where f.ticket_id = t.id and f.comment_id is null)
      from public.support_tickets t where t.patient_id = p_patient
    union all
    select 'reply'::text, c.ticket_id, c.id, t.channel, c.created_at, c.author_role::text, c.body, c.is_internal,
           exists (select 1 from public.support_ticket_red_flags f where f.comment_id = c.id)
      from public.support_ticket_comments c join public.support_tickets t on t.id = c.ticket_id where t.patient_id = p_patient
  ) x(kind, ticket_id, entry_id, channel, at, author, body, is_internal, red_flagged)
  order by at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500)
$$;
revoke all on function public.support_patient_thread(uuid, integer) from public, anon;
grant execute on function public.support_patient_thread(uuid, integer) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.log_email_support_ticket(text, text, text, text, public.support_ticket_priority, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.support_patient_thread(uuid, integer)', 'EXECUTE') then
    raise exception 'S80d support functions are executable by anon';
  end if;
  if has_table_privilege('anon', 'public.support_ticket_red_flags', 'SELECT') then raise exception 'anon can read support_ticket_red_flags'; end if;
  if has_table_privilege('authenticated', 'public.support_ticket_red_flags', 'INSERT') then raise exception 'authenticated can write support_ticket_red_flags'; end if;
  if (select pg_get_functiondef('private.enforce_support_ticket_write()'::regprocedure)) not like '%old.channel in (''phone'', ''email'')%' then
    raise exception 'phone and email intake patch missing';
  end if;
end $$;
