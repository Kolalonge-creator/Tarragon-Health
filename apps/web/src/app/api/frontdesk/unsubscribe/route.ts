import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { fdRpcData } from "@/lib/frontdesk/raw-db";
import { rateLimit } from "@/lib/rate-limit";

/**
 * One-click unsubscribe for follow-up email (Front Desk F10, RFC 8058).
 *
 *  GET   shows a confirmation page. A link scanner or a mail client that prefetches links must NOT unsubscribe anyone, so a GET never changes
 *        anything.
 *  POST  does it: the "Stop these emails" button on that page, and the mail client's one-click `List-Unsubscribe=One-Click` request, which
 *        posts to the same URL. Both carry the contact id (`c`) and an HMAC token (`t`) in the query, so a link cannot be forged or aimed at
 *        someone else.
 *
 * Unsubscribing suppresses the contact, withdraws every consent and cancels scheduled follow-ups, immediately (service_fd_unsubscribe).
 * No personal data is shown or returned.
 */
const paramsSchema = z.object({ c: z.string().uuid(), t: z.string().regex(/^[0-9a-f]{40}$/) });

const PAGE = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>` +
  `<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d2b2b;background:#f6f9f7;margin:0;display:grid;place-items:center;min-height:100vh}` +
  `main{background:#fff;border:1px solid #dde5e2;border-radius:16px;padding:28px;max-width:440px;margin:16px}h1{font-size:20px;margin:0 0 10px}p{line-height:1.55;margin:0 0 16px}` +
  `button{background:#0E7C52;color:#fff;border:0;border-radius:10px;padding:12px 18px;font-size:16px;cursor:pointer}</style></head><body><main>${body}</main></body></html>`;

function html(status: number, title: string, body: string): Response {
  return new Response(PAGE(title, body), {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" },
  });
}

const INVALID = () =>
  html(400, "Link not valid", "<h1>This link is not valid</h1><p>It may have been copied incompletely. Reply to the email and a person will stop the messages for you.</p>");

function clientKey(request: Request): string {
  const h = request.headers;
  return (h.get("x-vercel-forwarded-for") ?? h.get("x-forwarded-for") ?? "unknown").split(",")[0]!.trim();
}

/** The contact id and token from the link, if they are well formed AND the database says the token is right (the secret lives only in the Vault). */
async function parse(request: Request): Promise<{ c: string; t: string } | null> {
  const q = new URL(request.url).searchParams;
  let c = q.get("c");
  let t = q.get("t");
  if ((!c || !t) && request.method === "POST") {
    try {
      const form = await request.formData();
      c = c ?? (form.get("c") as string | null);
      t = t ?? (form.get("t") as string | null);
    } catch {
      /* the one-click request has no useful body */
    }
  }
  const parsed = paramsSchema.safeParse({ c, t });
  if (!parsed.success) return null;
  const { data, error } = await fdRpcData<boolean>(createServiceRoleClient(), "service_fd_unsubscribe_token_valid", { p_contact: parsed.data.c, p_token: parsed.data.t });
  return !error && data === true ? parsed.data : null;
}

export async function GET(request: Request): Promise<Response> {
  const p = await parse(request);
  if (!p) return INVALID();
  return html(
    200,
    "Stop these emails",
    `<h1>Stop emails from TarragonHealth?</h1><p>You will no longer get follow-up emails from us about your account or your enquiry. Your account and your care are not affected.</p>` +
      `<form method="post" action="/api/frontdesk/unsubscribe?c=${p.c}&amp;t=${p.t}"><button type="submit">Yes, stop these emails</button></form>`,
  );
}

export async function POST(request: Request): Promise<Response> {
  const limited = await rateLimit(`fd-unsub:${clientKey(request)}`, { limit: 30, windowSeconds: 3600 });
  if (!limited.success) return html(429, "Too many requests", "<h1>Please try again later</h1><p>Too many requests came from your connection.</p>");
  const p = await parse(request);
  if (!p) return INVALID();
  const { data, error } = await fdRpcData<string>(createServiceRoleClient(), "service_fd_unsubscribe_with_token", { p_contact: p.c, p_token: p.t });
  // An error is never reported as success: a person who thinks they are unsubscribed and is not has been misled.
  if (error) return html(500, "Something went wrong", "<h1>We could not do that just now</h1><p>Please try again, or reply to the email and a person will stop the messages for you.</p>");
  if (data !== "ok") return INVALID();
  return html(200, "Unsubscribed", "<h1>You are unsubscribed</h1><p>We will not send you any more follow-up emails. If this was a mistake, just reply to any earlier email and a person will help.</p>");
}
