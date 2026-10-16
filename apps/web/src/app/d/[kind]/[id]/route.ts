import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { documentTarget, verifyDocumentLink, type DocumentLinkKind } from "@/lib/notifications/document-link";

/**
 * GET /d/<kind>/<id>?e=<expiry>&s=<signature>: the signed link in the lab-request and care-plan emails (OQ-91). The email holds
 * no content. A bad, expired or tampered link looks exactly like a page that does not exist. A good link sends a signed-in owner
 * to the in-app PDF (which checks ownership again) and anyone else to sign in first.
 */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }): Promise<Response> {
  const { kind, id } = await params;
  const url = new URL(request.url);
  if (!verifyDocumentLink(process.env.NOTIFICATIONS_LINK_SECRET, kind, id, url.searchParams.get("e"), url.searchParams.get("s"))) {
    return new NextResponse(null, { status: 404 });
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.redirect(new URL("/login?redirect=/patient", request.url));
  // The care plan link names the patient it was made for: another signed-in person gets nothing.
  if (kind === "care-plan" && data.user.id !== id) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(new URL(documentTarget(kind as DocumentLinkKind, id), request.url));
}
