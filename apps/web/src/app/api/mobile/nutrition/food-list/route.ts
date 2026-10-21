import { NextResponse } from "next/server";
import { compressFoodList } from "@tarragon/shared";
import { createBearerClient } from "@/lib/supabase/bearer";
import { fetchFoodCatalogue } from "@/lib/nutrition/food-catalogue-fetch";

/**
 * The food list for the phone, compressed (arrays, not objects) so it is small to download over a weak connection and can be kept on the
 * device for offline logging. `version` is a hash of the content: the phone sends it back as If-None-Match and gets a 304 with no body
 * when nothing changed. Every signed-in user may read the catalogue (it is the same global table the web reads).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });

  const catalogue = await fetchFoodCatalogue(supabase);
  // fetchFoodCatalogue never throws and returns [] on failure; an empty list must never replace a good one on the phone.
  if (catalogue.length === 0) return NextResponse.json({ error: "The food list is unavailable right now." }, { status: 503 });

  const list = compressFoodList(catalogue);
  const etag = `"${list.version}"`;
  if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  return NextResponse.json(list, { headers: { ETag: etag, "Cache-Control": "private, max-age=0, must-revalidate" } });
}
