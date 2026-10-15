"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * S52 (spec 7.12): the patient's own memory screen. Everything runs on the patient's own session: the consent and the delete-all go
 * through their database functions, the items through RLS (patient only). A trigger in the database enforces the consent, the cap, the
 * length and the "goals and preferences, never a clinical fact" rule, so a failure comes back as a plain message to show, never a
 * silent success.
 */
export type MemoryState = {
  available: boolean;
  consented: boolean;
  textVersion: string;
  maxItems: number;
  maxChars: number;
  items: { id: string; kind: "goal" | "preference"; text: string }[];
};

export type MemoryResult = { ok: true } | { ok: false; error: string };

const itemSchema = z.object({ kind: z.enum(["goal", "preference"]), text: z.string().trim().min(3, "Write a little more").max(400) });

/** The database's own messages, turned into words a patient can act on. */
function friendly(message: string | undefined): string {
  const m = message ?? "";
  if (m.includes("assistant_memory_clinical_content")) return "Keep this to a goal or a preference. Health details stay in your record.";
  if (m.includes("assistant_memory_too_long")) return "That is a little long. Please shorten it.";
  if (m.includes("assistant_memory_full")) return "You have reached the limit. Remove one first.";
  if (m.includes("assistant_memory_consent_required")) return "Switch the memory on first.";
  if (m.includes("assistant_memory_not_available")) return "The memory is not switched on yet.";
  return "Something went wrong. Please try again.";
}

export async function getMemoryStateAction(): Promise<MemoryState | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: state, error } = await supabase.rpc("assistant_memory_state");
  if (error || !state || typeof state !== "object" || Array.isArray(state)) return null;
  const s = state as Record<string, unknown>;
  const { data: items } = await supabase.from("assistant_memory_items").select("id, kind, text").order("created_at");
  return {
    available: s.available === true,
    consented: s.consented === true,
    textVersion: String(s.text_version ?? ""),
    maxItems: Number(s.max_items ?? 30),
    maxChars: Number(s.max_chars ?? 200),
    items: (items ?? []).filter((i): i is { id: string; kind: "goal" | "preference"; text: string } => i.kind === "goal" || i.kind === "preference"),
  };
}

export async function setMemoryConsentAction(granted: boolean): Promise<MemoryResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("assistant_memory_set_consent", { p_granted: granted });
  return error ? { ok: false, error: friendly(error.message) } : { ok: true };
}

export async function addMemoryItemAction(input: { kind: string; text: string }): Promise<MemoryResult> {
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check what you wrote" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const { error } = await supabase.from("assistant_memory_items").insert({ patient_id: user.id, kind: parsed.data.kind, text: parsed.data.text });
  return error ? { ok: false, error: friendly(error.message) } : { ok: true };
}

export async function updateMemoryItemAction(id: string, text: string): Promise<MemoryResult> {
  const parsed = z.object({ id: z.string().uuid(), text: z.string().trim().min(3).max(400) }).safeParse({ id, text });
  if (!parsed.success) return { ok: false, error: "Check what you wrote" };
  const supabase = await createClient();
  const { error } = await supabase.from("assistant_memory_items").update({ text: parsed.data.text }).eq("id", parsed.data.id);
  return error ? { ok: false, error: friendly(error.message) } : { ok: true };
}

export async function deleteMemoryItemAction(id: string): Promise<MemoryResult> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "Unknown item" };
  const supabase = await createClient();
  const { error } = await supabase.from("assistant_memory_items").delete().eq("id", parsed.data);
  return error ? { ok: false, error: friendly(error.message) } : { ok: true };
}

export async function deleteAllMemoryAction(): Promise<MemoryResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("assistant_memory_delete_all");
  return error ? { ok: false, error: friendly(error.message) } : { ok: true };
}

/** The patient's own memory as JSON text, for them to keep. Audit-logged in the database. */
export async function exportMemoryAction(): Promise<{ ok: true; json: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assistant_memory_export");
  if (error || data === null) return { ok: false, error: "Could not export just now. Please try again." };
  return { ok: true, json: JSON.stringify(data, null, 2) };
}
