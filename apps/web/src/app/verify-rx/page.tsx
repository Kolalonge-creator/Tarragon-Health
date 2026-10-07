import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Check a prescription",
  robots: { index: false, follow: false },
};

export default function VerifyPrescriptionIndex() {
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <p className="text-sm font-semibold text-emerald-800">TarragonHealth</p>
      <h1 className="mt-1 text-2xl font-bold">Check a prescription</h1>
      <p className="mt-4 text-sm">
        Scan the QR code on the TarragonHealth prescription, or open the link printed on it. The check shows whether
        the prescription is genuine and still valid. It needs no account.
      </p>
    </main>
  );
}
