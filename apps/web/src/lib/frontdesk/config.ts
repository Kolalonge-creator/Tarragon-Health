import type { SupabaseClient } from "@supabase/supabase-js";
import { fdSelect } from "./raw-db";

/** The slice of fd_app_config the chat reads. Every value is validated here as well as in the database, and a missing or malformed one takes the SAFE reading. */
export interface ChatConfig {
  /** The kill switch. Anything but an explicit true is off (the widget shows the contact form). */
  readonly assistantEnabled: boolean;
  readonly prelaunch: boolean;
  readonly launchDate: string | null;
  readonly modelFast: string;
  readonly modelStrong: string;
  /** USD per day. Missing or invalid means 0: the chat refuses to spend until it is set. */
  readonly dailySpendCapUsd: number;
}

interface ConfigRow {
  key: string;
  value: unknown;
}

export function parseChatConfig(rows: readonly ConfigRow[]): ChatConfig {
  const v = new Map(rows.map((r) => [r.key, r.value]));
  const str = (k: string, d: string): string => (typeof v.get(k) === "string" && (v.get(k) as string).trim() !== "" ? (v.get(k) as string) : d);
  const cap = v.get("daily_model_spend_cap_usd");
  const date = v.get("launch_date");
  return {
    assistantEnabled: v.get("assistant_enabled") === true,
    // Pre-launch is the cautious default: unless it is explicitly false the assistant does not sell.
    prelaunch: v.get("prelaunch_mode") !== false,
    launchDate: typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    modelFast: str("model_fast", "claude-haiku-4-5"),
    modelStrong: str("model_strong", "claude-sonnet-4-5"),
    dailySpendCapUsd: typeof cap === "number" && Number.isFinite(cap) && cap > 0 ? cap : 0,
  };
}

export async function loadChatConfig(supabase: SupabaseClient): Promise<{ config: ChatConfig; ok: boolean }> {
  const res = await fdSelect<ConfigRow>(supabase, "fd_app_config", "key, value", "key");
  // A failed read must not look like an enabled assistant: it parses to the safe defaults (off).
  return { config: parseChatConfig(res.error ? [] : res.rows), ok: res.error === null };
}

export function formatLaunchDate(iso: string | null): string {
  if (!iso) return "soon";
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "soon" : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
