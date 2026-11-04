-- Care Circle Phase 5 (docs/plans/care-circle-expansion-audit-and-plan-2026-11-04.md, Phase 5; spec sections 12.2 and 21).
--
--   1. public.my_gifts_paid(): what a person who paid for someone else's care sees about those payments (spec 12.2): the person's first
--      name, what was bought, when it was paid, the W-19 state word (waiting / accepted / declined / not_answered / not_accepted), when
--      the Membership runs from and to (only once accepted), and any refund state. Billing facts only: never a reading, a result, an
--      appointment or anything clinical, and paying grants no access (unchanged). Only the payer's own paid gift orders.
--   2. public.admin_care_circle_metrics(): Care Circle adoption, engagement, coordination, commercial and safety counts for the admin console
--      (spec 21). Counts only, never a name or a clinical value; test accounts excluded; admin only (private.is_admin()).
-- Live rows when written: 0 Care Circle members, 0 paid gift orders. No existing function is redefined.

create function public.my_gifts_paid()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'order_id', o.id,
           'name', coalesce(nullif(split_part(btrim(coalesce(bp.full_name, '')), ' ', 1), ''), 'Someone'),
           'name_key', i.name_key,
           'paid_at', o.paid_at,
           'state', case e.acceptance
                      when 'pending' then 'waiting'
                      when 'accepted' then 'accepted'
                      when 'declined' then case when e.decided_by_sweep then 'not_answered' else 'declined' end
                      else 'not_accepted' end,
           'starts_at', case when e.acceptance = 'accepted' then e.starts_at end,
           'ends_at', case when e.acceptance = 'accepted' then e.ends_at end,
           'refund_state', (select rf.state from public.refunds rf where rf.order_id = o.id order by rf.created_at desc limit 1))
         order by o.paid_at desc nulls last), '[]'::jsonb)
    from public.orders o
    join public.catalog_items i on i.id = o.catalog_item_id
    join public.profiles bp on bp.id = o.beneficiary_patient_id
    left join lateral (select en.* from public.entitlements en where en.order_id = o.id and en.acceptance <> 'not_needed'
                        order by case en.acceptance when 'accepted' then 0 when 'pending' then 1 else 2 end, en.created_at desc, en.id limit 1) e on true
   where o.buyer_profile_id = (select auth.uid())
     and o.beneficiary_patient_id is not null and o.beneficiary_patient_id <> o.buyer_profile_id
     and o.state = 'paid'
$$;
comment on function public.my_gifts_paid() is
  'Care Circle P5 (spec 12.2): the payer''s own paid gifts for someone else: first name, item, paid date, W-19 state word, Membership dates once '
  'accepted, refund state. Billing facts only; paying grants no access to health information.';
revoke all on function public.my_gifts_paid() from public;
grant execute on function public.my_gifts_paid() to authenticated;

create function public.admin_care_circle_metrics()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare out jsonb;
begin
  if not private.is_admin() then raise exception 'not_authorised' using errcode = '42501'; end if;
  with m as (select * from public.care_circle_members where not is_test),
       active as (select * from m where state = 'active' and expires_at > now()),
       inv as (select * from public.care_circle_invites where not is_test),
       gifts as (select o.*, e.acceptance, e.decided_by_sweep
                   from public.orders o
                   left join lateral (select en.acceptance, en.decided_by_sweep from public.entitlements en
                                       where en.order_id = o.id and en.acceptance <> 'not_needed' order by en.created_at desc limit 1) e on true
                  where not o.is_test and o.state = 'paid' and o.beneficiary_patient_id is not null and o.beneficiary_patient_id <> o.buyer_profile_id),
       tasks as (select * from public.care_circle_tasks where not is_test),
       looks as (select distinct e.actor_profile_id from public.care_access_events e
                  join active a on a.supporter_id = e.actor_profile_id and a.patient_id = e.patient_id
                 where e.scope = 'care_circle' and e.kind = 'record_viewed' and e.occurred_at > now() - interval '30 days')
  select jsonb_build_object(
    'adoption', jsonb_build_object(
      'patients_with_circle', (select count(distinct patient_id) from active),
      'active_supporters', (select count(distinct supporter_id) from active),
      'invites_sent', (select count(*) from inv),
      'invites_accepted', (select count(*) from inv where state = 'accepted'),
      'patients_with_two_or_more', (select count(*) from (select patient_id from active group by patient_id having count(*) >= 2) x),
      'supporters_of_two_or_more', (select count(*) from (select supporter_id from active group by supporter_id having count(*) >= 2) x)),
    'engagement', jsonb_build_object(
      'supporters_who_looked_30d', (select count(*) from looks),
      'doctor_notes_released_30d', (select count(*) from public.family_doctor_notes where not is_test and released_at > now() - interval '30 days'),
      'help_requests_30d', (select count(*) from tasks where created_at > now() - interval '30 days'),
      'help_requests_done_30d', (select count(*) from tasks where state = 'done' and done_at > now() - interval '30 days')),
    'commercial', jsonb_build_object(
      'gifts_paid', (select count(*) from gifts),
      'gifts_accepted', (select count(*) from gifts where acceptance = 'accepted'),
      'gifts_waiting', (select count(*) from gifts where acceptance = 'pending'),
      'gifts_declined', (select count(*) from gifts where acceptance = 'declined' and not coalesce(decided_by_sweep, false)),
      'gifts_not_answered', (select count(*) from gifts where acceptance = 'declined' and coalesce(decided_by_sweep, false)),
      'gift_revenue_kobo', (select coalesce(sum(total_kobo), 0) from gifts where acceptance = 'accepted')),
    'safety', jsonb_build_object(
      'removed_30d', (select count(*) from m where state = 'revoked' and revoked_at > now() - interval '30 days'),
      'paused_now', (select count(*) from public.care_circle_pauses p join public.profiles pr on pr.id = p.patient_id and not pr.is_test
                      where p.paused_until > now()),
      'help_alerts_30d', (select count(*) from public.care_circle_help_alerts where not is_test and created_at > now() - interval '30 days'))
  ) into out;
  return out;
end $$;
comment on function public.admin_care_circle_metrics() is
  'Care Circle P5 (spec 21): counts for the admin console. Never a name or a clinical value; test accounts excluded; admin only.';
revoke all on function public.admin_care_circle_metrics() from public;
grant execute on function public.admin_care_circle_metrics() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.my_gifts_paid()', 'EXECUTE') or has_function_privilege('anon', 'public.admin_care_circle_metrics()', 'EXECUTE') then
    raise exception 'P5 self-check: anon can execute a Phase 5 function';
  end if;
end $$;
