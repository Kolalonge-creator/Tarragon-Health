import { NextResponse, type NextRequest } from "next/server";
import {
  getHomePathForRole,
  isAuthPath,
  isProtectedPath,
} from "@/lib/auth/redirect";
import { fetchUserRole } from "@/lib/auth/profile";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { supabase, user, supabaseResponse } = await updateSession(request);

  if (isProtectedPath(pathname)) {
    if (!user) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }

    const role = await fetchUserRole(supabase, user.id);

    if (role) {
      const homePath = getHomePathForRole(role);
      const allowedPrefix = homePath.split("/")[1];
      const currentPrefix = pathname.split("/")[1];

      if (currentPrefix !== allowedPrefix && role !== "admin") {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = homePath;
        return NextResponse.redirect(redirectUrl);
      }
    }
  }

  if (isAuthPath(pathname) && user) {
    const role = await fetchUserRole(supabase, user.id);

    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = role ? getHomePathForRole(role) : "/patient";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
