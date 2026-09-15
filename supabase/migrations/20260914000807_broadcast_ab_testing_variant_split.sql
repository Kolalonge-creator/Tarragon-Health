-- A/B testing: two content variants with a split percentage, deterministic
-- per-recipient assignment (hash of recipient_id || broadcast_id, so a
-- given recipient always lands in the same bucket for a given broadcast),
-- per-variant open/click stats via the existing admin_broadcast_stats.
-- Deliberately NOT built here: auto-winner-promotion (auto-picking a winner
-- and sending it to the remaining audience after a waiting period) — see
-- the PR description for why that's explicitly out of scope for this pass.
alter table public.notification_broadcasts
  add column email_content_b jsonb,
  add column variant_split_pct integer not null default 50
    check (variant_split_pct between 1 and 99);

create or replace function private.execute_broadcast(p_broadcast_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_b     public.notification_broadcasts%rowtype;
  v_ch    public.notification_channel;
  v_count integer;
begin
  select * into v_b from public.notification_broadcasts where id = p_broadcast_id;
  if not found then
    raise exception 'broadcast not found';
  end if;
  if v_b.status = 'sent' then
    raise exception 'broadcast already sent';
  end if;

  foreach v_ch in array v_b.channels loop
    if v_ch = 'email' then
      if v_b.email_content_b is not null then
        insert into public.notifications
          (organisation_id, recipient_id, channel, status, template, payload)
        select
          bucketed.organisation_id, bucketed.recipient_id, 'email', 'pending', 'broadcast_announcement',
          jsonb_build_object(
            'subject', v_b.title, 'body', v_b.body, 'to_email', bucketed.email,
            'email_content',
              case when bucketed.variant_bucket < v_b.variant_split_pct then v_b.email_content else v_b.email_content_b end,
            'broadcast_id', v_b.id,
            'is_partner', bucketed.is_partner,
            'variant', case when bucketed.variant_bucket < v_b.variant_split_pct then 'a' else 'b' end
          )
        from (
          select
            t.*,
            abs(hashtextextended(t.recipient_id::text || v_b.id::text, 0)) % 100 as variant_bucket
          from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by, v_b.is_marketing) t
        ) bucketed
        where bucketed.email is not null;
      else
        insert into public.notifications
          (organisation_id, recipient_id, channel, status, template, payload)
        select t.organisation_id, t.recipient_id, 'email', 'pending', 'broadcast_announcement',
               jsonb_build_object(
                 'subject', v_b.title, 'body', v_b.body, 'to_email', t.email,
                 'email_content', v_b.email_content,
                 'broadcast_id', v_b.id,
                 'is_partner', t.is_partner
               )
        from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by, v_b.is_marketing) t
        where t.email is not null;
      end if;

    elsif v_ch = 'sms' then
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      select t.organisation_id, t.recipient_id, 'sms', 'pending', 'broadcast_announcement',
             jsonb_build_object('subject', v_b.title, 'body', v_b.body, 'to_phone', t.phone, 'broadcast_id', v_b.id)
      from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by, v_b.is_marketing) t
      where t.phone is not null;

    elsif v_ch = 'whatsapp' then
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      select t.organisation_id, t.recipient_id, 'whatsapp', 'pending', 'broadcast_announcement',
             jsonb_build_object('subject', v_b.title, 'body', v_b.body, 'broadcast_id', v_b.id)
      from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by, v_b.is_marketing) t
      where t.phone is not null and t.is_partner = false;
    end if;
  end loop;

  select count(*) into v_count
  from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by, v_b.is_marketing) t
  where t.email is not null or t.phone is not null;

  update public.notification_broadcasts
    set status = 'sent', recipient_count = v_count, sent_at = now()
  where id = p_broadcast_id;

  return v_count;
end;
$function$;

do $$
begin
  if position('email_content_b' in pg_get_functiondef('private.execute_broadcast(uuid)'::regprocedure)) = 0 then
    raise exception 'execute_broadcast did not pick up A/B variant logic';
  end if;
end $$;
