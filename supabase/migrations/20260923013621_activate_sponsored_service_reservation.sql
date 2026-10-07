-- AFTER INSERT trigger on payment_transactions, same shape as
-- private.activate_sponsored_service_purchase (sponsored_subscription kind):
-- metadata-kind-filtered no-op for every other event, idempotent on
-- payment_provider_ref, amount/currency verified against what the
-- reservation was actually priced at, failures routed through
-- private.record_payment_integrity_flag rather than swallowed silently.
--
-- gen_random_bytes is schema-qualified as extensions.gen_random_bytes -- see
-- the RPC migration's header for why (same fix, same root cause, found live
-- before merge).
create or replace function private.activate_sponsored_service_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb;
  v_ref text;
  v_reservation_id uuid;
  v_reservation public.sponsored_service_reservations%rowtype;
  v_invite_token text;
  v_expires_at timestamptz;
begin
  if new.event_type::text not in ('charge.success', 'checkout.session.completed') then
    return new;
  end if;

  v_meta := coalesce(
    new.raw_payload -> 'data' -> 'metadata',
    new.raw_payload -> 'data' -> 'object' -> 'metadata',
    new.raw_payload -> 'metadata',
    '{}'::jsonb
  );

  if coalesce(v_meta ->> 'kind', '') <> 'sponsored_service_reservation' then
    return new;
  end if;

  begin
    v_ref := coalesce(
      new.raw_payload -> 'data' ->> 'reference',
      new.raw_payload -> 'data' -> 'object' ->> 'id'
    );

    if v_ref is null then
      perform private.record_payment_integrity_flag(
        new.id, 'status_mismatch', null, null, new.amount_minor,
        'Refused a sponsored service reservation activation: the event carried no provider reference to correlate or dedupe against.');
      return new;
    end if;

    v_reservation_id := nullif(v_meta ->> 'reservation_id', '')::uuid;
    if v_reservation_id is null then
      return new;
    end if;

    select * into v_reservation
      from public.sponsored_service_reservations
     where id = v_reservation_id
     for update;

    if v_reservation.id is null then
      return new;
    end if;

    -- Idempotency: a Paystack retry of the same charge must not re-invite
    -- (which would mint a second invite_token and lose the first one).
    if v_reservation.payment_provider_ref = v_ref then
      return new;
    end if;

    -- Only a still-pending reservation can be activated once.
    if v_reservation.status <> 'pending_payment' then
      return new;
    end if;

    if new.amount_minor is not null and new.amount_minor <> v_reservation.amount_kobo then
      perform private.record_payment_integrity_flag(
        new.id, 'amount_mismatch', v_ref, v_reservation.amount_kobo, new.amount_minor,
        format('Refused a sponsored service reservation activation: charged %s, reservation priced %s.',
               new.amount_minor, v_reservation.amount_kobo));
      return new;
    end if;
    if new.currency is not null and new.currency::text <> v_reservation.currency::text then
      perform private.record_payment_integrity_flag(
        new.id, 'amount_mismatch', v_ref, v_reservation.amount_kobo, new.amount_minor,
        format('Refused a sponsored service reservation activation: paid in %s, reservation priced in %s.',
               new.currency, v_reservation.currency));
      return new;
    end if;

    v_invite_token := encode(extensions.gen_random_bytes(24), 'hex');
    -- Same 30-day grace window shape as funding_programme_invitations.
    v_expires_at := now() + interval '30 days';

    update public.sponsored_service_reservations
       set status = 'invited',
           payment_provider = new.provider::text,
           payment_provider_ref = v_ref,
           invite_token = v_invite_token,
           invited_at = now(),
           expires_at = v_expires_at
     where id = v_reservation_id;

  exception when others then
    perform private.record_payment_integrity_flag(
      new.id, 'status_mismatch', v_ref, null, new.amount_minor,
      format('A sponsored service reservation activation failed and was swallowed: %s', sqlerrm));
    return new;
  end;

  return new;
end;
$$;

create trigger payment_transactions_activate_sponsored_reservation
  after insert on public.payment_transactions
  for each row execute function private.activate_sponsored_service_reservation();
