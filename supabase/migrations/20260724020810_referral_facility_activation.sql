-- Closes the same "pick near you -> activates -> partner gets emailed" gap
-- for specialist_referrals. specialist_providers already carries
-- contact_email/contact_phone (added by an earlier, unrelated session --
-- currently all null on the seeded [Placeholder] rows, since those aren't
-- real contracted partners yet; the notification below degrades gracefully
-- per-channel exactly like the lab/pharmacy equivalents, same as
-- home_visit_providers/logistics_partners staying dormant until ops
-- activates a real row).
--
-- specialist_referrals has always been staff/trigger-created only (see
-- 20260715125456_clinician_originated_orders) and only the clinician could
-- ever choose the specialist_provider (AssignProviderForm). This is
-- deliberately additive, not a replacement: it only lets the PATIENT fill an
-- still-unassigned referral (specialist_provider_id is null, status still
-- 'pending') from the same matched-provider catalogue the clinician already
-- uses -- it never overrides a clinician's existing assignment, and the
-- clinician worklist / urgency / waitlist tooling is untouched. This is not
-- the guardrailed "full specialist-matching engine" (master plan Phase 2/3)
-- -- it reuses the existing specialist_providers catalogue and assignment
-- column as-is.

create or replace function public.set_referral_specialist_provider(p_referral_id uuid, p_specialist_provider_id uuid)
returns public.specialist_referrals
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_referral  public.specialist_referrals%rowtype;
  v_provider  public.specialist_providers%rowtype;
  v_capitated boolean;
begin
  select * into v_referral from public.specialist_referrals where id = p_referral_id;
  if v_referral.id is null then
    raise exception 'Referral not found' using errcode = '42501';
  end if;

  if v_referral.patient_id is distinct from (select auth.uid()) and not private.is_org_staff(v_referral.organisation_id) then
    raise exception 'Not authorised to update this referral' using errcode = '42501';
  end if;

  if v_referral.specialist_provider_id is not null then
    raise exception 'A specialist has already been assigned to this referral' using errcode = '23514';
  end if;

  if v_referral.status <> 'pending' then
    raise exception 'This referral is not awaiting a specialist choice' using errcode = '23514';
  end if;

  select * into v_provider from public.specialist_providers
    where id = p_specialist_provider_id and is_active and specialist_type = v_referral.specialist_type;
  if v_provider.id is null then
    raise exception 'Specialist provider not found or does not match this referral' using errcode = '23514';
  end if;

  select exists (
    select 1 from public.outcomes_contracts
    where organisation_id = v_referral.organisation_id
      and contract_type = 'capitation'
      and effective_from <= current_date
  ) into v_capitated;

  update public.specialist_referrals
    set specialist_provider_id = p_specialist_provider_id,
        referral_fee_kobo = v_provider.consultation_fee_kobo,
        status = case when v_capitated then 'payment_confirmed'::public.referral_status else 'pending_payment'::public.referral_status end,
        origin = case when v_capitated then 'capitated'::public.booking_origin else origin end
    where id = p_referral_id
    returning * into v_referral;

  return v_referral;
end;
$$;

revoke all on function public.set_referral_specialist_provider(uuid, uuid) from public;
grant execute on function public.set_referral_specialist_provider(uuid, uuid) to authenticated;

-- Specialist-facing (+ patient confirmation) notifications on
-- payment_confirmed -- mirrors enqueue_lab_order_lab_notifications /
-- enqueue_pharmacy_order_notifications exactly.
create or replace function private.enqueue_referral_notifications()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_patient       public.profiles%rowtype;
  v_patient_email text;
  v_provider      public.specialist_providers%rowtype;
begin
  select * into v_patient from public.profiles where id = new.patient_id;
  select email into v_patient_email from auth.users where id = new.patient_id;

  if new.specialist_provider_id is not null then
    select * into v_provider from public.specialist_providers where id = new.specialist_provider_id;
  end if;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (new.organisation_id, new.patient_id, 'whatsapp', 'pending', 'referral_patient_confirmation',
    jsonb_build_object('referral_number', new.referral_number, 'patient_name', coalesce(v_patient.full_name, 'there'),
      'patient_number', v_patient.patient_number, 'specialist_name', coalesce(v_provider.name, 'your specialist'),
      'specialist_type', new.specialist_type::text));

  if v_patient_email is not null then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (new.organisation_id, new.patient_id, 'email', 'pending', 'referral_patient_confirmation',
      jsonb_build_object('to_email', v_patient_email, 'referral_number', new.referral_number, 'patient_name', coalesce(v_patient.full_name, 'there'),
        'patient_number', v_patient.patient_number, 'specialist_name', coalesce(v_provider.name, 'your specialist'),
        'specialist_type', new.specialist_type::text));
  end if;

  if v_provider.contact_phone is not null then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (new.organisation_id, new.patient_id, 'sms', 'pending', 'referral_specialist_alert',
      jsonb_build_object('to_phone', v_provider.contact_phone, 'specialist_name', v_provider.name,
        'patient_name', coalesce(v_patient.full_name, 'a patient'), 'patient_number', v_patient.patient_number,
        'referral_number', new.referral_number, 'specialist_type', new.specialist_type::text,
        'referral_reason', coalesce(new.referral_reason, '')));
  end if;

  if v_provider.contact_email is not null then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (new.organisation_id, new.patient_id, 'email', 'pending', 'referral_specialist_alert',
      jsonb_build_object('to_email', v_provider.contact_email, 'specialist_name', v_provider.name,
        'patient_name', coalesce(v_patient.full_name, 'a patient'), 'patient_number', v_patient.patient_number,
        'referral_number', new.referral_number, 'specialist_type', new.specialist_type::text,
        'referral_reason', coalesce(new.referral_reason, '')));
  end if;

  return new;
end;
$function$;

drop trigger if exists specialist_referrals_enqueue_notifications on public.specialist_referrals;
create trigger specialist_referrals_enqueue_notifications
  after update on public.specialist_referrals
  for each row
  when (old.status is distinct from new.status and new.status = 'payment_confirmed'::public.referral_status)
  execute function private.enqueue_referral_notifications();
