import type { Metadata } from "next";
import { CODE_LOOKUP_MESSAGE, isCodeLookupNotice } from "@/lib/prescriptions/public-verification";
import { checkPrescriptionCodeAction } from "./actions";

export const metadata: Metadata = {
  title: "Check a prescription",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The no-login entry to the prescription check. The QR on the form opens /verify-rx/<token> directly; T2-11b adds a box for the Rx
 * number and verification code, for a pharmacist who cannot scan. A match goes to that same page, with the same minimal facts.
 */
export default async function VerifyPrescriptionIndex({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const { n } = await searchParams;
  const notice = isCodeLookupNotice(n) ? CODE_LOOKUP_MESSAGE[n] : null;
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <p className="text-sm font-semibold text-emerald-800">TarragonHealth</p>
      <h1 className="mt-1 text-2xl font-bold">Check a prescription</h1>
      <p className="mt-4 text-sm">
        Scan the QR code on the TarragonHealth prescription, or open the link printed on it. If you cannot scan it, type the Rx
        number and the verification code printed on the form. The check shows whether the prescription is genuine and still
        valid. It needs no account.
      </p>
      <form action={checkPrescriptionCodeAction} className="mt-6 space-y-3">
        <label className="block text-sm font-medium">
          Rx number
          <input
            name="rxNumber"
            required
            maxLength={60}
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="TRG-RX-2026-000123"
            className="mt-1 w-full rounded border border-gray-300 p-2 uppercase"
          />
        </label>
        <label className="block text-sm font-medium">
          Verification code
          <input
            name="code"
            required
            maxLength={30}
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="A1B2C3"
            className="mt-1 w-full rounded border border-gray-300 p-2 uppercase tracking-widest"
          />
        </label>
        {notice && (
          <p role="alert" className="text-sm text-red-700">
            {notice}
          </p>
        )}
        <button type="submit" className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">
          Check this prescription
        </button>
      </form>
    </main>
  );
}
