-- Marketing-site audit (2026-08-12) found the Terms of Service still has a
-- "Your monitoring device" section describing purchasing a Bluetooth-paired
-- BP cuff/glucometer "through the platform" and Tarragon telling you whether
-- it's "sold to you outright or provided on some other basis." The founder
-- deliberately shelved device sales/bundling 2026-08-02 (see CLAUDE.md's
-- Device & Wearable Integration section): becoming a hardware
-- importer/reseller would require Tarragon to be NAFDAC's registered local
-- representative for whichever brand it bundles, a regulatory/business-
-- development commitment inappropriate for a pre-revenue solo founder to
-- take on speculatively. No device-bundle checkout ever shipped
-- (pricing.ts has zero device line items). This document is a legal consent
-- a patient actually accepts, so it should not promise a sales relationship
-- that was never built and is not going to be.
--
-- consent_versions is append-only: this retires the current terms_of_service
-- row and publishes a successor built from it, changing exactly the "Your
-- monitoring device" section. data_processing and telehealth are untouched
-- here (each gets its own migration), so existing acceptances of those two
-- stay valid.

do $$
declare
  v_body text;
  v_title text;
  v_old_device text;
  v_new_device text;
begin
  select body, title into v_body, v_title
    from public.consent_versions
   where consent_type = 'terms_of_service' and is_current;

  if v_body is null then raise exception 'no current terms of service to amend'; end if;

  v_old_device := '## Your monitoring device' || chr(10) ||
    'Where you purchase a Bluetooth-paired monitoring device (a blood-pressure cuff, glucometer, or similar) through the platform, we will tell you clearly at the point of purchase whether it is sold to you outright or provided on some other basis. If your device is faulty, tell us — a device we cannot trust to give you a real reading undermines the reason we sold it to you.';

  if position(v_old_device in v_body) = 0 then
    raise exception 'the monitoring-device passage to amend was not found verbatim; re-read the live row before amending';
  end if;

  v_new_device := '## Your monitoring device' || chr(10) ||
    'TarragonHealth does not sell, import, or supply blood-pressure cuffs, glucometers, or other monitoring devices. You buy your own device from any retailer of your choosing. Where your device uses a supported Bluetooth connection, our app can pair with it so a reading it takes can be logged to your record; support for a specific device model is not a guarantee that model will work with the app, and you should confirm compatibility before relying on it.';

  update public.consent_versions
     set is_current = false
   where consent_type = 'terms_of_service' and is_current;

  insert into public.consent_versions (consent_type, version, title, body, is_current)
  values ('terms_of_service', '2026-08-12-v1', v_title,
          replace(v_body, v_old_device, v_new_device),
          true);
end $$;

do $$
declare v_body text;
begin
  select body into v_body from public.consent_versions
   where consent_type = 'terms_of_service' and is_current;

  if v_body ilike '%sold to you outright%' then
    raise exception 'the terms still describe selling a monitoring device';
  end if;
  if v_body not ilike '%does not sell, import, or supply%' then
    raise exception 'the terms do not state that Tarragon does not sell monitoring devices';
  end if;
  if (select count(*) from public.consent_versions
      where consent_type = 'terms_of_service' and is_current) <> 1 then
    raise exception 'exactly one terms_of_service version must be current';
  end if;
  -- The other two consent types must be untouched, so prior acceptances hold.
  if (select count(*) from public.consent_versions
      where consent_type in ('data_processing', 'telehealth') and is_current) <> 2 then
    raise exception 'the other consent types were disturbed';
  end if;
end $$;
