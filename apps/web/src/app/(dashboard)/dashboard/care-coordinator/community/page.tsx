import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { modQueueSchema, safetyQueueSchema } from "@/lib/community/model";
import { getCommunityStaffContext } from "@/components/community/staff-rpc";
import { ModerationQueue } from "@/components/community/moderation-queue";
import { SafetyQueue } from "@/components/community/safety-queue";
import { modDecideAction, modSanctionAction, safetyDecideAction } from "@/components/community/staff-actions";

export const metadata = { title: "Community" };
export const dynamic = "force-dynamic";

const LOAD_FAILED = "We could not load this just now. Please reload the page in a moment.";

export default async function CareCoordinatorCommunityPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await getCommunityStaffContext();

  if (!ctx || (!ctx.is_moderator && !ctx.is_safety_reviewer)) {
    return (
      <section className="rounded-lg border border-charcoal-ink/10 bg-white p-6">
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">You do not have community duties</h2>
        <p className="mt-1 text-sm text-charcoal-ink/70">
          Moderating and safety review are given to named staff by an administrator. If you think you should have them, ask your administrator.
        </p>
      </section>
    );
  }

  const requested = (await searchParams).tab;
  const tab: "moderation" | "safety" =
    requested === "safety" && ctx.is_safety_reviewer ? "safety" : requested === "moderation" && ctx.is_moderator ? "moderation" : ctx.is_moderator ? "moderation" : "safety";

  const supabase = await createClient();
  let content: React.ReactNode;
  if (tab === "moderation") {
    const { data, error } = await supabase.rpc("community_mod_queue", {});
    const parsed = modQueueSchema.safeParse(data);
    content =
      error || !parsed.success ? (
        <p role="alert" className="text-sm text-red-700">
          {LOAD_FAILED}
        </p>
      ) : (
        <ModerationQueue items={parsed.data.items} onDecide={modDecideAction} onSanction={modSanctionAction} />
      );
  } else {
    const { data, error } = await supabase.rpc("community_safety_queue");
    const parsed = safetyQueueSchema.safeParse(data);
    content =
      error || !parsed.success ? (
        <p role="alert" className="text-sm text-red-700">
          {LOAD_FAILED}
        </p>
      ) : (
        <SafetyQueue items={parsed.data.items} onDecide={safetyDecideAction} />
      );
  }

  const tabs = [
    ...(ctx.is_moderator ? [{ key: "moderation" as const, label: "Moderation queue" }] : []),
    ...(ctx.is_safety_reviewer ? [{ key: "safety" as const, label: "Safety" }] : []),
  ];

  return (
    <div className="space-y-4">
      {tabs.length > 1 && (
        <nav aria-label="Community sections" className="flex gap-2">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={`/dashboard/care-coordinator/community?tab=${t.key}`}
              aria-current={t.key === tab ? "page" : undefined}
              className={
                t.key === tab
                  ? "rounded-md bg-brand-green/10 px-3 py-1.5 text-sm font-semibold text-brand-green underline"
                  : "rounded-md px-3 py-1.5 text-sm text-charcoal-ink/70 hover:text-charcoal-ink"
              }
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}
      {content}
    </div>
  );
}
