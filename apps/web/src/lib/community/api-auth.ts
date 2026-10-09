import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { createBearerClient } from "@/lib/supabase/bearer";

export type CommunityAuth = { userId: string; supabase: SupabaseClient<Database> };

/**
 * The Community picture routes serve the web app (cookie session) and the mobile app (bearer token). Either way the database calls run
 * AS THE PERSON, so the same checks as every other Community call apply; the service role is used only to read and write the file.
 */
export async function authenticateCommunity(request: Request): Promise<CommunityAuth | { response: NextResponse }> {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const supabase = (accessToken ? createBearerClient(accessToken) : await createClient()) as SupabaseClient<Database>;
  const {
    data: { user },
    error,
  } = accessToken ? await supabase.auth.getUser(accessToken) : await supabase.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: "Please sign in again." }, { status: 401 }) };
  return { userId: user.id, supabase };
}
