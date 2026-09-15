-- I1 follow-up: enforce, not just warn, on broadcast_announcement's free-text
-- clinical-content risk.
--
-- 20260730094515_i1_notifications_content_class.sql added a DB CHECK backstop
-- for every OTHER notifications insert path, but documented that a CHECK can't
-- inspect prose — so notification_broadcasts (admin-authored free text fanned
-- out to whatsapp/sms/email) was left as a UI-only warning caption. This closes
-- that residual gap with a real, server-side heuristic block: admin_send_broadcast
-- now rejects a message whose title/body matches personal-result/diagnosis
-- phrasing, regardless of how the RPC is called (UI, script, or direct API) —
-- not just when the UI happens to render its caption.
--
-- Explicitly a best-effort backstop, not a clinical-content classifier: it
-- targets phrasing that only makes sense addressed to one person about THEIR
-- result ("you tested positive", "your diagnosis") — not condition names on
-- their own, since this platform legitimately markets named confidential
-- screenings (HIV/Hep B/cervical) as general campaigns (see /annual-health-check).
-- Blocking condition names outright would false-positive on exactly that kind
-- of legitimate announcement. A determined admin could still phrase around this;
-- it is defence-in-depth alongside the UI warning + required attestation
-- checkbox (apps/web), not a guarantee.

create or replace function private.broadcast_content_flags(p_text text)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_patterns text[] := array[
    'you(r| have|''ve)? (been )?tested (positive|negative)',
    'you(r|''ve| have) been diagnosed',
    'diagnosed with',
    'your (test|lab|screening|biopsy) result',
    'your diagnosis',
    'abnormal result',
    'confirmed (positive|negative)',
    'your (hiv|genotype|blood group|hepatitis) (status|result) is',
    'your (blood test|lab work|screening) show(s|ed)',
    'test results? (show|indicate|confirm)',
    'your (bp|blood pressure|glucose|hba1c|cholesterol) reading (was|is|showed)'
  ];
  v_flags text[] := '{}';
  v_pattern text;
  v_haystack text := lower(coalesce(p_text, ''));
begin
  foreach v_pattern in array v_patterns loop
    if v_haystack ~ v_pattern then
      v_flags := array_append(v_flags, v_pattern);
    end if;
  end loop;
  return v_flags;
end;
$$;

revoke all on function private.broadcast_content_flags(text) from public, anon;

-- Preview: lets the composer check a draft message before ever creating a
-- notification_broadcasts row, so a flagged attempt doesn't leave an orphaned
-- draft. Admin-gated, same shape as admin_broadcast_audience_count.
create or replace function public.admin_broadcast_content_check(p_text text)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return private.broadcast_content_flags(p_text);
end;
$$;

revoke all on function public.admin_broadcast_content_check(text) from public, anon;
revoke all on function public.admin_broadcast_content_check(text) from anon;
grant execute on function public.admin_broadcast_content_check(text) to authenticated;

-- The real enforcement: admin_send_broadcast itself now refuses to enqueue a
-- flagged message, so this holds even if the UI is bypassed entirely.
create or replace function public.admin_send_broadcast(p_broadcast_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b     public.notification_broadcasts%rowtype;
  v_ch    public.notification_channel;
  v_count integer;
  v_flags text[];
begin
  if not private.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_b from public.notification_broadcasts where id = p_broadcast_id;
  if not found then
    raise exception 'broadcast not found';
  end if;
  if v_b.status = 'sent' then
    raise exception 'broadcast already sent';
  end if;

  v_flags := private.broadcast_content_flags(v_b.title || ' ' || v_b.body);
  if array_length(v_flags, 1) > 0 then
    raise exception
      'This message reads like a personal clinical result or diagnosis. Broadcasts must stay general — remove any result/diagnosis language specific to a person and try again.'
      using errcode = '23514';
  end if;

  foreach v_ch in array v_b.channels loop
    if v_ch = 'email' then
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      select t.organisation_id, t.recipient_id, 'email', 'pending', 'broadcast_announcement',
             jsonb_build_object('subject', v_b.title, 'body', v_b.body, 'to_email', t.email)
      from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by) t
      where t.email is not null;

    elsif v_ch = 'sms' then
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      select t.organisation_id, t.recipient_id, 'sms', 'pending', 'broadcast_announcement',
             jsonb_build_object('subject', v_b.title, 'body', v_b.body, 'to_phone', t.phone)
      from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by) t
      where t.phone is not null;

    elsif v_ch = 'whatsapp' then
      -- Patients only — partners have no WhatsApp channel.
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      select t.organisation_id, t.recipient_id, 'whatsapp', 'pending', 'broadcast_announcement',
             jsonb_build_object('subject', v_b.title, 'body', v_b.body)
      from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by) t
      where t.phone is not null and t.is_partner = false;
    end if;
  end loop;

  select count(*) into v_count
  from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by) t
  where t.email is not null or t.phone is not null;

  update public.notification_broadcasts
    set status = 'sent', recipient_count = v_count, sent_at = now()
  where id = p_broadcast_id;

  return v_count;
end;
$$;

revoke all on function public.admin_send_broadcast(uuid) from public, anon;
grant execute on function public.admin_send_broadcast(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.admin_broadcast_content_check(text)', 'EXECUTE') then
    raise exception 'anon must not execute admin_broadcast_content_check';
  end if;
  if has_function_privilege('anon', 'public.admin_send_broadcast(uuid)', 'EXECUTE') then
    raise exception 'anon must not execute admin_send_broadcast';
  end if;
end $$;
