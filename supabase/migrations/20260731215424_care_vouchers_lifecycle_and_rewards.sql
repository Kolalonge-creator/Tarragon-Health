-- Care Vouchers, part 5: expiry, extension, cancellation, and reward issuance.
--
-- FORFEITURE POSTURE, deliberate and flagged rather than assumed:
-- only ACTIVE (fully paid, unredeemed) vouchers are swept at expiry. A
-- RESERVED voucher — one somebody is part way through paying for — is never
-- expired automatically. Silently forfeiting a half-finished layaway is
-- exactly the behaviour the FCCPC would take an interest in, and money already
-- taken toward a named service should not evaporate because the saving took
-- longer than expected. Those sit open until the patient finishes, asks for a
-- refund, or staff cancel with a reason. Founder should confirm whether a
-- long-abandoned reserved voucher ever gets closed out, and on what terms.
--
-- A patient is warned 30 days before an active voucher expires, in-app and by
-- email. Not WhatsApp/SMS: this is an account matter, not a care reminder.

create or replace function private.issue_reward_voucher(
  p_beneficiary uuid,
  p_value_kobo bigint,
  p_label text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_months integer;
  v_id uuid;
begin
  if p_value_kobo is null or p_value_kobo <= 0 then return null; end if;
  select organisation_id into v_org from public.profiles where id = p_beneficiary;
  if v_org is null then return null; end if;
  select validity_months into v_months from public.care_voucher_config where id = true;

  insert into public.care_vouchers (
    organisation_id, voucher_number, kind, beneficiary_profile_id,
    sku_name, face_value_kobo, amount_paid_kobo, status, activated_at, expires_at
  ) values (
    v_org, private.next_voucher_number(), 'reward_discount', p_beneficiary,
    p_label, p_value_kobo, 0, 'active', now(), now() + make_interval(months => v_months)
  )
  returning id into v_id;

  insert into public.care_voucher_events
    (organisation_id, voucher_id, event_type, amount_kobo, note)
  values (v_org, v_id, 'created', p_value_kobo, coalesce(p_note, 'Reward issued'));

  insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
  values (v_org, p_beneficiary, 'in_app', 'reward_voucher_issued',
          jsonb_build_object('voucher_id', v_id, 'label', p_label,
                             'value_naira', (p_value_kobo / 100)::text));

  return v_id;
exception when others then
  -- A reward must never block the clinical or payment write path it hangs off.
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Expiry sweep + advance warning.
-- ---------------------------------------------------------------------------

create or replace function private.run_care_voucher_expiry()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  -- Warn 30 days out, once per voucher (deduped on the notification itself).
  for v_row in
    select v.* from public.care_vouchers v
    where v.status = 'active'
      and v.expires_at is not null
      and v.expires_at between now() and now() + interval '30 days'
      and not exists (
        select 1 from public.notifications n
        where n.template = 'care_voucher_expiring'
          and n.source_table = 'care_vouchers' and n.source_id = v.id
      )
  loop
    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload, source_table, source_id)
    select v_row.organisation_id, v_row.beneficiary_profile_id, ch, 'care_voucher_expiring',
           jsonb_build_object(
             'voucher_id', v_row.id,
             'voucher_number', v_row.voucher_number,
             'label', coalesce(v_row.sku_name, 'Care voucher'),
             'expires_on', to_char(v_row.expires_at, 'DD Mon YYYY')),
           'care_vouchers', v_row.id
      from unnest(array['in_app', 'email']::public.notification_channel[]) as ch;
  end loop;

  -- Expire only fully-paid, unredeemed vouchers. See the header note.
  for v_row in
    select * from public.care_vouchers
    where status = 'active' and expires_at is not null and expires_at <= now()
  loop
    update public.care_vouchers set status = 'expired' where id = v_row.id;
    insert into public.care_voucher_events
      (organisation_id, voucher_id, event_type, amount_kobo, note)
    values (v_row.organisation_id, v_row.id, 'expired', v_row.face_value_kobo,
            'Expired unused. Contact support if you would like it looked at.');
  end loop;
end;
$$;

select cron.schedule('care-voucher-expiry-daily', '20 3 * * *',
  $$select private.run_care_voucher_expiry();$$);

-- ---------------------------------------------------------------------------
-- Extension: "extendable on request", as a real staff action with an audit
-- trail. Works on an expired voucher too, which is the whole point — the
-- common case is somebody asking after the fact.
-- ---------------------------------------------------------------------------

create or replace function public.extend_care_voucher(p_voucher uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_v public.care_vouchers%rowtype;
  v_cfg public.care_voucher_config%rowtype;
  v_from timestamptz;
  v_new timestamptz;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if not (private.is_admin() or private.has_permission('vouchers.manage')) then
    raise exception 'not authorised to extend a voucher' using errcode = '42501';
  end if;

  select * into v_v from public.care_vouchers where id = p_voucher for update;
  if not found then raise exception 'voucher not found'; end if;
  if v_v.status not in ('active', 'expired') then
    raise exception 'only an unused voucher can be extended';
  end if;

  select * into v_cfg from public.care_voucher_config where id = true;
  if v_v.extension_count >= v_cfg.max_extensions then
    raise exception 'this voucher has already been extended the maximum number of times';
  end if;

  v_from := greatest(coalesce(v_v.expires_at, now()), now());
  v_new := v_from + make_interval(months => v_cfg.extension_months);

  update public.care_vouchers
     set expires_at = v_new,
         status = 'active',
         extension_count = extension_count + 1
   where id = p_voucher;

  insert into public.care_voucher_events
    (organisation_id, voucher_id, event_type, actor_profile_id, note)
  values (v_v.organisation_id, p_voucher, 'extended', v_caller,
          coalesce(nullif(trim(p_reason), ''), 'Extended on request'));

  perform private.log_audit('care_vouchers.extended', 'care_vouchers', p_voucher,
    jsonb_build_object('new_expires_at', v_new, 'reason', p_reason));

  return jsonb_build_object('ok', true, 'expires_at', v_new);
end;
$$;

-- Cancellation deliberately moves NO money. Any refund is a provider refund
-- against the original charge, so it returns to the card that paid it — a
-- voucher never becomes cash by any route, including this one.
create or replace function public.cancel_care_voucher(p_voucher uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_v public.care_vouchers%rowtype;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if not (private.is_admin() or private.has_permission('vouchers.manage')) then
    raise exception 'not authorised to cancel a voucher' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;

  select * into v_v from public.care_vouchers where id = p_voucher for update;
  if not found then raise exception 'voucher not found'; end if;
  if v_v.status = 'redeemed' then raise exception 'a used voucher cannot be cancelled'; end if;

  update public.care_vouchers
     set status = 'cancelled', cancelled_at = now(), cancelled_reason = trim(p_reason)
   where id = p_voucher;

  insert into public.care_voucher_events
    (organisation_id, voucher_id, event_type, actor_profile_id, amount_kobo, note)
  values (v_v.organisation_id, p_voucher, 'cancelled', v_caller, v_v.amount_paid_kobo, trim(p_reason));

  perform private.log_audit('care_vouchers.cancelled', 'care_vouchers', p_voucher,
    jsonb_build_object('reason', p_reason, 'amount_paid_kobo', v_v.amount_paid_kobo));

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.extend_care_voucher(uuid, text) from public;
revoke all on function public.extend_care_voucher(uuid, text) from anon;
revoke all on function public.cancel_care_voucher(uuid, text) from public;
revoke all on function public.cancel_care_voucher(uuid, text) from anon;
grant execute on function public.extend_care_voucher(uuid, text) to authenticated;
grant execute on function public.cancel_care_voucher(uuid, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.extend_care_voucher(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cancel_care_voucher(uuid,text)', 'EXECUTE') then
    raise exception 'anon must not reach voucher administration';
  end if;
  if not exists (select 1 from cron.job where jobname = 'care-voucher-expiry-daily') then
    raise exception 'the voucher expiry cron was not scheduled';
  end if;
end $$;;
