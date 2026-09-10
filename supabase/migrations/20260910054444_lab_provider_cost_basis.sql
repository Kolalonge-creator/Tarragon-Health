-- Record WHERE a laboratory's recorded prices came from, so the question that
-- caused all of this cannot quietly go stale again.
-- Founder decision, 2026-09-10.
--
-- WHY THIS COLUMN EXISTS
-- ----------------------
-- public.lab_tests.price_kobo was documented from 20260821191743 onward as
-- "what SynLab charges Tarragon" -- our negotiated cost. On 2026-09-10 it was
-- found to match SynLab's own PUBLISHED CONSUMER price on eleven tests, several
-- to the naira. Nobody lied and nothing was corrupted: a number was written
-- down once, described as a contract rate, and never carried any record of
-- where it actually came from. Every price on the platform then derived from
-- it, and the platform ended up ~30% dearer than the laboratory performing the
-- test, on every item in the catalogue.
--
-- A comment in a migration did not prevent that, because a comment is not
-- attached to the data. This is:
--
--   cost_basis                'published_list' or 'contracted_invoice'
--   cost_basis_verified_at    when a human last checked it against a document
--   cost_basis_verified_by    who
--   cost_basis_note           what document, so the next person can re-check
--
-- Every provider starts at 'published_list' with verified_at NULL, which is the
-- truthful state: no invoice has been sighted. Patient-facing guidance already
-- says "at a major private laboratory" rather than quoting a contract, and that
-- wording is now backed by a field instead of by good intentions.
--
-- WHAT SHOULD HAPPEN NEXT, AND WHAT MUST NOT
-- ------------------------------------------
-- Someone compares SynLab's actual invoice against these figures and records
-- the result. If a negotiated discount does exist and was simply never entered,
-- this stops being a pricing problem and becomes a data problem with a
-- different fix -- correct lab_tests and reconsider whether Tarragon can sell
-- tests after all.
--
-- What must NOT happen is anyone setting cost_basis = 'contracted_invoice'
-- without a document in hand. The guard below refuses that: claiming a
-- contracted basis requires naming the evidence and stamping who checked it.
-- Marking something verified is exactly the kind of assertion that is worthless
-- unless it is hard to make carelessly.

begin;

alter table public.lab_providers
  add column if not exists cost_basis             text not null default 'published_list',
  add column if not exists cost_basis_verified_at timestamptz,
  add column if not exists cost_basis_verified_by uuid references public.profiles(id) on delete set null,
  add column if not exists cost_basis_note        text;

alter table public.lab_providers
  drop constraint if exists lab_providers_cost_basis_known;
alter table public.lab_providers
  add constraint lab_providers_cost_basis_known
  check (cost_basis in ('published_list', 'contracted_invoice'));

-- A contracted basis is a claim about a document. It requires the document to
-- be named and the check to be attributed, or it is just a checkbox.
alter table public.lab_providers
  drop constraint if exists lab_providers_contracted_basis_needs_evidence;
alter table public.lab_providers
  add constraint lab_providers_contracted_basis_needs_evidence
  check (
    cost_basis <> 'contracted_invoice'
    or (cost_basis_verified_at is not null
        and cost_basis_verified_by is not null
        and coalesce(btrim(cost_basis_note), '') <> '')
  );

comment on column public.lab_providers.cost_basis is
  'Where this provider''s recorded lab_tests prices came from. ''published_list'' means their public consumer price list -- which is what Tarragon was unknowingly marking up until 2026-09-10. ''contracted_invoice'' means a real negotiated rate someone has sighted, and the CHECK constraint refuses that value without the evidence named and the check attributed.';
comment on column public.lab_providers.cost_basis_note is
  'Which document was checked, in enough detail that the next person can find it again. Required for a contracted basis.';

update public.lab_providers
   set cost_basis      = 'published_list',
       cost_basis_note = coalesce(cost_basis_note,
         'Recorded prices match this provider''s published consumer price list (checked 2026-09-10 for SYNLAB Nigeria across eleven tests, several matching to the naira). No invoice has been sighted, so no negotiated discount is evidenced.')
 where cost_basis_verified_at is null;

-- Readable by the staff who see the catalogue; only an admin may assert a
-- basis. RLS restricts rows, it does not grant table access, so the grant is
-- separate and necessary.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'lab_providers'
       and policyname = 'lab_providers_cost_basis_admin_write'
  ) then
    create policy lab_providers_cost_basis_admin_write on public.lab_providers
      for update to authenticated
      using (private.is_admin())
      with check (private.is_admin());
  end if;
end $$;

do $$
declare
  v_bad int;
  v_refused boolean := false;
begin
  select count(*) into v_bad
    from public.lab_providers
   where cost_basis not in ('published_list', 'contracted_invoice');
  if v_bad <> 0 then
    raise exception 'FAIL: % provider(s) carry an unknown cost_basis', v_bad;
  end if;

  -- Prove the evidence requirement actually bites rather than merely existing.
  begin
    update public.lab_providers set cost_basis = 'contracted_invoice' where is_active;
  exception when check_violation then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'FAIL: a contracted cost basis was accepted with no evidence, no verifier and no date.';
  end if;

  raise notice 'PASS: every provider records where its prices came from; an unevidenced contract claim is refused';
end $$;

commit;
