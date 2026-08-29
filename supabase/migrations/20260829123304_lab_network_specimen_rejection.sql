-- Laboratory Network, part 6: sample rejection with automatic recollection
-- (§56.10).
--
-- All five reasons the spec names are the kind of problem a redraw fixes,
-- not the kind that means the test itself was wrong to order — so every
-- rejection here initiates a recollection pathway, matching "the system
-- should automatically initiate a recollection pathway where appropriate".
-- The new specimen is linked via recollection_of so the full chain (how many
-- attempts, why each failed) stays on the record rather than being
-- overwritten.

create or replace function public.lab_partner_reject_specimen(
  p_specimen_id uuid,
  p_reason      public.lab_specimen_rejection_reason,
  p_notes       text default null
)
returns public.lab_specimens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_specimen  public.lab_specimens%rowtype;
  v_new       public.lab_specimens%rowtype;
  v_patient   public.profiles%rowtype;
  v_provider  public.lab_providers%rowtype;
begin
  select * into v_specimen from public.lab_specimens where id = p_specimen_id;
  if v_specimen.id is null then
    raise exception 'specimen not found' using errcode = '42501';
  end if;
  -- Same explicit-null-check shape as lab_partner_update_specimen_status —
  -- see that function's comment for why `<>` alone is an authorization
  -- bypass here (NULL from a non-lab-partner caller silently skips the
  -- `if ... then raise`, rather than refusing).
  if v_specimen.provider_id is null
     or private.lab_partner_provider() is null
     or v_specimen.provider_id <> private.lab_partner_provider() then
    raise exception 'not authorized for this specimen' using errcode = '42501';
  end if;
  if v_specimen.status = 'rejected' then
    raise exception 'this specimen is already rejected' using errcode = '23514';
  end if;
  if v_specimen.status = 'completed' then
    raise exception 'a completed specimen cannot be rejected — its result is already on file' using errcode = '23514';
  end if;

  update public.lab_specimens
     set status = 'rejected',
         rejected_at = now(),
         rejection_reason = p_reason,
         rejection_notes = p_notes
   where id = p_specimen_id
   returning * into v_specimen;

  -- The recollection pathway: a fresh specimen, same order, chained back to
  -- the one that failed. collection_method carries over — a home-collected
  -- specimen that was rejected still needs a new home visit, not a walk-in.
  insert into public.lab_specimens (
    organisation_id, lab_order_id, patient_id, provider_id, collection_method, recollection_of
  ) values (
    v_specimen.organisation_id, v_specimen.lab_order_id, v_specimen.patient_id,
    v_specimen.provider_id, v_specimen.collection_method, v_specimen.id
  )
  returning * into v_new;

  select * into v_patient from public.profiles where id = v_specimen.patient_id;
  select * into v_provider from public.lab_providers where id = v_specimen.provider_id;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (
    v_specimen.organisation_id, v_specimen.patient_id, 'in_app', 'pending',
    'lab_specimen_rejected_recollection_needed',
    jsonb_build_object(
      'specimen_number', v_specimen.specimen_number,
      'new_specimen_number', v_new.specimen_number,
      'reason', p_reason::text,
      'provider_name', coalesce(v_provider.name, 'the lab'),
      'patient_name', coalesce(v_patient.full_name, 'there')
    )
  );

  -- Staff visibility too — this is exactly the kind of operational event
  -- §56.13's dashboard exists to surface, and org staff may not otherwise
  -- see a lab-partner-side rejection until they look.
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select v_specimen.organisation_id, cs.id, 'in_app', 'pending',
         'lab_specimen_rejected_recollection_needed_staff',
         jsonb_build_object(
           'specimen_number', v_specimen.specimen_number,
           'order_id', v_specimen.lab_order_id,
           'reason', p_reason::text
         )
    from public.clinical_staff cs
   where cs.organisation_id = v_specimen.organisation_id
     and cs.active
     and cs.is_clinical_director;

  return v_new;
end;
$$;

revoke all on function public.lab_partner_reject_specimen(uuid, public.lab_specimen_rejection_reason, text) from public, anon;
grant execute on function public.lab_partner_reject_specimen(uuid, public.lab_specimen_rejection_reason, text) to authenticated;

-- A full simulated-session proof (ownership refusal, recollection chain,
-- notification fan-out) belongs in packages/db/tests — the established
-- pattern for that (see lab_partner_rls.sql: set_config('request.jwt.claims',
-- ...) + set role authenticated, wrapped in its own begin/rollback) is a
-- standalone verification script run after migrations apply, not writes
-- embedded inside a migration transaction. See
-- packages/db/tests/lab_specimen_rejection_recollection.sql.
do $$
begin
  if not exists (
    select 1 from pg_proc
    where proname = 'lab_partner_reject_specimen' and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'lab_partner_reject_specimen was not created';
  end if;
  if not has_function_privilege('authenticated', 'public.lab_partner_reject_specimen(uuid, public.lab_specimen_rejection_reason, text)', 'EXECUTE') then
    raise exception 'authenticated must be able to execute lab_partner_reject_specimen';
  end if;
  if has_function_privilege('anon', 'public.lab_partner_reject_specimen(uuid, public.lab_specimen_rejection_reason, text)', 'EXECUTE') then
    raise exception 'anon must not be able to execute lab_partner_reject_specimen — see the anon/PUBLIC EXECUTE gotcha in CLAUDE.md';
  end if;
end $$;
