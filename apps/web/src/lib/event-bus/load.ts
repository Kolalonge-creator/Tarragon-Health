import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@tarragon/shared";
import type { BusFilters } from "./model";

export type SubscriberStatus = Database["public"]["Functions"]["event_bus_subscriber_status"]["Returns"][number];
export type DeliveryRow = Database["public"]["Functions"]["event_bus_explorer"]["Returns"][number];
export type AttemptRow = Database["public"]["Functions"]["event_bus_delivery_attempts"]["Returns"][number];

export const PAGE_SIZE = 50;

/** Every read is an admin-only database function (private.is_admin()); a non-admin gets an error, which shows as a load failure, never as an empty healthy board. */
export async function loadSubscriberStatus(): Promise<{ rows: SubscriberStatus[]; failed: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("event_bus_subscriber_status");
  if (error || !data) return { rows: [], failed: true };
  return { rows: data, failed: false };
}

export async function loadDeliveries(f: BusFilters): Promise<{ rows: DeliveryRow[]; failed: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("event_bus_explorer", {
    p_status: f.status ?? undefined,
    p_subscriber: f.subscriber ?? undefined,
    p_event_type: f.eventType ?? undefined,
    p_before: f.before ?? undefined,
    p_before_id: f.beforeId ?? undefined,
    p_limit: PAGE_SIZE,
  });
  if (error || !data) return { rows: [], failed: true };
  return { rows: data, failed: false };
}

export async function loadAttempts(deliveryId: string): Promise<{ rows: AttemptRow[]; failed: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("event_bus_delivery_attempts", { p_delivery_id: deliveryId });
  if (error || !data) return { rows: [], failed: true };
  return { rows: data, failed: false };
}
