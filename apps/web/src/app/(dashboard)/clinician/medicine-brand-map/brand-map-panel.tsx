import { createClient } from "@/lib/supabase/server";
import { LoadFailure } from "@/components/ui/load-failure";
import { BrandMapManager, type BrandMapRow } from "./brand-map-manager";

/** Loads every brand row (the database sends staff all of them) and renders the editor. `canReview` is only a hint for the buttons; the database decides. */
export async function BrandMapPanel({ canReview }: { canReview: boolean }) {
  const supabase = await createClient();
  const [{ data: rows, error }, { data: auth }] = await Promise.all([
    supabase
      .from("medicine_brand_generic_map")
      .select("id, brand_name, ingredients, source_citation, created_by, reviewer_name, reviewed_at, is_active")
      .order("brand_name")
      .limit(1000),
    supabase.auth.getUser(),
  ]);
  if (error) {
    return <LoadFailure>The brand list could not be loaded. Do not review anything from here until it loads.</LoadFailure>;
  }
  return <BrandMapManager rows={(rows ?? []) as BrandMapRow[]} canReview={canReview} viewerId={auth.user?.id ?? ""} />;
}
