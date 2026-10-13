import type { Metadata } from "next";
import { headers } from "next/headers";
import { openShare } from "@/lib/my-health/open-share";
import { t } from "@tarragon/i18n";
import { PinGate } from "./pin-gate";
import { SharedRecordView, type SharedData } from "./shared-record-view";

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
  const h = await headers();
  const client = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  const result = await openShare(token, null, client);

  if (result.kind === "ok") return <SharedRecordView record={result.record as unknown as SharedData} />;
  // A valid link that needs its PIN. The record is not fetched until the PIN is right.
  if (result.kind === "pin_required" || result.kind === "try_later") {
    return <PinGate token={token} initialAttemptsLeft={null} />;
  }

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
