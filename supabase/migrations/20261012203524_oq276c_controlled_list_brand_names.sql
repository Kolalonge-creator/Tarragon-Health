-- OQ-276 brand-name gap (CMO decision 2026-10-12: close it). The controlled-medicines list named generics only, so a prescription or supply written under a brand
-- (Tramal, Valium, Ativan, Xanax ...) or a combination (co-codamol) passed signing and the counter. This widens the ONE list, private.is_controlled_medicine,
-- which already drives signing and every counter and QR path, so nothing else changes.
--
-- Added: brands of the listed generics (tramadol: Tramal, Ultram, Ultracet, Tramacet, Zydol; diazepam: Valium, Diazemuls; lorazepam: Ativan; alprazolam: Xanax;
-- clonazepam: Rivotril, Klonopin; midazolam: Dormicum; chlordiazepoxide: Librium; methylphenidate: Ritalin, Concerta; amphetamines: Adderall, Dexedrine, Vyvanse;
-- phenobarbital: Luminal; ketamine: Ketalar; oxycodone: OxyContin, OxyNorm, Percocet; fentanyl: Duragesic, Sublimaze; pethidine: Demerol), codeine products and
-- combinations (Phensedyl, Solpadeine, Panadeine, co-codamol, co-dydramol, with or without the hyphen), and the generic bromazepam with its brand Lexotan
-- (a benzodiazepine in common Nigerian use). Still an illustrative list, not a verified NDLEA schedule (OQ-170); the CMO owns its content.
--
-- Rows affected live (checked 2026-10-12): 0 clinician medications and 0 prescriptions name any added word, so there is no conversion step.
-- Word boundaries are \m and \M (Postgres); \b would be a backspace. Same signature, volatility and grants as before (create or replace keeps them).

create or replace function private.is_controlled_medicine(p_name text)
returns boolean
language sql immutable security definer set search_path = ''
as $$
  select lower(btrim(coalesce(p_name, ''))) ~* '\m(morphine|pethidine|meperidine|fentanyl|oxycodone|hydrocodone|methadone|diamorphine|codeine|tramadol|dihydrocodeine|diazepam|lorazepam|alprazolam|midazolam|clonazepam|chlordiazepoxide|methylphenidate|amphetamine|dexamfetamine|dextroamphetamine|lisdexamfetamine|phenobarbital|phenobarbitone|ketamine|bromazepam|tramal|ultram|ultracet|tramacet|zydol|valium|diazemuls|ativan|xanax|rivotril|klonopin|lexotan|dormicum|librium|ritalin|concerta|adderall|dexedrine|vyvanse|luminal|ketalar|oxycontin|oxynorm|percocet|duragesic|sublimaze|demerol|phensedyl|solpadeine|panadeine|co-?codamol|co-?dydramol)\M'
$$;

do $$
declare v_name text; v_bad text;
begin
  -- every added word is controlled, in a realistic written form
  foreach v_name in array array['Tramal 50mg', 'Valium 5mg tablets', 'ATIVAN 1 mg', 'Xanax XR', 'Rivotril 0.5mg', 'Lexotan 3mg', 'Ritalin LA', 'Adderall', 'Percocet 5/325',
                                'Phensedyl syrup', 'Solpadeine Max', 'Panadeine Extra', 'co-codamol 30/500', 'cocodamol', 'Co-Dydramol', 'bromazepam']
  loop
    if not private.is_controlled_medicine(v_name) then raise exception 'OQ-276c: % should be controlled', v_name; end if;
  end loop;
  -- ordinary medicines and look-alike words stay uncontrolled
  foreach v_name in array array['Amlodipine 5mg', 'Metformin 500mg', 'Paracetamol 500mg', 'Panadol Extra', 'Ventolin', 'Ultrasound gel', 'Concertina', 'Lumina cream', 'Valiumx']
  loop
    if private.is_controlled_medicine(v_name) then raise exception 'OQ-276c: % must not be controlled', v_name; end if;
  end loop;
  -- still one copy of the list
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.proname <> 'is_controlled_medicine' and p.prosrc ~* '\yxanax\y';
  if v_bad is not null then raise exception 'OQ-276c: a second copy of the list lives in: %', v_bad; end if;
  if has_function_privilege('anon', 'private.is_controlled_medicine(text)', 'EXECUTE') or has_function_privilege('authenticated', 'private.is_controlled_medicine(text)', 'EXECUTE') then
    raise exception 'OQ-276c: the list function became callable by a client role';
  end if;
end $$;
