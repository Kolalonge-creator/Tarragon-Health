-- S64 (decision 2026-10-15): a dietitian or pharmacist visit is NOT doctor time, so it may be sold per item (S64 Q23: offered only while its price is set).
-- The two-tier constraint service_products_doctor_time_not_sellable closes every product whose code ends in _credit, which caught
-- dietitian_consult_credit and pharmacist_consult_credit by name only. They are exempted by exact code, exactly as second_opinion_credit is; every
-- other doctor-time product stays closed. Both products are still inactive with a zero price until an admin sets one, so no row changes here.
alter table public.service_products drop constraint service_products_doctor_time_not_sellable;
alter table public.service_products add constraint service_products_doctor_time_not_sellable
  check (code !~ '(_credit$|^verified_document|^chronic_doctor_supported_pack$|^written_result_interpretation$|^preventive_health_check_review$|^ai_coach_daily_pass_30d$|^continuous_monitoring_)'
         or not is_active or code in ('second_opinion_credit', 'dietitian_consult_credit', 'pharmacist_consult_credit'));

do $$
begin
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'service_products_doctor_time_not_sellable')) not like '%dietitian_consult_credit%' then
    raise exception 'FAIL: the dietitian exemption is missing from the constraint';
  end if;
  if exists (select 1 from public.service_products where is_active and code ~ '(_credit$|^verified_document|^chronic_doctor_supported_pack$|^written_result_interpretation$|^preventive_health_check_review$)'
                and code not in ('second_opinion_credit', 'dietitian_consult_credit', 'pharmacist_consult_credit')) then
    raise exception 'FAIL: a doctor-time product is sellable';
  end if;
end $$;
