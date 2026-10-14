import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { UNMASK_NOT_ALLOWED, unmaskCandidatesSchema, type UnmaskCandidate } from "@/components/community/unmask-shared";
import { DoctorUnmask } from "./unmask-client";

export const metadata = { title: "Look up a member" };
export const dynamic = "force-dynamic";

export default async function DoctorUnmaskPage() {
  const supabase = await createClient();
  const res = await supabase.rpc("community_unmask_candidates");
  const refused = res.error?.code === "42501";
  const parsed = unmaskCandidatesSchema.safeParse(res.data);
  const candidates: UnmaskCandidate[] | null = !res.error && parsed.success ? parsed.data.items : null;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Look up a member</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">
          A member&apos;s name can be looked up only while that member has a recent safety concern in that group: a post held back for emergency or self-harm wording, or a report that someone may be in danger. Every lookup is written down with your reason, and the Chief Medical Officer and the data protection officer are told. There is a daily limit.
        </p>
        <p className="mt-2 text-sm">
          <Link href="/clinician/community" className="font-medium text-brand-green underline">Back to Community</Link>
        </p>
      </div>
      {refused ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{UNMASK_NOT_ALLOWED}</p>
      ) : (
        <div className="max-w-2xl">
          <DoctorUnmask candidates={candidates} />
        </div>
      )}
    </div>
  );
}
