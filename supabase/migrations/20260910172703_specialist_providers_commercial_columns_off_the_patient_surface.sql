-- A patient could read every column of public.specialist_providers, including
-- what Tarragon earns on a referral and the partner's private contact details.
-- Founder decision, 2026-09-10.
--
-- WHAT WAS WRONG
-- --------------
-- specialist_providers_select was `using (true)` for role `authenticated`. Not
-- a subtle bug -- every logged-in patient could select commission_rate,
-- commission_rate_type, commission_flat_kobo, contact_email and contact_phone.
-- Confirmed live with a real patient JWT, not inferred from the policy text.
--
-- It predates the therapy network, but the therapy network is what made it
-- matter: public.therapy_directory was built to expose only non-sensitive
-- columns, and that protection was cosmetic while the base table underneath was
-- open to the same people.
--
-- WHAT THE FOUNDER ACTUALLY DECIDED, INCLUDING THE PART THAT REVERSES ME
-- ----------------------------------------------------------------------
-- Hidden from patients: the three commission columns and the two contact
-- columns. Commission is what Tarragon earns and is nobody's business but
-- Tarragon's and the practitioner's; contact details are the partner's, and
-- publishing them invites people around the booking that carries the
-- safeguards.
--
-- SHOWN to patients: license_number. My own earlier write-up listed it among
-- the things to hide and the founder reversed that, correctly. A registration
-- number is exactly what lets somebody verify a practitioner with the regulator
-- before paying them for a therapy session. Hiding it would have protected
-- nothing and removed the one part of "we verified them" that the person taking
-- the risk can check for themselves. license_type and license_expires_at go
-- with it for the same reason: "verified, and in date" is the claim, and these
-- are what substantiate it.
--
-- HOW, AND WHY NOT COLUMN GRANTS
-- ------------------------------
-- Column-level privileges cannot express this. `authenticated` is one role
-- covering patients, clinicians and admins alike, so a column grant would hide
-- commission from the admin console too. And per the standing note in memory, a
-- column REVOKE is a silent no-op while a table-level grant exists, so that
-- route also fails quietly rather than loudly.
--
-- So the split is by RELATION, which this codebase already had the shape for:
--   * the TABLE becomes admin-and-partner-manager only;
--   * everyone else -- patients AND clinicians -- reads a view carrying the
--     safe columns.
--
-- Clinicians are on the view deliberately rather than by accident. Nothing a
-- clinician does with a specialist needs the commission rate, and the same
-- founder decision earlier today kept clinical staff away from cost data. The
-- two full-table readers that remain are both under /admin/settings/partners.
--
-- WHY THE VIEWS ARE OWNER-RUN, WHICH LOOKS LIKE THE BUG FIXED THIS MORNING
-- ------------------------------------------------------------------------
-- 20260910170803 fixed a leak caused by an owner-run view over RLS-protected
-- tables. These are the deliberate opposite case and the distinction is the
-- whole design: a view that must survive its base table being locked down has
-- to run as its owner, and it is safe precisely because it selects no sensitive
-- column. security_invoker here would break the patient directory the moment
-- this migration lands. The rule is not "always set security_invoker" -- it is
-- "set it unless the view is a deliberate, column-restricted window, and say so
-- where the next person will read it."

begin;

-- ---------------------------------------------------------------------------
-- 1. The safe window, for every specialist type
--
-- therapy_directory already did this for psychology and psychiatry. This is the
-- same shape for the rest, because /patient/find-a-specialist and the mobile
-- equivalent search across all types.
--
-- Deliberately NOT filtered to verified-only, unlike therapy_directory: that
-- one backs a booking flow where "we checked them" is the promise, while this
-- one is an informational search with no booking attached (a patient who finds
-- someone here messages their care team). is_active is the filter that matters;
-- license_verified_at is exposed so a patient can see for themselves.
-- ---------------------------------------------------------------------------

create or replace view public.specialist_directory as
select sp.id,
       sp.name,
       sp.specialist_type,
       sp.subspecialty,
       sp.qualifications,
       sp.years_of_experience,
       sp.clinical_interests,
       sp.state,
       sp.city,
       sp.area,
       sp.languages,
       sp.accepted_hmos,
       sp.supports_telemedicine,
       sp.supports_in_person,
       sp.consultation_fee_kobo,
       sp.provider_tier,
       -- Patient-visible on purpose: this is what makes the verification
       -- claim checkable by the person taking the risk.
       sp.license_type,
       sp.license_number,
       sp.license_expires_at,
       sp.license_verified_at
  from public.specialist_providers sp
 where sp.is_active;

comment on view public.specialist_directory is
  'The patient- and clinician-facing window onto specialist_providers. Carries the licence fields, which are deliberately patient-visible so a registration can be checked with the regulator, and NEVER commission_rate/commission_rate_type/commission_flat_kobo/contact_email/contact_phone. Owner-run on purpose (no security_invoker) so it survives the base table being admin-only -- see this migration''s header for why that is the opposite of the 20260910170803 leak rather than a repeat of it.';

revoke all on public.specialist_directory from public;
grant select on public.specialist_directory to authenticated;

-- ---------------------------------------------------------------------------
-- 2. therapy_directory gains the same licence fields
--
-- Without this the therapy network cannot show a registration number, which is
-- the whole point of making it patient-visible.
-- ---------------------------------------------------------------------------

create or replace view public.therapy_directory as
select sp.id,
       sp.name,
       sp.specialist_type,
       sp.subspecialty,
       sp.qualifications,
       sp.years_of_experience,
       sp.clinical_interests,
       sp.state,
       sp.city,
       sp.languages,
       sp.supports_telemedicine,
       sp.supports_in_person,
       sp.consultation_fee_kobo,
       sp.specialist_type = 'psychiatry' as needs_doctor_approval,
       -- Appended rather than slotted in beside the other descriptive columns:
       -- CREATE OR REPLACE VIEW can only ADD columns at the end, and reordering
       -- raises 42P16. Dropping and recreating would work but would take the
       -- grants and any dependents with it, for a cosmetic gain.
       sp.license_type,
       sp.license_number,
       sp.license_expires_at
  from public.specialist_providers sp
 where sp.specialist_type in ('psychology', 'psychiatry')
   and sp.is_active
   and sp.license_verified_at is not null
   and (sp.license_expires_at is null or sp.license_expires_at >= current_date);

comment on view public.therapy_directory is
  'The patient-facing therapy directory. Verified, in-date, active practitioners only. Carries the licence number so a patient can check the registration themselves, and never the commission or contact columns. Ordering is left to the caller and must stay a plain sort the patient controls -- ranking practitioners is the matching-engine guardrail this platform has not opened.';

revoke all on public.therapy_directory from public;
grant select on public.therapy_directory to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The table itself stops being readable by patients and clinicians
-- ---------------------------------------------------------------------------

drop policy if exists specialist_providers_select on public.specialist_providers;
create policy specialist_providers_select on public.specialist_providers
  for select to authenticated
  using (private.is_admin() or private.has_permission('partners.specialists.manage'::text));

comment on policy specialist_providers_select on public.specialist_providers is
  'Admin and partner-manager only, since 2026-09-10. This was `using (true)`, which handed every logged-in patient the commission rates and the partner contact details. Everyone else reads public.specialist_directory or public.therapy_directory. Do not widen this to fix a "specialist list is empty" report -- repoint the caller at a directory view instead.';

-- ---------------------------------------------------------------------------
-- 4. Proof, in both directions, as real sessions
-- ---------------------------------------------------------------------------

do $$
declare
  v_patient uuid;
  v_admin   uuid;
  v_rows    int;
  v_denied  boolean := false;
begin
  select id into v_patient from public.profiles where role = 'patient' limit 1;
  select id into v_admin   from public.profiles where role = 'admin'   limit 1;

  if v_patient is null then
    raise notice 'SKIP: no patient profile to simulate';
  else
    begin
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
      set local role authenticated;

      -- Closed: the table.
      select count(*) into v_rows from public.specialist_providers;
      if v_rows <> 0 then
        reset role;
        raise exception 'FAIL: a patient session can still read % specialist_providers row(s), commission and contact details included.', v_rows;
      end if;

      -- Open: the directory, and it carries the licence number.
      perform 1 from public.specialist_directory limit 1;

      reset role;
    exception when others then
      reset role;
      raise;
    end;
    raise notice 'PASS: patient reads the directory, not the table';
  end if;

  -- The directory must not be able to leak what it is supposed to hide.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name in ('specialist_directory', 'therapy_directory')
       and column_name in ('commission_rate', 'commission_rate_type',
                           'commission_flat_kobo', 'contact_email', 'contact_phone')
  ) then
    raise exception 'FAIL: a directory view exposes a commission or contact column.';
  end if;

  -- And it must carry the licence number, which is the founder decision.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'specialist_directory'
       and column_name = 'license_number'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'therapy_directory'
       and column_name = 'license_number'
  ) then
    raise exception 'FAIL: a directory view is missing license_number, which patients are meant to see.';
  end if;

  if v_admin is not null then
    begin
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select count(*) into v_rows from public.specialist_providers;
      reset role;
    exception when others then
      reset role;
      raise;
    end;
    if v_rows = 0 and (select count(*) from public.specialist_providers) > 0 then
      raise exception 'FAIL: an admin session can no longer read specialist_providers. The partner console is broken.';
    end if;
    raise notice 'PASS: admin still reads the table (% rows)', v_rows;
  end if;

  perform set_config('request.jwt.claims', null, true);
  raise notice 'PASS: commission and contact details are off the patient surface; licence number stays on it';
end $$;

commit;
