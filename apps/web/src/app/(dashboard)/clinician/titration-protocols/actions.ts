"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { validateProtocolDefinition } from "@tarragon/clinical/titration";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PROTOCOL_CODE_PATTERN, parseDefinitionText, withBookkeeping, type CheckState } from "@/lib/protocols/titration-review";

/**
 * The Chief Medical Officer's step table actions (S24b). Check never saves. Save as draft saves only after the same
 * validation passes. Approve runs only from the confirmation step, re-validates the stored draft first and refuses on
 * any error. All of it runs under the signed-in CMO's own session; the database refuses anyone else (42501), so the
 * check here is a courtesy and a clear message, not the protection. No definition is ever supplied by this code.
 */
const PATH = "/clinician/titration-protocols";
const NOT_CMO = "Only the Chief Medical Officer can do this.";

const codeSchema = z.string().trim().regex(PROTOCOL_CODE_PATTERN, "The protocol code is lowercase letters, digits and underscores, starting with a letter.");
const noteSchema = z.string().trim().max(500, "The note is 500 characters at most.").optional();
const definitionTextSchema = z.string().max(200_000, "That definition is too long.");

type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> };
type Reader = {
  from(table: string): {
    select(columns: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: unknown; error: { message: string } | null }> } };
  };
};

function readable(error: { message: string; code?: string }): string {
  if (error.code === "42501") return "Only the Chief Medical Officer can do this.";
  if (error.code === "22023") return error.message;
  return "Something went wrong. Nothing was changed. Please try again.";
}

function readInputs(formData: FormData): { ok: true; code: string; text: string; note: string | null } | { ok: false; messages: string[] } {
  const code = codeSchema.safeParse(formData.get("code") ?? "");
  const text = definitionTextSchema.safeParse(formData.get("definition") ?? "");
  const note = noteSchema.safeParse(formData.get("note") ?? undefined);
  const messages = [
    ...(code.success ? [] : code.error.issues.map((i) => i.message)),
    ...(text.success ? [] : text.error.issues.map((i) => i.message)),
    ...(note.success ? [] : note.error.issues.map((i) => i.message)),
  ];
  if (!code.success || !text.success || !note.success) return { ok: false, messages };
  return { ok: true, code: code.data, text: text.data, note: note.data && note.data.length > 0 ? note.data : null };
}

function check(text: string, code: string): { ok: true; definition: Record<string, unknown> } | { ok: false; messages: string[] } {
  const parsed = parseDefinitionText(text);
  if (!parsed.ok) return { ok: false, messages: parsed.errors };
  const result = validateProtocolDefinition(withBookkeeping(parsed.definition, code));
  if (!result.ok) return { ok: false, messages: result.errors };
  return { ok: true, definition: parsed.definition };
}

export async function checkProtocolAction(_prev: CheckState, formData: FormData): Promise<CheckState> {
  if (!canAssignCases(await getCurrentClinicalStaff())) return { kind: "error", messages: [NOT_CMO] };
  const input = readInputs(formData);
  if (!input.ok) return { kind: "invalid", messages: input.messages };
  const result = check(input.text, input.code);
  if (!result.ok) return { kind: "invalid", messages: result.messages };
  return { kind: "valid", messages: ["This definition is valid. Nothing has been saved."] };
}

export async function saveProtocolDraftAction(_prev: CheckState, formData: FormData): Promise<CheckState> {
  if (!canAssignCases(await getCurrentClinicalStaff())) return { kind: "error", messages: [NOT_CMO] };
  const input = readInputs(formData);
  if (!input.ok) return { kind: "invalid", messages: input.messages };
  const result = check(input.text, input.code);
  if (!result.ok) return { kind: "invalid", messages: result.messages };
  const supabase = (await createClient()) as unknown as Rpc;
  const { error } = await supabase.rpc("save_protocol_draft", { p_code: input.code, p_definition: result.definition, p_note: input.note });
  if (error) return { kind: "error", messages: [readable(error)] };
  revalidatePath(PATH);
  return { kind: "saved", messages: ["Saved as a draft. It is not in use. Review it below, then approve it when you are sure."] };
}

function back(key: "done" | "error", value: string): never {
  redirect(`${PATH}?${key}=${encodeURIComponent(value)}`);
}

export async function approveProtocolAction(formData: FormData): Promise<void> {
  if (!canAssignCases(await getCurrentClinicalStaff())) back("error", NOT_CMO);
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) back("error", "That protocol was not recognised.");
  const note = noteSchema.safeParse(formData.get("note") ?? undefined);
  if (!note.success) back("error", "The note is 500 characters at most.");
  if (formData.get("confirmed") !== "yes") back("error", "Confirm the approval first. Nothing was changed.");

  const supabase = await createClient();
  const stored = await (supabase as unknown as Reader).from("protocols").select("code, status, definition").eq("id", id.data).maybeSingle();
  const row = stored.error ? null : z.object({ code: z.string(), status: z.string(), definition: z.unknown() }).safeParse(stored.data);
  if (!row || !row.success) back("error", "That draft could not be loaded. Nothing was changed.");
  if (row.data.status !== "draft") back("error", "Only a draft can be approved. Nothing was changed.");
  const result = validateProtocolDefinition(row.data.definition);
  if (!result.ok) back("error", `This draft is not valid and was not approved: ${result.errors.join("; ")}`);

  const { error } = await (supabase as unknown as Rpc).rpc("approve_protocol", { p_id: id.data, p_note: note.data && note.data.length > 0 ? note.data : null });
  if (error) back("error", readable(error));
  revalidatePath(PATH);
  back("done", "Approved. It is recorded with your name and the time, and the previous approved version is retired.");
}
