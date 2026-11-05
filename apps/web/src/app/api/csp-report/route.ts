import { NextResponse, type NextRequest } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { z } from "zod";
import { summariseCspReports } from "@/lib/security/csp-nonce";

// Either report format: the legacy report-uri object or the Reporting API array. Field-level checks are in summariseCspReports.
const reportBodySchema = z.union([z.array(z.unknown()).max(50), z.record(z.string(), z.unknown())]);

/**
 * Receives the browser's reports for the report-only nonce policy (lib/security/csp-nonce.ts) and writes a sanitised summary to
 * the server log: directive, the blocked resource's origin (or "inline"/"eval"), and the page path with ids and the query removed.
 * Nothing is stored and nothing identifies a person. Anyone can post here, so it is rate limited per IP, the body is capped, and it
 * always answers 204: a report endpoint must never give a caller anything back.
 */
const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const noContent = new NextResponse(null, { status: 204 });
  try {
    const ip = await getClientIp();
    const limited = await rateLimit(`csp-report:${ip}`, { limit: 60, windowSeconds: 60 });
    if (!limited.success) return noContent;

    const text = await request.text();
    if (text.length === 0 || text.length > MAX_BODY_BYTES) return noContent;
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return noContent;
    }
    const parsed = reportBodySchema.safeParse(body);
    if (!parsed.success) return noContent;
    for (const v of summariseCspReports(parsed.data)) {
      console.warn("csp-report-only violation", v);
    }
  } catch {
    // never fail a report
  }
  return noContent;
}
