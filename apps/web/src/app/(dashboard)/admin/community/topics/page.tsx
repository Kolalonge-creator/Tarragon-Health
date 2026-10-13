import { CommunityNav, LoadFailed } from "../community-nav";
import { loadTopics, requireAdmin } from "../load";
import { TopicForm } from "../topic-form";
import { card, h1, h2 } from "../ui";

export const metadata = { title: "Community topics" };
export const dynamic = "force-dynamic";

export default async function CommunityTopicsPage() {
  await requireAdmin();
  const topics = await loadTopics();
  return (
    <div className="space-y-8">
      <h1 className={h1}>Community topics</h1>
      <CommunityNav />
      <p className="max-w-3xl text-sm text-charcoal-ink/70">
        A topic groups related community groups. If a topic needs Chief Medical Officer approval of group rules, its groups cannot go live until the Chief Medical Officer approves their rules. Only the Chief Medical Officer can turn that setting off.
      </p>
      {!topics.ok ? (
        <LoadFailed what="The topics" />
      ) : (
        <>
          <ul className="space-y-3">
            {topics.data.topics.map((t) => (
              <li key={t.code}>
                <details className={card}>
                  <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
                    {t.label} ({t.code}){t.is_active ? "" : ", not active"}{t.requires_cmo_rules ? ", needs CMO approval of group rules" : ""}
                  </summary>
                  <div className="mt-4 max-w-2xl"><TopicForm topic={t} idPrefix={`t-${t.code}`} /></div>
                </details>
              </li>
            ))}
            {topics.data.topics.length === 0 && <li>No topics yet.</li>}
          </ul>
          <section aria-labelledby="add" className={card}>
            <h2 id="add" className={h2}>Add a topic</h2>
            <div className="mt-3 max-w-2xl"><TopicForm idPrefix="t-new" /></div>
          </section>
        </>
      )}
    </div>
  );
}
