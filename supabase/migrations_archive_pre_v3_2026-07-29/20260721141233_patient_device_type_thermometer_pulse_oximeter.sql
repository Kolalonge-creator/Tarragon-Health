-- Extend the clinical Bluetooth device catalogue with the two remaining
-- standard GATT profiles that map to existing vital_type values:
-- Health Thermometer (0x1809 -> temperature) and Pulse Oximeter
-- (0x1822 -> spo2). Additive only; no table or RLS changes — readings
-- flow through the existing vitals_readings columns (temperature_c,
-- spo2_pct) via POST /api/mobile/device-readings.
alter type public.patient_device_type add value if not exists 'thermometer';
alter type public.patient_device_type add value if not exists 'pulse_oximeter';
