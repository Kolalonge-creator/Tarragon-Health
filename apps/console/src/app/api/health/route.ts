import { NextResponse } from "next/server";

/**
 * Liveness only: answers 200 without touching auth or the database, so a
 * deploy check can tell "the console is up" apart from "Supabase is slow".
 * Excluded from the proxy matcher for the same reason.
 */
export function GET() {
  return NextResponse.json({ ok: true, app: "console" }, { headers: { "Cache-Control": "no-store" } });
}
