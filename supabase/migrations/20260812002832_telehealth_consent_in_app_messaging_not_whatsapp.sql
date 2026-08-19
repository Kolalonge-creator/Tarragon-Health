-- Marketing-site audit (2026-08-12) found the telehealth consent still promises
-- two-way WhatsApp messaging with a doctor: "You may message your doctor on
-- WhatsApp for support, and they may reply there too." That was retired
-- 2026-07-30 (see CLAUDE.md's Non-Negotiable Business Rules) -- patient
-- feedback flagged an off-platform conversation as a real trust gap, so
-- two-way care-team conversation moved to care_messages/care_message_threads,
-- in the app only. WhatsApp stayed notification-only. This document is a
-- legal consent a patient actually accepts, so it should say what the
-- platform actually does, not what it did before the correction.
--
-- consent_versions is append-only: this retires the current telehealth row
-- and publishes a successor built from it, changing exactly the "How we
-- communicate with you" WhatsApp bullet. data_processing and terms_of_service
-- are untouched here (each gets its own migration), so existing acceptances
-- of those two stay valid.

do $$
declare
  v_body text;
  v_title text;
  v_old_whatsapp text;
  v_new_whatsapp text;
begin
  select body, title into v_body, v_title
    from public.consent_versions
   where consent_type = 'telehealth' and is_current;

  if v_body is null then raise exception 'no current telehealth consent to amend'; end if;

  v_old_whatsapp := '• WhatsApp is notification-only — a short message telling you a result is ready or a check-in is due, so you open the app. It never contains a specific number, result, diagnosis, or medication name, and this is enforced by our systems, not just our policy. You may message your doctor on WhatsApp for support, and they may reply there too — but this is a human reading and answering your message directly, never an automated system parsing what you send into a platform action.';

  if position(v_old_whatsapp in v_body) = 0 then
    raise exception 'the WhatsApp passage to amend was not found verbatim; re-read the live row before amending';
  end if;

  v_new_whatsapp := '• WhatsApp is notification-only, a short message telling you a result is ready or a check-in is due, so you open the app. It never contains a specific number, result, diagnosis, or medication name, and this is enforced by our systems, not just our policy. Two-way conversation with your care team happens in the app, not on WhatsApp: send a message any time and a real person on your care team reads it and replies there directly, never an automated system parsing what you send into a platform action.';

  update public.consent_versions
     set is_current = false
   where consent_type = 'telehealth' and is_current;

  insert into public.consent_versions (consent_type, version, title, body, is_current)
  values ('telehealth', '2026-08-12-v1', v_title,
          replace(v_body, v_old_whatsapp, v_new_whatsapp),
          true);
end $$;

do $$
declare v_body text;
begin
  select body into v_body from public.consent_versions
   where consent_type = 'telehealth' and is_current;

  if v_body ilike '%message your doctor on whatsapp%' then
    raise exception 'the telehealth consent still promises two-way WhatsApp messaging';
  end if;
  if v_body not ilike '%happens in the app, not on whatsapp%' then
    raise exception 'the telehealth consent does not state the in-app-only messaging channel';
  end if;
  if (select count(*) from public.consent_versions
      where consent_type = 'telehealth' and is_current) <> 1 then
    raise exception 'exactly one telehealth version must be current';
  end if;
  -- The other two consent types must be untouched, so prior acceptances hold.
  if (select count(*) from public.consent_versions
      where consent_type in ('data_processing', 'terms_of_service') and is_current) <> 2 then
    raise exception 'the other consent types were disturbed';
  end if;
end $$;
