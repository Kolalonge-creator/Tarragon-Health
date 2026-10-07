import { createClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { parseOpenResult, type ShareOpenResult } from "./share-page";

const TOKEN_SHAPE = /^[A-Za-z0-9]{32,128}$/;

export interface ShareOpenClient {
  rpc: (fn: "record_share_open", args: { p_token: string; p_pin?: string }) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

function anonClient(): ShareOpenClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as ShareOpenClient;
}

/**
 * Opens a share link through the one database door, record_share_open, as the
 * anonymous role. A token that cannot be a token never reaches the database.
 * Any failure to ask reads as "not found", never as a guess about the link.
 */
export async function openShare(token: string, pin: string | null, client: ShareOpenClient | null = anonClient()): Promise<ShareOpenResult> {
  if (!TOKEN_SHAPE.test(token) || !client) return { status: "not_found" };
  const args: { p_token: string; p_pin?: string } = { p_token: token };
  if (pin && /^[0-9]{1,8}$/.test(pin)) args.p_pin = pin;
  const { data, error } = await client.rpc("record_share_open", args);
  if (error) return { status: "not_found" };
  return parseOpenResult(data);
}
