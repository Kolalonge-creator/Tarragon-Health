import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import {
  LAB_NOT_CONTRACTED_STATEMENT,
  NOT_FOUND_REQUEST_MESSAGE,
  RATE_LIMITED_REQUEST_MESSAGE,
  normaliseRequestRef,
  parseRequestProof,
  presentRequestStatus,
  type PublicRequestProof,
} from "@/lib/lab-results/request-verification";

/**
 * "Is this test request form real?", asked by a laboratory holding a printed TarragonHealth request (T2 Phase 3, brief 6.3).
 *
 * NO LOGIN, BY DESIGN, same posture as /verify-rx: a bare anon supabase-js client and no platform/auth imports. The path carries
 * either the 64-hex token from the QR or the 10-character typed code; both are credentials for the same proof. The function
 * returns the status, the issue date, the tests and the patient's INITIALS only: never a name, a date of birth, a patient number
 * or a price. Rate limited per connection; never indexed or cached; the path never leaves through a Referer header (proxy.ts).
 */

export const metadata: Metadata = {
  title: "Check a test request form",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Lookup =
  | { kind: "proof"; proof: PublicRequestProof }
  | { kind: "not_found" }
  | { kind: "rate_limited" }
  | { kind: "unavailable" };

async function lookup(raw: string): Promise<Lookup> {
  const ip = await getClientIp();
  const limited = await rateLimit(`verify-request:ip:${ip}`, { limit: 30, windowSeconds: 60 });
  if (!limited.success) return { kind: "rate_limited" };
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return { kind: "not_found" };
  }
  const ref = normaliseRequestRef(decoded);
  if (!ref) return { kind: "not_found" };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { kind: "unavailable" };
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("verify_lab_request_public", { p_ref: ref });
  if (error) return { kind: "unavailable" };
  const proof = parseRequestProof(data);
  return proof ? { kind: "proof", proof } : { kind: "not_found" };
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric" });
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-6 border-b border-gray-200 py-2 text-sm">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

const TONE: Record<"good" | "warn" | "bad", string> = {
  good: "border-emerald-600 bg-emerald-50",
  warn: "border-amber-600 bg-amber-50",
  bad: "border-red-600 bg-red-50",
};

export default async function VerifyRequestPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const result = await lookup(ref);

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <p className="text-sm font-semibold text-emerald-800">TarragonHealth</p>
      <h1 className="mt-1 text-2xl font-bold">Check a test request form</h1>

      {result.kind === "proof" &&
        (() => {
          const p = result.proof;
          const s = presentRequestStatus(p.status);
          return (
            <>
              <div role="status" className={`mt-6 rounded-md border-l-4 p-4 ${TONE[s.tone]}`}>
                <p className="text-lg font-bold">{s.headline}</p>
                <p className="mt-1 text-sm">{s.guidance}</p>
              </div>
              <dl className="mt-6">
                <Row label="Reference" value={p.order_number} />
                <Row label="Issued" value={formatDate(p.issued_on)} />
                <Row label="Patient's initials" value={p.patient_initials} />
                <Row label="Requested by" value={p.requested_by} />
                <Row label="Registration" value={p.requester_registration} />
              </dl>
              <section className="mt-6">
                <h2 className="text-base font-bold">Tests listed on the form</h2>
                {p.tests.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                    {p.tests.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm">The form names a panel; ask the patient for the printed list.</p>
                )}
              </section>
              <p className="mt-6 rounded-md bg-gray-100 p-3 text-xs text-gray-700">{LAB_NOT_CONTRACTED_STATEMENT}</p>
              <p className="mt-3 text-xs text-gray-600">
                This check confirms the form only. It does not show the patient&apos;s name, and it is not a check of who is holding it.
              </p>
            </>
          );
        })()}

      {result.kind === "not_found" && (
        <p role="status" className="mt-6 rounded-md border-l-4 border-red-600 bg-red-50 p-4 text-sm">{NOT_FOUND_REQUEST_MESSAGE}</p>
      )}
      {result.kind === "rate_limited" && (
        <p role="status" className="mt-6 rounded-md border-l-4 border-amber-600 bg-amber-50 p-4 text-sm">{RATE_LIMITED_REQUEST_MESSAGE}</p>
      )}
      {result.kind === "unavailable" && (
        <p role="status" className="mt-6 rounded-md border-l-4 border-amber-600 bg-amber-50 p-4 text-sm">
          The check is not available right now. Please try again shortly.
        </p>
      )}
    </main>
  );
}
