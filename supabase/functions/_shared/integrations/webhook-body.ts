/**
 * Reads a webhook body with a size cap, BEFORE any signature work. A vendor's real events are a few kilobytes (Paystack, Zoom and Resend
 * all send well under 100 KB); a megabyte-sized body is either a mistake or someone trying to make the function hold it in memory. The
 * Content-Length header is a quick refusal; the streamed count is the real check, because the header can be absent or false.
 * Plain Web APIs only, so Deno and Jest both run it.
 */
export const MAX_WEBHOOK_BODY_BYTES = 1_048_576;

export type CappedBody = { readonly ok: true; readonly body: string } | { readonly ok: false };

export async function readCappedBody(req: Request, maxBytes = MAX_WEBHOOK_BODY_BYTES): Promise<CappedBody> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };
  if (!req.body) return { ok: true, body: "" };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false };
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return { ok: true, body: new TextDecoder().decode(all) };
}
