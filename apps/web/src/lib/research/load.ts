import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { protocolRowsSchema, type ProtocolRow } from "./model";

export type Loaded<T> = { ok: true; data: T } | { ok: false; denied: boolean };

export async function loadProtocols(): Promise<Loaded<ProtocolRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("research_protocols_list", {});
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = protocolRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}
