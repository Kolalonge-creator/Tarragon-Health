-- Tarragon Health: a database-side rate limit for the four edge functions that bypass the web proxy (OQ-267).
--
-- order-checkout, order-verify, queue-next and queue-handback are Supabase edge functions, so the proxy limiter in apps/web never sees
-- them. Each already runs the database call as the signed-in caller, so the limit is counted per signed-in user in the database:
-- no new service, nothing to configure. A fixed one-minute window per (bucket, user). The function is called by the edge function
-- with the caller's own JWT BEFORE any work is done; the edge function fails open if this call itself errors (a limiter outage must
-- never block a payment or a clinician).
--
-- The limits live here, in one list, not in the callers: a caller cannot pick its own limit or bucket name.
--   order-checkout 20/min   (a person starting a payment; the existing too_many_open_orders guard still applies)
--   order-verify   60/min   (the return page polls "is it paid?")
--   queue-next     60/min   (a clinician claiming work)
--   queue-handback 60/min
-- Nothing here touches a patient-safety path: the red-event page, vitals, symptom and emergency routes are not behind these functions.

create table if not exists private.edge_rate_limits (
  bucket text not null,
  subject uuid not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, subject, window_start)
);
alter table private.edge_rate_limits enable row level security;
revoke all on private.edge_rate_limits from public, anon, authenticated;

create or replace function public.edge_rate_limit_hit(p_bucket text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_user uuid := auth.uid();
  v_limit integer;
  v_window timestamptz := date_bin(interval '1 minute', now(), timestamptz 'epoch');
  v_hits integer;
begin
  if v_user is null then
    return jsonb_build_object('allowed', false, 'error', 'unauthorised');
  end if;
  v_limit := case p_bucket
    when 'order-checkout' then 20
    when 'order-verify' then 60
    when 'queue-next' then 60
    when 'queue-handback' then 60
    else null end;
  if v_limit is null then
    return jsonb_build_object('allowed', false, 'error', 'unknown_bucket');
  end if;

  insert into private.edge_rate_limits as t (bucket, subject, window_start, hits)
  values (p_bucket, v_user, v_window, 1)
  on conflict (bucket, subject, window_start) do update set hits = t.hits + 1
  returning t.hits into v_hits;

  -- keep the table small: now and then, drop windows older than an hour
  if random() < 0.02 then
    delete from private.edge_rate_limits where window_start < now() - interval '1 hour';
  end if;

  if v_hits > v_limit then
    return jsonb_build_object('allowed', false, 'limit', v_limit,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_window + interval '1 minute' - now())))::integer));
  end if;
  return jsonb_build_object('allowed', true, 'limit', v_limit, 'remaining', v_limit - v_hits);
end
$$;
revoke all on function public.edge_rate_limit_hit(text) from public, anon;
grant execute on function public.edge_rate_limit_hit(text) to authenticated;

comment on function public.edge_rate_limit_hit(text) is
  'OQ-267: per-signed-in-user fixed-window limit for the edge functions that bypass the web proxy. Called by the edge function with the caller''s JWT; limits are fixed here.';

do $$
begin
  if has_function_privilege('anon', 'public.edge_rate_limit_hit(text)', 'EXECUTE') then
    raise exception 'edge_rate_limit_hit must not be executable by anon';
  end if;
  if has_table_privilege('authenticated', 'private.edge_rate_limits', 'SELECT') then
    raise exception 'edge_rate_limits must not be readable by signed-in users';
  end if;
end $$;
