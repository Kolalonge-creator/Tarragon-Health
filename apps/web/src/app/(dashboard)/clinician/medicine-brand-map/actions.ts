"use server";

import { revalidatePath } from "next/cache";
import { parseBrandMapCsv, type BrandMapCsvError } from "@tarragon/medicines";
import { createClient } from "@/lib/supabase/server";

export type BrandMapActionState = { error?: string; success?: string } | undefined;

const PATHS = ["/clinician/medicine-brand-map", "/admin/settings/medicine-brand-map"];
function refresh() {
  for (const p of PATHS) revalidatePath(p);
}

const CSV_TEXT: Record<BrandMapCsvError, string> = {
  empty_file: "The file is empty.",
  bad_header: "The first line must be exactly: brand_name,ingredients,source_citation",
  too_many_rows: "At most 500 rows in one file.",
  wrong_column_count: "needs exactly three columns",
  brand_missing: "has no brand name",
  brand_too_long: "has a brand name longer than 80 characters",
  ingredients_missing: "has no ingredients",
  ingredient_too_long: "has an ingredient name longer than 80 characters",
  citation_missing: "has no source",
  citation_not_a_link: "has a source without an https link a reviewer can open",
  citation_too_long: "has a source longer than 400 characters",
  duplicate_brand: "repeats a brand name already earlier in the file",
  unterminated_quote: "A quotation mark is never closed.",
};

/**
 * Who may do what is decided by the database functions (editors: admin or active clinical staff; reviewers: active clinical staff who
 * did not enter the row). These actions only parse and pass on. Every row they create is an unreviewed draft that nothing uses.
 */
export async function saveBrandMapAction(_prev: BrandMapActionState, formData: FormData): Promise<BrandMapActionState> {
  const brand = String(formData.get("brand_name") ?? "").trim();
  const ingredients = String(formData.get("ingredients") ?? "")
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const citation = String(formData.get("source_citation") ?? "").trim();
  const id = String(formData.get("id") ?? "") || null;
  if (!brand || ingredients.length === 0 || !citation) return { error: "A brand name, at least one ingredient and a source are all needed." };
  if (!/https:\/\/\S+/i.test(citation)) return { error: "The source must include an https link a reviewer can open." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_medicine_brand_map", { p_id: id, p_brand: brand, p_ingredients: ingredients, p_citation: citation });
  if (error) return { error: error.code === "23505" ? "That brand is already on the list." : error.message };
  refresh();
  return { success: id ? "Saved. A changed row goes back to waiting for a review." : "Saved as a draft. A clinician must review it before it is used." };
}

export async function importBrandMapAction(_prev: BrandMapActionState, formData: FormData): Promise<BrandMapActionState> {
  const text = String(formData.get("csv") ?? "");
  const parsed = parseBrandMapCsv(text);
  if (parsed.errors.length > 0) {
    const lines = parsed.errors.slice(0, 8).map((e) => (e.line === 0 ? CSV_TEXT[e.error] : e.error === "bad_header" ? CSV_TEXT.bad_header : `Line ${e.line} ${CSV_TEXT[e.error]}.`));
    return { error: `Nothing was imported. ${lines.join(" ")}${parsed.errors.length > 8 ? ` And ${parsed.errors.length - 8} more.` : ""}` };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_medicine_brand_map", {
    p_rows: parsed.rows.map((r) => ({ brand_name: r.brandName, ingredients: r.ingredients, source_citation: r.sourceCitation })),
  });
  if (error) return { error: error.message };
  refresh();
  const skipped = parsed.rows.length - (data ?? 0);
  return { success: `${data ?? 0} added as drafts${skipped > 0 ? `, ${skipped} skipped because the brand was already on the list` : ""}. A clinician must review them before they are used.` };
}

export async function reviewBrandMapAction(id: string, approve: boolean): Promise<BrandMapActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_medicine_brand_map", { p_id: id, p_approve: approve });
  if (error) return { error: error.message };
  refresh();
  return { success: approve ? "Approved. This mapping is now used in search and the same-ingredient warning." : "Withdrawn. This mapping is no longer used." };
}
