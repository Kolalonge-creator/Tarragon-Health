-- Tarragon Health
-- Data Processing Consent: add a "Deleting your account" section, and drop
-- the two remaining references to Stripe.
--
-- Why now: the Android app is going to Google Play (first public release,
-- v0.1.0, 2026-09-08). Play's account-deletion policy requires a public web
-- page, linked from the Data safety form, that tells a user how to request
-- deletion of their account and data. The live Data Processing Consent
-- (2026-08-12-v2) says only "Ask us to erase your data" under "Your rights"
-- with no route for doing so, and the only real deletion path today sits
-- behind login (Privacy & your data > "Request deletion of your data", web
-- and mobile, backed by data_deletion_requests). This adds a section that
-- names that path, the email fallback, and what happens next, in the same
-- words the in-app card already uses, so the public notice and the product
-- agree. The section is rendered at /privacy#deleting-your-account (section
-- ids added to the legal renderer in the same PR).
--
-- Stripe: removed from the codebase 2026-09-02 (see the archive's
-- 2026-08-31/2026-09-03 entry; no UK entity was ever registered to use it).
-- The notice still names it twice ("payment references from Paystack or
-- Stripe", "Our payment processors, Paystack and Stripe") which would
-- contradict the Play Data safety answers naming Paystack alone. Corrected in
-- the same version for the same reason 20260902185717 corrected three
-- passages at once: a document should not contradict itself after a fix.
--
-- Same append-only pattern as 20260812004025 / 20260902185717: retire the
-- current data_processing row, publish a successor built by verbatim string
-- replacement with position() guards, assert afterwards. telehealth and
-- terms_of_service are untouched, so acceptances of those stay valid. New
-- signups accept this version at onboarding; existing patients are not
-- re-gated (the onboarding consent step is the only place acceptance is
-- checked, and it only runs before onboarding_completed_at is set). Still
-- draft / pending counsel review, same as every version before it.

do $$
declare
  v_body text;
  v_title text;
  v_anchor text;
  v_new_section text;
  v_old_payment text;
  v_new_payment text;
  v_old_processors text;
  v_new_processors text;
begin
  select body, title into v_body, v_title
    from public.consent_versions
   where consent_type = 'data_processing' and is_current;

  if v_body is null then raise exception 'no current data_processing consent to amend'; end if;

  -- The new section goes immediately before "## Security", i.e. right after
  -- "Your rights", where "Ask us to erase your data" already sits.
  v_anchor := '## Security' || chr(10);
  if position(v_anchor in v_body) = 0 then
    raise exception 'anchor "## Security" not found in current data_processing body';
  end if;
  if position('## Deleting your account' in v_body) > 0 then
    raise exception 'data_processing already has a "Deleting your account" section';
  end if;

  v_new_section := '## Deleting your account' || chr(10) ||
    'You can ask us to delete your TarragonHealth account and the personal data we hold about you at any time. There are three ways to do it:' || chr(10) || chr(10) ||
    '• In the app: open More, then Privacy & your data, and tap "Request deletion of your data".' || chr(10) || chr(10) ||
    '• On the web: sign in at app.tarragonhealth.ng, open Privacy & your data, and choose "Request deletion of your data".' || chr(10) || chr(10) ||
    '• By email: write to privacy@tarragonhealth.ng from the email address on your account. We will confirm it is really you before acting on the request.' || chr(10) || chr(10) ||
    'What happens next: a member of our team reviews every request. You can see its status on the same Privacy & your data page. Some clinical records must be kept for a minimum period under Nigerian healthcare regulation and the retention rules described above; if that applies to part of your record, we will tell you exactly what can and cannot be deleted before we complete the request. Everything that is not subject to a retention obligation, including your account, sign-in, contact details, paired-device details, and any data synced from a connected device or health app, is deleted when the request is completed. Once completed, the deletion cannot be undone.' || chr(10) || chr(10) ||
    'Deleting your account never depends on a payment being up to date, and you do not need to give a reason.' || chr(10) || chr(10);

  v_old_payment := '• Payment and voucher information: subscription, Care Voucher, and order history, and payment references from Paystack or Stripe. We do not store your full card number.';
  v_new_payment := '• Payment and voucher information: service purchase, Care Voucher, and order history, and payment references from Paystack. We do not store your full card number.';

  v_old_processors := '• Our payment processors, Paystack and Stripe, to process a payment you have initiated, and';
  v_new_processors := '• Our payment processor, Paystack, to process a payment you have initiated, and';

  if position(v_old_payment in v_body) = 0 then
    raise exception 'expected payment-information passage not found verbatim';
  end if;
  if position(v_old_processors in v_body) = 0 then
    raise exception 'expected payment-processors passage not found verbatim';
  end if;

  update public.consent_versions
     set is_current = false
   where consent_type = 'data_processing' and is_current;

  insert into public.consent_versions (consent_type, version, title, body, is_current)
  values ('data_processing', '2026-09-08-v1', v_title,
          replace(
            replace(
              replace(v_body, v_anchor, v_new_section || v_anchor),
              v_old_payment, v_new_payment),
            v_old_processors, v_new_processors),
          true);
end $$;

do $$
declare v_body text;
begin
  select body into v_body from public.consent_versions
   where consent_type = 'data_processing' and is_current;

  if v_body not like '%## Deleting your account%' then
    raise exception 'the Deleting your account section is missing';
  end if;
  if position('## Deleting your account' in v_body) > position('## Security' in v_body) then
    raise exception 'the Deleting your account section is not before Security';
  end if;
  if v_body not like '%Request deletion of your data%' then
    raise exception 'the section does not name the in-app action';
  end if;
  if v_body ilike '%stripe%' then
    raise exception 'Stripe is still referenced in data_processing';
  end if;
  if v_body like '%—%' then
    raise exception 'em dash reintroduced into data_processing';
  end if;
  if (select count(*) from public.consent_versions
      where consent_type = 'data_processing' and is_current) <> 1 then
    raise exception 'exactly one data_processing version must be current';
  end if;
  if (select version from public.consent_versions
      where consent_type = 'data_processing' and is_current) <> '2026-09-08-v1' then
    raise exception 'current data_processing version is not 2026-09-08-v1';
  end if;
  if (select count(*) from public.consent_versions
      where consent_type in ('telehealth', 'terms_of_service') and is_current) <> 2 then
    raise exception 'the other consent types were disturbed';
  end if;
end $$;
