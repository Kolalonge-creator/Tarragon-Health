import Link from "next/link";
import { getCommunityStaffContext } from "@/components/community/staff-rpc";
import { CommunitySignoffPanel } from "../../_signoff-panels/community-panel";

export const metadata = { title: "Community sign-off" };
export const dynamic = "force-dynamic";

/** The same block the sign-off hub shows inline, on its own address for a direct link. The hub is where the Chief Medical Officer finds it. */
export default async function CommunitySignoffPage() {
  const ctx = await getCommunityStaffContext();
  if (!ctx || !ctx.is_cmo) {
    return (
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Community sign-off</h1>
        <p className="text-sm text-charcoal-ink/70">This page is for the Chief Medical Officer.</p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Community sign-off</h1>
        <p className="text-sm text-charcoal-ink/60">
          Read each item and sign it yourself. Each signing is recorded with your name and the date. Nothing here switches the community on. This is
          also on the{" "}
          <Link href="/clinician/clinical-signoff" className="font-medium text-brand-green underline">
            sign-off hub
          </Link>
          , with everything else that needs your signature.
        </p>
      </div>
      <CommunitySignoffPanel />
    </div>
  );
}
