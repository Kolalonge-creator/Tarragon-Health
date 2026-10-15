"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { filtersToQuery, parseFilters } from "./model";

/**
 * Replay one delivery from the event explorer. The database function (replay_event_delivery) is admin only, refuses a delivery that
 * is running right now, resets it and writes the audit row; this action only checks the role first for a clear result. The result
 * travels as one of three fixed words in the address (never free text), so a link cannot put sentences on the page.
 */
const PATH = "/admin/ops/event-bus";
const idSchema = z.string().uuid();

function back(form: FormData, result: "ok" | "failed" | "busy"): never {
  const get = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : undefined);
  const filters = parseFilters({ status: get("status"), subscriber: get("subscriber"), type: get("type") });
  const q = filtersToQuery(filters);
  redirect(`${PATH}${q}${q ? "&" : "?"}r=${result}`);
}

export async function replayDeliveryAction(form: FormData): Promise<void> {
  if ((await getCurrentProfile())?.role !== "admin") return back(form, "failed");
  const id = idSchema.safeParse(form.get("delivery_id"));
  if (!id.success) return back(form, "failed");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("replay_event_delivery", { p_delivery_id: id.data, p_redo_effects: false });
  revalidatePath(PATH);
  if (error?.code === "55P03") return back(form, "busy");
  if (error || data !== true) return back(form, "failed");
  return back(form, "ok");
}
