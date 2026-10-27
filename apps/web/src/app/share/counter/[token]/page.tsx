import type { Metadata } from "next";
import { peekShare } from "@/lib/my-health/open-share";
import { t } from "@tarragon/i18n";
import { CounterGate } from "./counter-gate";

export const metadata: Metadata = {
  title: "Doses marked taken",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The landing page only peeks (a link preview or prefetch is not an open); the record is fetched on the explicit PIN submit. */
export default async function CounterPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const peek = await peekShare(token);
  if (peek !== "unavailable") return <CounterGate token={token} />;

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-lg font-semibold text-charcoal-ink">This link is not available</h1>
      <p className="mt-2 text-sm text-charcoal-ink/70">{t("share.public.not_available")}</p>
    </main>
  );
}
