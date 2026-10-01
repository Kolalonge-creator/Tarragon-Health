import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { recordSupplyAction } from "./actions";
import {
  IDENTITY_NOTICE,
  SUPPLY_OUTCOME_MESSAGE,
  describeSupply,
  isSupplyOutcome,
  NOT_FOUND_MESSAGE,
  RATE_LIMITED_MESSAGE,
  TOKEN_PATTERN,
  parseProof,
  presentStatus,
  stripDoctorTitle,
  type PublicPrescriptionProof,
} from "@/lib/prescriptions/public-verification";

/**
 * "Is this prescription real and still valid?", asked by a pharmacist holding a printed or on-screen
 * TarragonHealth prescription who has no account here and should not need one.
 *
 * NO LOGIN, BY DESIGN. The 64-hex token in the URL (carried by the QR on the PDF) is the whole credential:
 * more than 240 bits, so it cannot be guessed or walked. The function returns proof only and no patient
 * identifier of any kind. Same posture as /verify-report and the emergency card: a bare anon supabase-js
 * client and no platform/auth imports, so this page cannot reach anything the token does not entitle.
 *
 * Rate limited per connection (the memory limiter works today; it becomes distributed when Upstash is
 * configured). The token is never logged and the page is never indexed or cached.
 */

export const metadata: Metadata = {
  title: "Check a prescription",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Lookup =
  | { kind: "proof"; proof: PublicPrescriptionProof }
  | { kind: "not_found" }
  | { kind: "rate_limited" }
  | { kind: "unavailable" };

async function lookup(token: string): Promise<Lookup> {
  const ip = await getClientIp();
  const limited = await rateLimit(`verify-rx:ip:${ip}`, { limit: 30, windowSeconds: 60 });
  if (!limited.success) return { kind: "rate_limited" };
  if (!TOKEN_PATTERN.test(token)) return { kind: "not_found" };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { kind: "unavailable" };
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("verify_prescription_public", { p_token: token });
  if (error) return { kind: "unavailable" };
  const proof = parseProof(data);
  return proof ? { kind: "proof", proof } : { kind: "not_found" };
}

function formatDate(value: string | null): string {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric" });
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

export default async function VerifyPrescriptionPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const { token } = await params;
  const { result: resultParam } = await searchParams;
  const supplyResult = isSupplyOutcome(resultParam) ? SUPPLY_OUTCOME_MESSAGE[resultParam] : null;
  const result = await lookup(token);

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <p className="text-sm font-semibold text-emerald-800">TarragonHealth</p>
      <h1 className="mt-1 text-2xl font-bold">Check a prescription</h1>

      {result.kind === "proof" && (
        <>
          {(() => {
            const p = result.proof;
            const s = presentStatus(p.status);
            return (
              <>
                <div
                  role="status"
                  className={`mt-6 rounded-md border-l-4 p-4 ${s.tone === "good" ? "border-emerald-600 bg-emerald-50" : "border-red-600 bg-red-50"}`}
                >
                  <p className="text-lg font-bold">{s.headline}</p>
                  <p className="mt-1 text-sm">{s.guidance}</p>
                </div>
                <dl className="mt-6">
                  <Row label="Rx number" value={p.rx_number} />
                  <Row label="Medicine" value={p.drug_name} />
                  <Row label="Dose" value={p.dose} />
                  <Row label="How often" value={p.frequency} />
                  <Row label="Quantity" value={p.quantity} />
                  <Row label="Course" value={p.duration_days ? `${p.duration_days} days` : null} />
                  <Row label="Repeats allowed" value={String(p.repeats_allowed)} />
                  <Row label="Repeats remaining" value={String(p.repeats_remaining)} />
                  <Row label="Signed" value={formatDate(p.signed_at)} />
                  <Row label="Valid until" value={formatDate(p.expires_at)} />
                  <Row label="Version" value={p.version > 1 ? `${p.version} (amended)` : "1"} />
                  <Row label="Prescribed by" value={`Dr. ${stripDoctorTitle(p.prescriber_name)}`} />
                  <Row label="Registration" value={p.prescriber_credential} />
                </dl>
                {supplyResult && (
                  <p
                    role="status"
                    className={`mt-6 rounded-md border-l-4 p-3 text-sm ${supplyResult.tone === "good" ? "border-emerald-600 bg-emerald-50" : "border-red-600 bg-red-50"}`}
                  >
                    {supplyResult.text}
                  </p>
                )}
                {p.status === "active" && (
                  <section className="mt-6 rounded-md border border-gray-300 p-4">
                    <h2 className="text-base font-bold">Supplies</h2>
                    <p className="mt-1 text-sm">
                      Supplied {p.supplies_dispensed} of {p.supplies_permitted} permitted
                      {p.last_supplied_on ? `, last on ${formatDate(p.last_supplied_on)}` : ""}.
                    </p>
                    <p className="mt-1 text-sm">{describeSupply(p)}</p>
                    {p.supply_available && (
                      <form action={recordSupplyAction} className="mt-4 space-y-3">
                        <input type="hidden" name="token" value={token} />
                        <p className="text-sm font-medium">Record that you are supplying this now</p>
                        <label className="block text-sm">
                          Pharmacy name
                          <input name="pharmacyName" required minLength={2} maxLength={120} className="mt-1 w-full rounded border border-gray-300 p-2" />
                        </label>
                        <label className="block text-sm">
                          Pharmacist&apos;s name
                          <input name="pharmacistName" required minLength={2} maxLength={120} className="mt-1 w-full rounded border border-gray-300 p-2" />
                        </label>
                        <label className="block text-sm">
                          Pharmacist registration number
                          <input name="pharmacistRegistration" required minLength={3} maxLength={40} className="mt-1 w-full rounded border border-gray-300 p-2" />
                        </label>
                        <label className="flex items-start gap-2 text-sm">
                          <input type="checkbox" name="confirmed" required className="mt-1" />
                          <span>I am a pharmacist or work for a pharmacy, and I am supplying this prescription now.</span>
                        </label>
                        <button type="submit" className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">
                          Record this supply
                        </button>
                        <p className="text-xs text-gray-600">
                          What you type is saved on the prescription, and the patient is told straight away. It is not checked against a register, and the patient can report a supply that did not happen.
                        </p>
                      </form>
                    )}
                  </section>
                )}
                <p className="mt-6 rounded-md bg-gray-100 p-3 text-xs text-gray-700">{IDENTITY_NOTICE}</p>
              </>
            );
          })()}
        </>
      )}

      {result.kind === "not_found" && (
        <p role="status" className="mt-6 rounded-md border-l-4 border-red-600 bg-red-50 p-4 text-sm">{NOT_FOUND_MESSAGE}</p>
      )}
      {result.kind === "rate_limited" && (
        <p role="status" className="mt-6 rounded-md border-l-4 border-amber-600 bg-amber-50 p-4 text-sm">{RATE_LIMITED_MESSAGE}</p>
      )}
      {result.kind === "unavailable" && (
        <p role="status" className="mt-6 rounded-md border-l-4 border-amber-600 bg-amber-50 p-4 text-sm">
          The check is not available right now. Please try again shortly. Until it works, do not dispense on the strength of the paper alone.
        </p>
      )}
    </main>
  );
}
