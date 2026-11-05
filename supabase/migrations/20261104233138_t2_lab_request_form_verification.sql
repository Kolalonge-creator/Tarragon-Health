-- T2 Phase 3, part 1 of 3: every printed laboratory request form can be checked as genuine, with no login.
--
-- Brief section 6.3: each request form carries a unique verification code and a QR code for authenticity checking, and must not
-- imply the laboratory is contracted or obliged to accept it. Copies the prescription pattern (20261001203545, /verify-rx/[token]).
--
--  1. lab_orders.request_verification_token (64 hex, more than 240 bits, the QR credential) and
--     lab_orders.request_verification_code (10 characters of an unambiguous alphabet, printed as XXXXX-XXXXX, 50 bits, for a person
--     typing it in). Both are stamped by a BEFORE INSERT trigger on EVERY insert path (a caller cannot choose its own value: anything
--     supplied is overwritten), never change afterwards (a BEFORE UPDATE trigger puts the old values back), and are backfilled for
--     existing rows. The backfill disables user triggers for the one UPDATE, as the prescription backfill did: lab_orders carries
--     about 30 triggers (notifications, commissions, timeline) and none of them should fire for a column that is not clinical.
--  2. public.verify_lab_request_public(p_ref text): SECURITY DEFINER, anon-executable on purpose (added to the anon allowlist test, the
--     S39 security catalogue, the release-integrity allowlist and docs/security/ANON-EXECUTABLE-FUNCTIONS.md). Accepts the token or the
--     code. Returns proof only: status, reference number, issue date, the tests listed, the patient's INITIALS, and who requested it
--     (the clinician's name and verified registration, or "the patient's preventive schedule"). It returns no patient name, date of
--     birth, patient number or contact detail, and no price. Unknown, malformed or ambiguous input returns zero rows.
--     Rate limiting is applied by the page that calls it.
--
-- Counts before this migration (local replay): no column of either name exists. Nothing is switched on or off.

alter table public.lab_orders
  add column if not exists request_verification_token text,
  add column if not exists request_verification_code text;

comment on column public.lab_orders.request_verification_token is
  'T2-P3: 64-hex bearer credential carried by the QR on the printed request form; checked by public.verify_lab_request_public(). Stamped at insert, never changed. Never log it or put it in a notification.';
comment on column public.lab_orders.request_verification_code is
  'T2-P3: 10-character human-typeable verification code printed on the request form (shown as XXXXX-XXXXX). Same check as the token. Stamped at insert, never changed.';

-- An alphabet with no 0/O, 1/I/L or U: what a person reads off paper is what they type.
create or replace function private.new_request_verification_code() returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_alpha constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(10);
  v_out text := '';
  i integer;
begin
  for i in 0..9 loop
    v_out := v_out || substr(v_alpha, 1 + (get_byte(v_bytes, i) % length(v_alpha)), 1);
  end loop;
  return v_out;
end $$;

create or replace function private.new_request_verification_token() returns text
language sql volatile security definer set search_path = ''
as $$ select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') $$;

create or replace function private.stamp_lab_request_verification() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- always generated here: a client-supplied value is never kept
    new.request_verification_token := private.new_request_verification_token();
    new.request_verification_code := private.new_request_verification_code();
  else
    new.request_verification_token := old.request_verification_token;
    new.request_verification_code := old.request_verification_code;
  end if;
  return new;
end $$;

revoke all on function private.new_request_verification_code(), private.new_request_verification_token(),
  private.stamp_lab_request_verification() from public, anon, authenticated;

alter table public.lab_orders disable trigger user;
update public.lab_orders
   set request_verification_token = private.new_request_verification_token(),
       request_verification_code = private.new_request_verification_code()
 where request_verification_token is null or request_verification_code is null;
alter table public.lab_orders enable trigger user;

-- zz so it runs after every other BEFORE trigger (force_safe_patient_insert and friends rewrite NEW)
create trigger lab_orders_zzz_stamp_request_verification
  before insert or update of request_verification_token, request_verification_code on public.lab_orders
  for each row execute function private.stamp_lab_request_verification();

create unique index if not exists lab_orders_request_verification_token_key on public.lab_orders (request_verification_token);
create unique index if not exists lab_orders_request_verification_code_key on public.lab_orders (request_verification_code);
alter table public.lab_orders alter column request_verification_token set not null;
alter table public.lab_orders alter column request_verification_code set not null;
alter table public.lab_orders add constraint lab_orders_request_verification_token_shape check (request_verification_token ~ '^[0-9a-f]{64}$');
-- lab_orders is read through COLUMN grants (20261007190500 keeps partner cost off the authenticated surface), so a new column is
-- invisible to every signed-in reader until granted. The patient's own PDF route reads these two with the patient's session.
-- SELECT is the only grant added; a value a client supplies on insert or update is thrown away by the trigger.
grant select (request_verification_token, request_verification_code) on public.lab_orders to authenticated;
alter table public.lab_orders add constraint lab_orders_request_verification_code_shape check (request_verification_code ~ '^[2-9A-HJKMNP-TV-Z]{10}$');

-- "A. O." from "Adaeze Okafor"; at most three initials; nothing when there is no name
create or replace function private.name_initials(p_name text) returns text
language sql immutable set search_path = ''
as $$
  select nullif(string_agg(upper(left(w, 1)) || '.', ' ' order by o), '')
    from (select w, o from regexp_split_to_table(btrim(coalesce(p_name, '')), '\s+') with ordinality as t(w, o)
           where w ~ '^[[:alpha:]]' order by o limit 3) x
$$;
revoke all on function private.name_initials(text) from public, anon, authenticated;

create or replace function public.verify_lab_request_public(p_ref text)
returns table (
  status text,
  order_number text,
  issued_on date,
  tests text[],
  patient_initials text,
  requested_by text,
  requester_registration text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ref text := upper(regexp_replace(coalesce(p_ref, ''), '[\s-]', '', 'g'));
  o public.lab_orders%rowtype;
  v_tests text[];
  v_name text;
  v_reg text;
begin
  if v_ref ~ '^[0-9A-F]{64}$' then
    select * into o from public.lab_orders lo where lo.request_verification_token = lower(v_ref);
  elsif v_ref ~ '^[2-9A-HJKMNP-TV-Z]{10}$' then
    select * into o from public.lab_orders lo where lo.request_verification_code = v_ref;
  else
    return;
  end if;
  if o.id is null then return; end if;

  -- the same list the PDF prints: the bundle's tests by catalogue name, else the signed annual panel's labels
  select coalesce(array_agg(lt.name order by array_position(pb.test_codes, lt.code)), '{}')
    into v_tests
    from public.panel_bundles pb join public.lab_tests lt on lt.code = any (pb.test_codes)
   where pb.id = o.panel_bundle_id;
  if coalesce(cardinality(v_tests), 0) = 0 and o.panel_code is not null then
    select coalesce(array_agg((a ->> 'label') || case when (a ->> 'optional')::boolean is true then ' (only if the doctor asks)' else '' end
                              order by ord), '{}')
      into v_tests
      from public.lab_panel_versions pv, jsonb_array_elements(pv.analytes) with ordinality as x(a, ord)
     where pv.panel_code = o.panel_code and pv.is_active and jsonb_typeof(a) = 'object' and a ? 'label';
  end if;

  if o.ordered_by is not null then
    select p.full_name into v_name from public.profiles p where p.id = o.ordered_by;
    select cs.credential_type || ' ' || cs.credential_number into v_reg
      from public.clinical_staff cs
     where cs.profile_id = o.ordered_by
       and cs.license_verified_at is not null
       and (cs.license_expires_at is null or cs.license_expires_at > now())
       and cs.credential_type is not null and cs.credential_number is not null
       and cs.credential_number !~* '(pending|placeholder|tbc|tbd)'
     limit 1;
  end if;

  return query select
    case when o.status = 'cancelled' then 'cancelled'
         when o.status = 'resulted' then 'used'
         else 'valid' end,
    o.order_number,
    (o.ordered_at at time zone 'Africa/Lagos')::date,
    coalesce(v_tests, '{}'),
    private.name_initials((select p.full_name from public.profiles p where p.id = o.patient_id)),
    case when o.ordered_by is null then 'the patient''s TarragonHealth preventive schedule'
         else coalesce(v_name, 'TarragonHealth care team') end,
    v_reg;
end;
$$;

revoke all on function public.verify_lab_request_public(text) from public;
grant execute on function public.verify_lab_request_public(text) to anon, authenticated;

do $$
begin
  if not has_function_privilege('anon', 'public.verify_lab_request_public(text)', 'EXECUTE') then
    raise exception 'verify_lab_request_public must be anon-executable: that is the feature';
  end if;
  if has_function_privilege('anon', 'private.stamp_lab_request_verification()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.new_request_verification_code()', 'EXECUTE')
     or has_function_privilege('anon', 'private.name_initials(text)', 'EXECUTE') then
    raise exception 'a private verification helper is callable by a client role';
  end if;
  -- (insert and update stay as the table grants them; the trigger throws any supplied value away, proven in the proof)
  if not has_column_privilege('authenticated', 'public.lab_orders', 'request_verification_token', 'SELECT')
     or not has_column_privilege('authenticated', 'public.lab_orders', 'request_verification_code', 'SELECT')
     or has_column_privilege('anon', 'public.lab_orders', 'request_verification_token', 'SELECT') then
    raise exception 'the verification columns must be readable by a signed-in reader and not by anon';
  end if;
  if exists (select 1 from public.lab_orders where request_verification_token is null or request_verification_code is null) then
    raise exception 'a lab order has no verification token or code';
  end if;
  if private.name_initials('Adaeze  Ngozi Okafor Bello') <> 'A. N. O.' or private.name_initials(null) is not null then
    raise exception 'name_initials is wrong';
  end if;
end $$;

select private.rebuild_analytics_clean_views();
