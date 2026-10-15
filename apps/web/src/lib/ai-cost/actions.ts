"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { noticeForError, priceFormSchema, type Notice } from "./model";

const back = (n: Notice): never => redirect(`/admin/settings/ai-governance/cost?n=${n}`);

/** Records a model price (integer minor units per million tokens). The database refuses anyone without the AI governance permission. */
export async function addAiModelPriceAction(formData: FormData): Promise<void> {
  const parsed = priceFormSchema.safeParse({
    model: formData.get("model"),
    input: formData.get("input"),
    output: formData.get("output"),
    currency: formData.get("currency"),
    valid_from: formData.get("valid_from"),
    source_note: formData.get("source_note"),
  });
  if (!parsed.success) return back("bad_input");
  const { error } = await loose(await createClient()).rpc("add_ai_model_price", {
    p_model: parsed.data.model,
    p_input_per_million_minor: parsed.data.input,
    p_output_per_million_minor: parsed.data.output,
    p_currency: parsed.data.currency,
    p_valid_from: `${parsed.data.valid_from}T00:00:00+01:00`,
    p_source_note: parsed.data.source_note,
  });
  if (error) return back(noticeForError(error.code));
  return back("added");
}
