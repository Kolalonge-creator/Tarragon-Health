import { z } from "zod";

/**
 * spec §52.12 — "My BP machine isn't working": a patient filing a fault
 * report against a device they've paired. Points at the pairing
 * (patient_devices), not the physical device_units registry row directly —
 * a purely patient-owned device may have no device_units row at all, but
 * every reported fault has a patient_devices row (see
 * 20260829121304_device_registry_lifecycle.sql).
 */
export const deviceFaultReportSchema = z.object({
  patient_device_id: z.string().uuid(),
  description: z.string().trim().min(1, "Describe the problem").max(1000),
});

export type DeviceFaultReportInput = z.infer<typeof deviceFaultReportSchema>;
