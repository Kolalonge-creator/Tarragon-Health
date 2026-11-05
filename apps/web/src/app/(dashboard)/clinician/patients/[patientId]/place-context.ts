import { createClient } from "@/lib/supabase/server";

/** The patient's saved state and LGA (search defaults to the patient's location, design §9) and the tests a suggestion can be for. */
export async function loadPlaceContext(patientId: string, kind: "lab" | "imaging") {
  const supabase = await createClient();
  const [{ data: profile }, { data: concepts }] = await Promise.all([
    supabase.from("profiles").select("state, lga").eq("id", patientId).maybeSingle(),
    kind === "lab"
      ? supabase.from("reference_concepts").select("id, display").eq("domain", "lab_test").eq("is_ambiguous", false)
          .not("investigation_category", "is", null).order("display", { ascending: true }).limit(500)
      : Promise.resolve({ data: [] }),
  ]);
  const p = (profile ?? {}) as { state?: string | null; lga?: string | null };
  return {
    state: typeof p.state === "string" ? p.state : null,
    lga: typeof p.lga === "string" ? p.lga : null,
    tests: Array.isArray(concepts) ? (concepts as { id: string; display: string }[]) : [],
  };
}
