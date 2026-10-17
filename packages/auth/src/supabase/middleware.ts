import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@tarragon/shared";

/**
 * Refreshes the Supabase session cookie for the current request/response
 * pair. Called from the root `proxy.ts` on every request — must run before
 * any other cookie-dependent logic (Server Components read the cookies the
 * proxy sets here).
 */
export async function updateSession(
  request: NextRequest,
  options: { verify?: "server" | "claims" } = {},
) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // "server" (default): ask Supabase Auth, so a revoked or deleted session is
  // refused at once. Costs one network round trip on every request.
  // "claims": verify the JWT signature locally (cached JWKS) and refresh an
  // expired session first, with no round trip. A revoked session is then
  // trusted until its access token expires, which is already the window RLS
  // itself honours; pages still call getUser() via getCurrentUser(). Fails
  // closed: an unverifiable token yields user = null. Only `id` is provided.
  if (options.verify === "claims") {
    const { data } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    return { response, supabase, user: sub ? { id: sub } : null };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, supabase, user };
}
