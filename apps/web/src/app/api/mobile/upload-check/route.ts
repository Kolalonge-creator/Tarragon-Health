import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { checkMyUpload } from "@/lib/uploads/check-my-upload";

/** Phone: called right after the app writes a file straight to Storage (including when the offline outbox replays). See
 * lib/uploads/check-my-upload.ts. */
export async function POST(request: Request): Promise<Response> {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const result = await checkMyUpload(createBearerClient(accessToken), await request.json().catch(() => null), accessToken);
  if ("error" in result) {
    const status = result.error === "Not signed in" ? 401 : result.error === "Invalid request" ? 400 : 500;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
