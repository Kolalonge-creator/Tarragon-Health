import type { Metadata } from "next";
import { checkRequestCodeAction } from "./actions";

export const metadata: Metadata = {
  title: "Check a test request form",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function VerifyRequestIndex({ searchParams }: { searchParams: Promise<{ invalid?: string }> }) {
  const { invalid } = await searchParams;
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <p className="text-sm font-semibold text-emerald-800">TarragonHealth</p>
      <h1 className="mt-1 text-2xl font-bold">Check a test request form</h1>
      <p className="mt-4 text-sm">
        Scan the QR code on the TarragonHealth test request form, or type the verification code printed beside it. The check
        shows whether the form is genuine, when it was issued, the tests it lists and the patient&apos;s initials. It needs no
        account.
      </p>
      <form action={checkRequestCodeAction} className="mt-6 space-y-3">
        <label className="block text-sm font-medium">
          Verification code
          <input
            name="code"
            required
            maxLength={80}
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="ABCDE-23456"
            className="mt-1 w-full rounded border border-gray-300 p-2 uppercase tracking-widest"
          />
        </label>
        {invalid && (
          <p role="alert" className="text-sm text-red-700">
            That does not look like a verification code. It has 10 letters and numbers, printed as two groups of five.
          </p>
        )}
        <button type="submit" className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">
          Check this form
        </button>
      </form>
    </main>
  );
}
