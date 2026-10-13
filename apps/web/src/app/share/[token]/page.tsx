import type { Metadata } from "next";
import { peekShare } from "@/lib/my-health/open-share";
import { t } from "@tarragon/i18n";
import { PinGate } from "./pin-gate";

export const metadata: Metadata = {
  title: "Shared health record",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Only a peek: loading this page is not an open. A chat app's link preview or a browser prefetch must not log "someone opened your link",
  // start a one-session window, or use up the recipient's chance to see the record. The record is fetched on the explicit button press.
  const peek = await peekShare(token);
  if (peek !== "unavailable") return <PinGate token={token} needsPin={peek === "pin_required"} />;

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-lg font-semibold text-charcoal-ink">
        This link is not available
      </h1>
      <p className="mt-2 text-sm text-charcoal-ink/70">
        {t("share.public.not_available")}
      </p>
    </main>
  );
}
