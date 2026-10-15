-- S03b-b (v5 1.8, closes OQ-41): eligibility first, claim after a verified contact.
-- Design: docs/design/S03b.md section 4. Founder decision 2026-10-13.
--
-- BEFORE: private.handle_new_user() matched a new account to an employer_roster_members row by the phone or email typed at sign-up,
-- at INSERT time, before any code or link was confirmed, and marked the slot claimed and moved the profile to the employer's
-- organisation. Anyone could burn a colleague's slot with a number they did not own. A sponsor cohort code could only be entered
-- after sign-up (public.join_cohort), never at sign-up.
--
-- AFTER: the sign-up form may carry a sponsor cohort code. The code is checked (a service-role-only function the server action
-- calls) and held as PENDING in the account's own metadata. Nothing is claimed or joined until the phone or the email is verified:
--   * an AFTER UPDATE trigger on auth.users fires when email_confirmed_at or phone_confirmed_at first becomes non-null;
--   * an account created already verified (an admin invite, a provisioned account) is handled at the end of handle_new_user;
--   * private.claim_programmes_for_verified_user() then (1) claims a roster slot, matching on a VERIFIED channel only, and
--     (2) joins the pending cohort through the same rules as join_cohort (roster first, so the cohort sees the organisation the
--     person ends up in).
-- The pending code lives in raw_user_meta_data, which the account owner can edit. That is safe: the code is re-checked by the same
-- rules as join_cohort at claim time, and the claim runs once, on the verification transition. Editing it grants nothing a signed-in
-- person could not already get by calling join_cohort.
--
-- The claim only moves a profile that has not finished onboarding (a profile with records stays where it is; see the function).
--
-- Counted live 2026-10-13: 0 employer_roster_members rows (0 pending or invited), 0 sponsor_cohorts, 0 profile_cohorts,
-- 12 auth users. Nothing to convert and no slot is currently exposed.
--
-- Live definitions were read with pg_get_functiondef on 2026-10-13 (private.handle_new_user, public.join_cohort), not taken from
-- migration files.

-- ---------------------------------------------------------------------------
-- 1. join_cohort split into a core that takes the person, and the signed-in wrapper (behaviour unchanged for the wrapper)
-- ---------------------------------------------------------------------------
create function private.join_cohort_core(p_uid uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  p public.profiles%rowtype; c public.sponsor_cohorts%rowtype;
  v_norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_today date := (now() at time zone 'Africa/Lagos')::date; v_existing uuid; v_prior boolean;
begin
  select * into p from public.profiles where id = p_uid and role = 'patient' and is_active and not coalesce(is_dependent_account, false);
  if not found then return jsonb_build_object('ok', false); end if;
  if (select count(*) from public.cohort_join_attempts where patient_id = p_uid and at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false);
  end if;
  select * into c from public.sponsor_cohorts
   where code = v_norm and organisation_id = p.organisation_id and status = 'active' and v_today between valid_from and valid_to for update;
  -- someone who was in this programme before may return without using another place (and even when it is full)
  v_prior := found and exists (select 1 from public.profile_cohorts where patient_id = p_uid and cohort_id = c.id);
  if not found or (c.uses >= c.max_uses and not v_prior) then
    delete from public.cohort_join_attempts where patient_id = p_uid and at < now() - interval '1 day';
    insert into public.cohort_join_attempts (organisation_id, patient_id) values (p.organisation_id, p_uid);
    return jsonb_build_object('ok', false);
  end if;
  select id into v_existing from public.profile_cohorts where patient_id = p_uid and cohort_id = c.id and left_at is null;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'status', 'already', 'cohort_id', c.id);
  end if;
  begin
    insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, is_test) values (p.organisation_id, p_uid, c.id, coalesce(p.is_test, false));
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'status', 'already', 'cohort_id', c.id);
  end;
  if not v_prior then update public.sponsor_cohorts set uses = uses + 1 where id = c.id; end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (p.organisation_id, p_uid, 'sponsor.cohort_joined', 'sponsor_cohort', c.id, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'status', 'joined', 'cohort_id', c.id, 'sponsor', (select name from public.organisations where id = c.sponsor_org_id), 'name', c.name);
end $$;
revoke all on function private.join_cohort_core(uuid, text) from public, anon, authenticated;

create or replace function public.join_cohort(p_code text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'cohort_not_authorised' using errcode = '42501'; end if;
  return private.join_cohort_core(v_uid, p_code);
end $$;

-- ---------------------------------------------------------------------------
-- 2. The code a visitor typed at sign-up: valid right now? (service role only; the server action rate-limits it)
-- ---------------------------------------------------------------------------
create function public.check_cohort_code_for_signup(p_code text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.sponsor_cohorts c
     where c.code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
       and c.organisation_id = '00000000-0000-0000-0000-000000000001'
       and c.status = 'active'
       and (now() at time zone 'Africa/Lagos')::date between c.valid_from and c.valid_to
       and c.uses < c.max_uses)
$$;
revoke all on function public.check_cohort_code_for_signup(text) from public, anon, authenticated;
grant execute on function public.check_cohort_code_for_signup(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The claim, run only for a VERIFIED contact
-- ---------------------------------------------------------------------------
create function private.claim_programmes_for_verified_user(p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  u auth.users%rowtype;
  p public.profiles%rowtype;
  v_phone text; v_email text; v_code text;
  v_roster_id uuid; v_roster_org uuid;
  v_fresh boolean;
  r jsonb;
begin
  select * into u from auth.users where id = p_user;
  select * into p from public.profiles where id = p_user;
  if u.id is null or p.id is null then return; end if;

  -- An account is "fresh" until it has finished onboarding. Moving a profile to an employer's organisation is only safe while the
  -- account holds no organisation-scoped records (vitals, medications, appointments, consents ...): they would stay behind in the
  -- old organisation and split the person's record. The old code did it at INSERT, when that was always true; now the claim can
  -- run on a later verification (a second channel added months after sign-up), so an established account is NOT moved. It can still
  -- join through public.claim_employer_roster_member, the explicit route for an existing user.
  v_fresh := p.onboarding_completed_at is null;

  -- (1) the employer roster slot, matched on a VERIFIED channel only, and only for a self-serve account (an account an admin
  -- already placed in an organisation through app_metadata is left where it was put). Done BEFORE the cohort so the cohort rules
  -- (a cohort is joined only inside the person's own organisation) see the organisation the person ends up in.
  if (u.raw_app_meta_data ->> 'organisation_id') is null
     and not exists (select 1 from public.employer_roster_members where claimed_profile_id = p_user) then
    v_phone := case
      when u.phone_confirmed_at is not null and coalesce(u.phone, '') <> '' then (case when u.phone ~ '^\+' then u.phone else '+' || u.phone end)
    end;
    v_email := case
      when u.email_confirmed_at is not null then nullif(lower(trim(coalesce(u.email, ''))), '')
    end;
    if v_phone is not null then
      select id, organisation_id into v_roster_id, v_roster_org from public.employer_roster_members
       where phone = v_phone and status in ('pending', 'invited') order by created_at limit 1 for update;
    end if;
    if v_roster_id is null and v_email is not null then
      select id, organisation_id into v_roster_id, v_roster_org from public.employer_roster_members
       where lower(trim(email)) = v_email and status in ('pending', 'invited') order by created_at limit 1 for update;
    end if;
    if v_roster_id is not null and v_fresh then
      update public.profiles set organisation_id = v_roster_org where id = p_user and organisation_id is distinct from v_roster_org;
      update public.employer_roster_members
         set status = 'claimed', claimed_profile_id = p_user, claimed_at = now() where id = v_roster_id;
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
      values (v_roster_org, p_user, 'roster.claimed_after_verification', 'employer_roster_member', v_roster_id, '{}'::jsonb, p_user);
      p.organisation_id := v_roster_org;
    elsif v_roster_id is not null then
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result, subject_patient_id)
      values (v_roster_org, p_user, 'roster.claim_skipped_account_in_use', 'employer_roster_member', v_roster_id,
              jsonb_build_object('why', 'onboarding_completed'), 'denied', p_user);
      -- tell the person: they may believe employer cover applies, and nothing retries this
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class, priority)
      values (p.organisation_id, p_user, 'in_app', 'pending', 'security.programme_code_not_applied',
              jsonb_build_object('message', 'Your employer has listed you, but this account is already in use, so we could not add you to their programme automatically. Ask your employer to send you a join code, then enter it from your profile.', 'occurred_at', now()),
              'non_clinical', 'routine');
    end if;
  end if;

  -- (2) the pending sponsor cohort code, joined by the same rules as join_cohort. A code that no longer works is told to the person
  -- in-app rather than dropped silently.
  v_code := nullif(btrim(coalesce(u.raw_user_meta_data ->> 'cohort_code', '')), '');
  if v_code is not null and p.role = 'patient' then
    r := private.join_cohort_core(p_user, v_code);
    if coalesce((r ->> 'ok')::boolean, false) = false then
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class, priority)
      values ((select organisation_id from public.profiles where id = p_user), p_user, 'in_app', 'pending', 'security.programme_code_not_applied',
              jsonb_build_object('message', 'The programme code you entered when you signed up could not be used: it may have expired or be full. You can try it again from your profile, or ask the programme for a new one.', 'occurred_at', now()),
              'non_clinical', 'routine');
    end if;
  end if;
end;
$$;
revoke all on function private.claim_programmes_for_verified_user(uuid) from public, anon, authenticated;

-- A failure here must never block sign-up or the verification itself, but it must never be silent either: it is written to the
-- audit log, and the person is told in-app that their programme could not be added, with the route to try again (the code from
-- their profile, or the employer join code). The claim runs once, on the verification transition, so nothing retries it by itself.
create function private.claim_programmes_safely(p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.claim_programmes_for_verified_user(p_user);
exception when others then
  begin
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result, subject_patient_id)
    values ((select organisation_id from public.profiles where id = p_user), p_user, 'signup.programme_claim_failed', 'auth_user', p_user,
            jsonb_build_object('sqlstate', sqlstate), 'failed', p_user);
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class, priority)
    select organisation_id, p_user, 'in_app', 'pending', 'security.programme_code_not_applied',
           jsonb_build_object('message', 'We could not add you to your programme just now. You can enter your programme or employer code again from your profile.', 'occurred_at', now()),
           'non_clinical', 'routine'
      from public.profiles where id = p_user;
  exception when others then
    raise warning 'S03b: programme claim failed for a new user and the failure could not be recorded (sqlstate %)', sqlstate;
  end;
end;
$$;
revoke all on function private.claim_programmes_safely(uuid) from public, anon, authenticated;

create function private.claim_on_contact_verified() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.claim_programmes_safely(new.id);
  return new;
end;
$$;
revoke all on function private.claim_on_contact_verified() from public, anon, authenticated;

create trigger auth_users_claim_on_contact_verified
  after update of email_confirmed_at, phone_confirmed_at on auth.users
  for each row
  when ((old.email_confirmed_at is null and new.email_confirmed_at is not null)
     or (old.phone_confirmed_at is null and new.phone_confirmed_at is not null))
  execute function private.claim_on_contact_verified();

-- ---------------------------------------------------------------------------
-- 4. handle_new_user: the roster claim moves out. Everything else is the live definition, unchanged.
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_org_id uuid;
  v_dob_text text;
  v_dob date;
begin
  v_phone := case
    when new.phone is null or new.phone = '' then null
    when new.phone ~ '^\+' then new.phone
    else '+' || new.phone
  end;

  -- S04b-1 (PR 1078, migration 20261013183512): registration is for adults. A date of birth carried in the sign-up metadata must be
  -- a real date and 18 or more years ago, and is stored. This definition is a SUPERSET of that one so that whichever migration is
  -- applied last does not undo the other: it sorts after 20261013183512, keeps the age refusal and the stored date of birth, and
  -- adds the claim-after-verification change below. A sign-up that carries no date of birth is still accepted (staff and
  -- dependant records are provisioned without one); onboarding then requires it and the profiles trigger applies the rule.
  v_dob_text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'date_of_birth', '')), '');
  if v_dob_text is not null then
    begin
      v_dob := v_dob_text::date;
    exception when others then
      raise exception 'adult_only_registration: invalid date of birth' using errcode = 'P0001';
    end;
    if v_dob > (current_date - interval '18 years')::date then
      raise exception 'adult_only_registration: registration is for adults aged 18 and over' using errcode = 'P0001';
    end if;
  end if;

  v_org_id := coalesce(
    (new.raw_app_meta_data ->> 'organisation_id')::uuid,
    '00000000-0000-0000-0000-000000000001'
  );

  insert into public.profiles (id, role, organisation_id, full_name, phone, date_of_birth)
  values (
    new.id,
    coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'patient'),
    coalesce(v_org_id, '00000000-0000-0000-0000-000000000001'),
    new.raw_user_meta_data ->> 'full_name',
    v_phone,
    v_dob
  );

  -- An account created already verified (an admin invite, a provisioned account) has nothing left to wait for, so its
  -- programme claim runs now. An ordinary sign-up has no confirmed channel yet and claims on verification (trigger above).
  if new.email_confirmed_at is not null or new.phone_confirmed_at is not null then
    perform private.claim_programmes_safely(new.id);
  end if;

  return new;
end;
$$;
