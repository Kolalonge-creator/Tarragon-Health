import { openShare } from "@/lib/record-share/open";
import { httpStatusFor, renderSharePage, shareHeaders } from "@/lib/record-share/share-page";

/**
 * The public door for a record share link (S43, spec 2.8).
 *
 * A route handler, not a page, because the status code is part of the contract:
 * an expired, revoked or view-capped link answers 410 (and the database has
 * already logged the attempt against the link, where the patient can see it),
 * a link that needs a PIN answers 401, a locked one 423, an unknown one 404.
 * The PIN is read from a POST body, never from the URL.
 *
 * GET IS A PREVIEW, POST OPENS. A messaging app unfurling a pasted link, or a mail scanner, only GETs. A GET therefore never counts a view and
 * never returns a record: it answers whether the link is live (with a button) or needs a PIN. The record is returned only to a POST.
 *
 * Opening a link is the audited event: record_share_open writes the lookup row,
 * counts the view under a row lock (so a view cap cannot be exceeded by two
 * simultaneous openings) and emits share_link.accessed. No clinical value is
 * read here; everything shown was assembled by that one function for the
 * sections the patient chose.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function respond(token: string, pin: string | null, commit: boolean): Promise<Response> {
  const result = await openShare(token, pin, commit);
  return new Response(renderSharePage(result, token), { status: httpStatusFor(result), headers: shareHeaders() });
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await ctx.params;
  // A GET is only a preview: link unfurlers and mail scanners GET, and must not spend a view or read a record.
  return respond(token, null, false);
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await ctx.params;
  let pin: string | null = null;
  try {
    const form = await req.formData();
    const value = form.get("pin");
    pin = typeof value === "string" ? value.trim() : null;
  } catch {
    pin = null;
  }
  // Only a deliberate POST (the Open button, or the PIN form) opens the record.
  return respond(token, pin, true);
}
