import { z } from "zod";

/** Input to logDeviceAffiliateClick — the in-app Shop's "Buy Now" click log
 * (Device Pairing & Integration Spec v2 §9.2). Denormalised fields
 * (deviceName/category/affiliatePartner) are logged alongside deviceId so the
 * audit_log event JSON stays readable without a join back to device_catalog,
 * matching how the row would look at the moment the patient clicked even if
 * the catalog row changes later. */
export const deviceAffiliateClickSchema = z.object({
  deviceId: z.string().uuid(),
  deviceName: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(60),
  affiliatePartner: z.string().trim().max(60).nullable(),
});

export type DeviceAffiliateClickInput = z.infer<typeof deviceAffiliateClickSchema>;
