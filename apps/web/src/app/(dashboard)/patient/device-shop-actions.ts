"use server";

import { createClient } from "@/lib/supabase/server";
import { deviceAffiliateClickSchema, type DeviceAffiliateClickInput } from "@/lib/validation/device-catalog-click";

/**
 * Logs a "Buy Now" click before the affiliate redirect (Device Pairing &
 * Integration Spec v2 §9.2) — a click-through record only, never payment or
 * order data; the transaction itself is entirely the retailer's. Reuses
 * audit_log rather than a bespoke click table (see the device_catalog
 * migration's header comment on why no parallel table exists here).
 *
 * Best-effort and silent on failure by design: logging must never block or
 * visibly error out the patient's redirect to the retailer. audit_log's own
 * RLS (actor_id = auth.uid()) is enough here — no service role needed.
 */
export async function logDeviceAffiliateClick(input: DeviceAffiliateClickInput): Promise<void> {
  const parsed = deviceAffiliateClickSchema.safeParse(input);
  if (!parsed.success) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("audit_log").insert({
    actor_id: user.id,
    action: "device_affiliate_click",
    entity_type: "device_catalog",
    entity_id: parsed.data.deviceId,
    event: {
      device_name: parsed.data.deviceName,
      category: parsed.data.category,
      affiliate_partner: parsed.data.affiliatePartner,
    },
  });
}
