-- Tarragon Health — Finance subsystem: capability keys + the is_finance() gate.
--
-- Mirrors private.is_analyst() exactly: role in ('finance','admin'). Additionally
-- honours the RBAC layer so the super admin can delegate a specific finance
-- surface to any member via a grant/custom-role bundle without handing over the
-- whole finance role (has_permission('finance.view')). All finance data access
-- goes through SECURITY DEFINER RPCs gated by this one predicate — the finance
-- tables carry RLS ON with no policies, same as the analytics governance tables.

insert into public.permissions (key, label, category, description) values
  ('finance.view',            'View finance console',        'Finance', 'Read the general ledger, statements, reconciliation, tax and revenue-recognition surfaces.'),
  ('finance.gl.post',         'Post journal entries',        'Finance', 'Create manual/adjusting journal entries and reversals.'),
  ('finance.periods.manage',  'Manage accounting periods',   'Finance', 'Open, close and lock accounting periods.'),
  ('finance.reconcile',       'Reconcile settlements',       'Finance', 'Import provider settlement batches and match them to captured payments.'),
  ('finance.tax.manage',      'Manage tax configuration',    'Finance', 'Edit tax rates and per-account VAT treatment; finalise tax periods.'),
  ('finance.export',          'Export finance data',         'Finance', 'Export ledger, statements and tax reports.')
on conflict (key) do nothing;

create or replace function private.is_finance()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('finance', 'admin')
  )
  or private.has_permission('finance.view');
$$;
