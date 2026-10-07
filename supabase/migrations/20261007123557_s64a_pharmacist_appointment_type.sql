-- S64a: a pharmacist can be booked as a remote consultation (Q23: dietitian, pharmacist and specialist bookings are priced per item).
-- 'dietitian' already exists in appointment_type; 'pharmacist' does not. ALTER TYPE ... ADD VALUE cannot be used in the same
-- transaction as anything that uses the new value, so this is its own file; s64b_consultation_gaps (the next version) uses it.
alter type public.appointment_type add value if not exists 'pharmacist';
