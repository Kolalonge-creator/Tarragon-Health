-- Legal consent documents, 2026-08-12: remove all em dashes from the three
-- rendered consent_versions bodies (terms_of_service, telehealth,
-- data_processing), per the standing no-em-dash brand-voice rule. Rewritten
-- grammatically (colon/semicolon/comma/parentheses); no change in legal
-- meaning. Substantive fixes (Health Wallet -> Care Vouchers, WhatsApp
-- two-way messaging claim, device-bundle clause) were already applied by a
-- concurrent session moments before this migration; this only cleans up
-- punctuation left over from those edits and the original text.
--
-- consent_versions is append-only: each retires its prior current row and
-- publishes a same-day successor built from it via a chain of replace()
-- calls against the LIVE current body (not a hardcoded literal), so this is
-- safe to apply even if the exact prior text has drifted slightly from what
-- was inspected while drafting this migration -- any em dash the chain
-- fails to catch aborts the whole transaction via the assertion block below
-- rather than shipping a partial fix.

do $$
declare
  v_old_body text;
  v_new_body text;
  v_title text;
begin
  select body, title into v_old_body, v_title
    from public.consent_versions
   where consent_type = 'terms_of_service' and is_current;
  if v_old_body is null then raise exception 'no current terms_of_service to amend'; end if;

  v_new_body := replace(replace(replace(replace(replace(replace(replace(v_old_body, 'Terms of Service — Schedule C', 'Terms of Service, Schedule C'), 'individually-structured account — we do not offer', 'individually-structured account; we do not offer'), 'and — for an adult who wants help managing their own care — you may set up', 'and, for an adult who wants help managing their own care, you may set up'), 'screening facility — every lab, pharmacy', 'screening facility; every lab, pharmacy'), 'emergency service — see our Telehealth Consent', 'emergency service; see our Telehealth Consent'), 'your access — if so, that organisation', 'your access; if so, that organisation'), 'accepts the request — a visit is never automatic', 'accepts the request; a visit is never automatic');

  update public.consent_versions set is_current = false
   where consent_type = 'terms_of_service' and is_current;
  insert into public.consent_versions (consent_type, version, title, body, is_current)
  values ('terms_of_service', '2026-08-12-v2', v_title, v_new_body, true);
end $$;

do $$
declare
  v_old_body text;
  v_new_body text;
  v_title text;
begin
  select body, title into v_old_body, v_title
    from public.consent_versions
   where consent_type = 'telehealth' and is_current;
  if v_old_body is null then raise exception 'no current telehealth to amend'; end if;

  v_new_body := replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(v_old_body, 'Telehealth Consent — Schedule B', 'Telehealth Consent, Schedule B'), 'checked continuously afterwards — a doctor whose registration', 'checked continuously afterwards; a doctor whose registration'), 'involved in your care — they follow up', 'involved in your care; they follow up'), 'appropriate to its type — even a normal reading gets a record', 'appropriate to its type; even a normal reading gets a record'), 'prepare for your case — it never classifies a result itself', 'prepare for your case; it never classifies a result itself'), 'how a result is classified — a routine screening result', 'how a result is classified: a routine screening result'), 'written note alone — your doctor must have completed', 'written note alone; your doctor must have completed'), 'outcome in every case — how quickly we can reach you', 'outcome in every case: how quickly we can reach you'), 'app is your record — all clinical conversation', 'app is your record: all clinical conversation'), 'judgement is delivered — if something in your results', 'judgement is delivered: if something in your results'), 'documents — receipts, reports, and copies of your consent records.', 'documents: receipts, reports, and copies of your consent records.'), 'refer you appropriately — including, where relevant', 'refer you appropriately, including, where relevant'), '[Nigeria''s emergency line — exact number to be confirmed]', '[Nigeria''s emergency line, exact number to be confirmed]'), 'your specific consent — including a family member or sponsor you have separately consented to give view access to — where the law requires disclosure', 'your specific consent (including a family member or sponsor you have separately consented to give view access to), where the law requires disclosure');

  update public.consent_versions set is_current = false
   where consent_type = 'telehealth' and is_current;
  insert into public.consent_versions (consent_type, version, title, body, is_current)
  values ('telehealth', '2026-08-12-v2', v_title, v_new_body, true);
end $$;

do $$
declare
  v_old_body text;
  v_new_body text;
  v_title text;
begin
  select body, title into v_old_body, v_title
    from public.consent_versions
   where consent_type = 'data_processing' and is_current;
  if v_old_body is null then raise exception 'no current data_processing to amend'; end if;

  v_new_body := replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(v_old_body, 'Data Processing Consent — Schedule A', 'Data Processing Consent, Schedule A'), '[DPO name and contact — to be appointed and confirmed]', '[DPO name and contact, to be appointed and confirmed]'), 'Identity and contact details — name, date of birth', 'Identity and contact details: name, date of birth'), 'Emergency contact — the name and phone number', 'Emergency contact: the name and phone number'), 'Health and clinical information — vitals readings', 'Health and clinical information: vitals readings'), 'Payment and voucher information — subscription, Care Voucher, and order history', 'Payment and voucher information: subscription, Care Voucher, and order history'), 'Device information — where you use a Bluetooth-paired reading device', 'Device information: where you use a Bluetooth-paired reading device'), 'Usage information — app and website activity', 'Usage information: app and website activity'), 'Most of what we hold about you — your readings, symptoms, diagnoses, medications, and results — is health information', 'Most of what we hold about you (your readings, symptoms, diagnoses, medications, and results) is health information'), 'Delivery of your care — processing your readings', 'Delivery of your care: processing your readings'), 'Specific, scoped consent — for anything beyond your direct care', 'Specific, scoped consent: for anything beyond your direct care'), 'Escalation contact — your consent for us to message', 'Escalation contact: your consent for us to message'), 'Clinical share — your consent to share', 'Clinical share: your consent to share'), 'Family/sponsor access — a family member, next of kin, or sponsor funding your care may, with your separate consent, view your record or manage bookings on your behalf. Funding your care never grants this access automatically — it is a separate, two-sided request', 'Family/sponsor access: a family member, next of kin, or sponsor funding your care may, with your separate consent, view your record or manage bookings on your behalf. Funding your care never grants this access automatically; it is a separate, two-sided request'), 'Institution aggregate — if you are enrolled through an employer or HMO programme, your data contributes to that organisation''s aggregate statistics in de-identified form regardless of this consent, because the organisation never sees anything about you individually — see "Who we share your data with" below.', 'Institution aggregate: if you are enrolled through an employer or HMO programme, your data contributes to that organisation''s aggregate statistics in de-identified form regardless of this consent, because the organisation never sees anything about you individually. See "Who we share your data with" below.'), 'Research, anonymised — your optional consent', 'Research, anonymised: your optional consent'), 'Legal obligation — we process certain data', 'Legal obligation: we process certain data'), 'extract of your record — never your free-text notes — to a second processor', 'extract of your record (never your free-text notes) to a second processor'), 'appropriate to its type — this always happens', 'appropriate to its type; this always happens'), 'before they act on your case — it never diagnoses', 'before they act on your case; it never diagnoses'), 'in your own language — never a diagnosis', 'in your own language: never a diagnosis'), 'in-app conversation — it cannot be closed', 'in-app conversation; it cannot be closed'), 'Your care team — the doctors and coordinators', 'Your care team: the doctors and coordinators'), 'consented to share with — see "Clinical share" and "Family/sponsor access" above.', 'consented to share with. See "Clinical share" and "Family/sponsor access" above.'), 'no individual identified — any figure drawn', 'no individual identified; any figure drawn'), 'doctor-facing summary — see "Automated processing" above.', 'doctor-facing summary. See "Automated processing" above.'), 'opted in — see "Research, anonymised" above — built so no individual', 'opted in (see "Research, anonymised" above), built so no individual'), 'at any time — this works from your first login', 'at any time; this works from your first login'), 'individually-structured record — we do not offer', 'individually-structured record; we do not offer');

  update public.consent_versions set is_current = false
   where consent_type = 'data_processing' and is_current;
  insert into public.consent_versions (consent_type, version, title, body, is_current)
  values ('data_processing', '2026-08-12-v2', v_title, v_new_body, true);
end $$;

do $$
declare
  v_ts text; v_th text; v_dp text;
begin
  select body into v_ts from public.consent_versions where consent_type = 'terms_of_service' and is_current;
  select body into v_th from public.consent_versions where consent_type = 'telehealth' and is_current;
  select body into v_dp from public.consent_versions where consent_type = 'data_processing' and is_current;

  if v_ts like '%—%' then raise exception 'em dash remains in terms_of_service'; end if;
  if v_th like '%—%' then raise exception 'em dash remains in telehealth'; end if;
  if v_dp like '%—%' then raise exception 'em dash remains in data_processing'; end if;

  if v_ts ilike '%wallet%' then raise exception 'terms_of_service still mentions a wallet'; end if;
  if v_dp ilike '%wallet%' then raise exception 'data_processing still mentions a wallet'; end if;
  if v_th ilike '%may reply there too%' or v_th ilike '%doctor on whatsapp for support%' then
    raise exception 'telehealth still claims two-way WhatsApp messaging';
  end if;
  if v_ts not ilike '%does not sell, import%' then
    raise exception 'terms_of_service device clause regressed';
  end if;

  if (select count(*) from public.consent_versions where consent_type = 'terms_of_service' and is_current) <> 1
     or (select count(*) from public.consent_versions where consent_type = 'telehealth' and is_current) <> 1
     or (select count(*) from public.consent_versions where consent_type = 'data_processing' and is_current) <> 1 then
    raise exception 'exactly one current row must exist per consent_type';
  end if;
end $$;
