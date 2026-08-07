import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { normaliseSerial } from "@/lib/health-passport/verify";

/**
 * The way in for someone who has the document but not the QR code — a
 * photocopied page, a fax, a scan attached to an application, a reference read
 * down a phone line. Those are the ordinary cases in the institutions this is
 * built for, not edge cases, so typing the reference has to work as well as
 * scanning it.
 *
 * A reference is not personal data (it identifies a document, not a person, and
 * the identity behind it stays gated behind the date-of-birth check), so putting
 * it in the path on submit is safe and gives the verifier a link they can save
 * or forward to a colleague.
 */

export const metadata: Metadata = {
  title: "Verify a TarragonHealth record",
  description:
    "Check whether a TarragonHealth Health Passport is genuine, current, and which doctor attested it. No account needed.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

async function goToRecord(formData: FormData) {
  "use server";
  const serial = normaliseSerial(String(formData.get("serial") ?? ""));
  redirect(serial ? `/verify/${serial}` : "/verify?invalid=1");
}

export default async function VerifyLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ invalid?: string }>;
}) {
  const { invalid } = await searchParams;

  return (
    <main className="mx-auto max-w-2xl px-5 py-14">
      <p className="text-lg font-semibold text-brand-green">TarragonHealth</p>
      <h1 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink">
        Verify a health record
      </h1>
      <p className="mt-3 text-base leading-relaxed text-charcoal-ink/70">
        If someone has given you a TarragonHealth Health Passport, you can confirm here that we
        issued it, that it has not been altered, and that it has not been withdrawn or replaced. No
        account, no login, no charge.
      </p>

      <form action={goToRecord} className="mt-8 flex flex-wrap items-end gap-3">
        <label className="flex min-w-[18rem] flex-1 flex-col gap-1">
          <span className="text-sm font-medium text-charcoal-ink">
            Document reference
          </span>
          <input
            name="serial"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="THP-0000-0000-0000-0000"
            className="rounded-md border border-charcoal-ink/20 px-3 py-2 font-mono text-base uppercase text-charcoal-ink"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-brand-green px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
        >
          Verify
        </button>
      </form>

      {invalid && (
        <p className="mt-3 text-sm text-red-700">
          That is not a TarragonHealth reference. It begins with THP and has four groups of four
          characters after it, printed on the first page of the document.
        </p>
      )}

      <p className="mt-4 text-sm text-charcoal-ink/60">
        The reference is printed on the first page of the document, next to the square code. It
        never contains the letters I, L, O or U, so anything that looks like one of those is a 1, a
        0 or a V.
      </p>

      <section className="mt-12 rounded-lg bg-charcoal-ink/5 p-5">
        <h2 className="font-heading text-base font-semibold text-charcoal-ink">
          For employers, clinics, insurers and immigration teams
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
          Every TarragonHealth Health Passport carries a cryptographic signature over its own
          contents. You can check that signature yourself, offline and indefinitely, using the
          public keys published at{" "}
          <span className="font-mono">/.well-known/tarragon-passport-keys.json</span>. The document
          explains how on its last page. Nothing about that check depends on TarragonHealth being
          reachable, or on us knowing you did it.
        </p>
      </section>
    </main>
  );
}
