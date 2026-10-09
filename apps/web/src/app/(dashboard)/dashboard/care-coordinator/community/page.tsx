import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { appealQueueSchema, modQueueSchema, modRecentSchema, safetyQueueSchema, sampleQueueSchema } from "@/lib/community/model";
import { getCommunityStaffContext } from "@/components/community/staff-rpc";
import { ModerationQueue } from "@/components/community/moderation-queue";
import { RecentPosts } from "@/components/community/recent-posts";
import { SafetyQueue } from "@/components/community/safety-queue";
import { AppealQueue } from "@/components/community/appeal-queue";
import { SampleQueue } from "@/components/community/sample-queue";
import { DisplayNameForm } from "@/components/community/display-name-form";
import {
  appealDecideAction, modDecideAction, modRecentAction, modRemoveRecentAction, modSanctionAction, safetyDecideAction, sampleReviewAction, setDisplayNameAction,
} from "@/components/community/staff-actions";

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

  type Tab = "moderation" | "recent" | "appeals" | "second_look" | "safety";
  const allowed: Tab[] = [
    ...(ctx.is_moderator ? (["moderation", "recent", "appeals", "second_look"] as const) : []),
    ...(ctx.is_safety_reviewer ? (["safety"] as const) : []),
  ];
  const requested = (await searchParams).tab;
  const tab: Tab = allowed.find((t) => t === requested) ?? allowed[0];

  const supabase = await createClient();
  const failed = (
    <p role="alert" className="text-sm text-red-700">
      {LOAD_FAILED}
    </p>
  );
  let content: React.ReactNode;
  if (tab === "moderation") {
    const { data, error } = await supabase.rpc("community_mod_queue", {});
    const parsed = modQueueSchema.safeParse(data);
    content =
      error || !parsed.success ? failed : <ModerationQueue items={parsed.data.items} onDecide={modDecideAction} onSanction={modSanctionAction} />;
  } else if (tab === "recent") {
    const { data, error } = await supabase.rpc("community_mod_recent", {});
    const parsed = modRecentSchema.safeParse(data);
    content =
      error || !parsed.success ? failed : <RecentPosts initial={parsed.data.items} onLoadOlder={modRecentAction} onRemove={modRemoveRecentAction} />;
  } else if (tab === "appeals") {
    const { data, error } = await supabase.rpc("community_appeal_queue");
    const parsed = appealQueueSchema.safeParse(data);
    content = error || !parsed.success ? failed : <AppealQueue items={parsed.data.items} onDecide={appealDecideAction} />;
  } else if (tab === "second_look") {
    const { data, error } = await supabase.rpc("community_sample_queue");
    const parsed = sampleQueueSchema.safeParse(data);
    content = error || !parsed.success ? failed : <SampleQueue items={parsed.data.items} onReview={sampleReviewAction} />;
  } else {
    const { data, error } = await supabase.rpc("community_safety_queue");
    const parsed = safetyQueueSchema.safeParse(data);
    content = error || !parsed.success ? failed : <SafetyQueue items={parsed.data.items} onDecide={safetyDecideAction} />;
  }

  const LABEL: Record<Tab, string> = { moderation: "Moderation queue", recent: "All recent posts", appeals: "Appeals", second_look: "Second look", safety: "Safety" };
  const tabs = allowed.map((key) => ({ key, label: LABEL[key] }));

  return (
    <div className="space-y-4">
      <section aria-label="On duty" className="rounded-lg border border-charcoal-ink/15 bg-warm-ivory p-4 text-sm text-charcoal-ink">
        <p className="font-medium">On duty</p>
        <p>
          The moderation team covers every hour of the week, so someone is always on duty. Items that members have reported come first. After
          that, new items are listed oldest first, so the one that has waited longest is near the top. Pictures are checked here before the group sees them.
        </p>
      </section>
      {tabs.length > 1 && (
        <nav aria-label="Community sections" className="flex flex-wrap gap-2">
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
      <DisplayNameForm onSave={setDisplayNameAction} />
    </div>
  );
}
