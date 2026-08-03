-- Emergency card: expiry, per-view notification, and the print path needs
-- nothing new here at all.
--
-- Founder-directed redesign: the printed/offline card becomes the default
-- (built entirely on the patient's own authenticated session — no new anon
-- surface, see the app-layer changes), and the live anon-readable link becomes
-- an explicit opt-in on top, hardened three ways:
--
--   1. 12-month expiry, so a live PHI endpoint can never sit forgotten for
--      years. Enforced lazily in emergency_card_by_token (same shape as the
--      existing revocation check) — no separate enforcement cron needed.
--   2. A renewal nudge in the 30 days before expiry, so the patient is not
--      surprised when it lapses.
--   3. A notification on every day a card is actually viewed, deduped to at
--      most one per calendar day so a single hospital visit that scans it
--      several times doesn't spam the patient — near-real-time discovery
--      instead of a log they have to remember to check.

alter table public.emergency_cards
  add column if not exists expires_at         timestamptz not null default (now() + interval '12 months'),
  add column if not exists renewal_nudged_at  timestamptz,
  add column if not exists last_viewed_on     date;

create index if not exists emergency_cards_expiring_idx
  on public.emergency_cards (expires_at)
  where is_active and renewal_nudged_at is null;

-- ------------------------------------------------------------ create/rotate
--
-- Rotating is also how a patient renews: a fresh 12-month clock, and the
-- renewal-nudge/view-notification state resets so a brand-new card doesn't
-- inherit a stale nudge flag from the one it replaced.

create or replace function public.create_emergency_card()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_token text;
begin
  select organisation_id into v_org
  from public.profiles
  where id = auth.uid() and role = 'patient';

  if v_org is null then
    raise exception 'only a patient may create their own emergency card'
      using errcode = '42501';
  end if;

  v_token := replace(replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'), '/', '_');
  v_token := replace(v_token, '=', '');

  insert into public.emergency_cards
    (patient_id, organisation_id, token, is_active, consented_at, expires_at)
  values (auth.uid(), v_org, v_token, true, now(), now() + interval '12 months')
  on conflict (patient_id) do update
    set token          = excluded.token,
        is_active      = true,
        consented_at   = now(),
        revoked_at     = null,
        view_count     = 0,
        last_viewed_at = null,
        expires_at         = now() + interval '12 months',
        renewal_nudged_at  = null,
        last_viewed_on     = null;

  return v_token;
end;
$$;

-- ------------------------------------------------------------------ the read

create or replace function public.emergency_card_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card    public.emergency_cards%rowtype;
  v_profile public.profiles%rowtype;
  v_payload jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;

  -- Expiry is checked the same way revocation already is: a lapsed card simply
  -- stops resolving, no separate enforcement job required.
  select * into v_card
  from public.emergency_cards
  where token = p_token and is_active and expires_at > now();

  if not found then
    return null;
  end if;

  select * into v_profile from public.profiles where id = v_card.patient_id;
  if not found then
    return null;
  end if;

  insert into public.emergency_card_lookups (card_id) values (v_card.id);

  -- Deduped to one notification per calendar day: a single ER visit can
  -- reasonably scan the card several times, and a notification per scan would
  -- train the patient to ignore them, defeating the point.
  if v_card.last_viewed_on is null or v_card.last_viewed_on < current_date then
    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload)
    values
      (v_card.organisation_id, v_card.patient_id, 'in_app', 'emergency_card_viewed',
       jsonb_build_object('viewed_on', current_date)),
      (v_card.organisation_id, v_card.patient_id, 'email', 'emergency_card_viewed',
       jsonb_build_object('viewed_on', current_date));
  end if;

  update public.emergency_cards
  set view_count = view_count + 1, last_viewed_at = now(), last_viewed_on = current_date
  where id = v_card.id;

  v_payload := jsonb_build_object(
    'full_name', v_profile.full_name,
    'date_of_birth', v_profile.date_of_birth,
    'sex', v_profile.sex,
    'patient_number', v_profile.patient_number,
    'emergency_contact', case
      when v_profile.emergency_contact_name is null then null
      else jsonb_build_object(
        'name', v_profile.emergency_contact_name,
        'phone', v_profile.emergency_contact_phone,
        'relationship', v_profile.emergency_contact_relationship
      )
    end,
    'allergies', coalesce((
      select jsonb_agg(jsonb_build_object('allergen', a.allergen, 'reaction', a.reaction, 'severity', a.severity)
             order by a.severity desc nulls last, a.allergen)
      from public.patient_allergies a where a.patient_id = v_card.patient_id
    ), '[]'::jsonb),
    'medications', coalesce((
      select jsonb_agg(jsonb_build_object('drug_name', m.drug_name, 'dose', m.dose, 'frequency', m.frequency)
             order by m.drug_name)
      from public.medications m where m.patient_id = v_card.patient_id and m.is_active
    ), '[]'::jsonb),
    'conditions', coalesce((
      select jsonb_agg(distinct cp.condition::text)
      from public.care_plans cp where cp.patient_id = v_card.patient_id and cp.status = 'active'
    ), '[]'::jsonb),
    'blood', (
      select jsonb_build_object(
        'blood_group', b.blood_group::text,
        'genotype', b.genotype::text,
        'note', b.genotype_note,
        'provenance', b.provenance,
        'recorded_at', b.recorded_at
      )
      from public.patient_blood_profile b where b.patient_id = v_card.patient_id
    ),
    'issued_at', v_card.created_at,
    'expires_at', v_card.expires_at,
    'source', 'TarragonHealth'
  );

  return v_payload;
end;
$$;

revoke all on function public.emergency_card_by_token(text) from public;
grant execute on function public.emergency_card_by_token(text) to anon, authenticated;

-- ------------------------------------------------------------- renewal nudge

create or replace function private.queue_emergency_card_expiry_nudges()
returns void
language sql
security definer
set search_path = ''
as $function$
  with expiring as (
    select id, patient_id, organisation_id, expires_at
    from public.emergency_cards
    where is_active
      and renewal_nudged_at is null
      and expires_at between now() and now() + interval '30 days'
  ),
  marked as (
    update public.emergency_cards c
    set renewal_nudged_at = now()
    from expiring e
    where c.id = e.id
    returning c.id, e.patient_id, e.organisation_id, e.expires_at
  )
  insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
  select organisation_id, patient_id, channel, 'emergency_card_expiring_soon',
    jsonb_build_object('expires_at', expires_at)
  from marked
  cross join (values ('in_app'::public.notification_channel), ('email'::public.notification_channel)) as c(channel);
$function$;

-- Supabase grants EXECUTE on every new function to anon/authenticated via a
-- default-privileges setting independent of the PUBLIC pseudo-role, regardless
-- of schema — the same gotcha this codebase has hit before with `public.*`
-- RPCs. A `private`-schema function is no exception, so it must be revoked
-- explicitly rather than assumed unreachable by virtue of its schema.
revoke all on function private.queue_emergency_card_expiry_nudges() from public, anon;
grant execute on function private.queue_emergency_card_expiry_nudges() to authenticated, service_role;

select cron.schedule(
  'emergency-card-expiry-nudge-daily',
  '15 7 * * *',
  $$select private.queue_emergency_card_expiry_nudges();$$
);

do $$
begin
  if not has_function_privilege('anon', 'public.emergency_card_by_token(text)', 'EXECUTE') then
    raise exception 'emergency_card_by_token must stay anon-executable';
  end if;
  if has_function_privilege('anon', 'private.queue_emergency_card_expiry_nudges()', 'EXECUTE') then
    raise exception 'the expiry-nudge cron function must never be anon-executable';
  end if;
end $$;
