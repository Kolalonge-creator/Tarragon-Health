import Link from "next/link";
import { t, type Locale } from "@tarragon/i18n";
import { Card } from "@/components/ui/card";
import { memberCountKey, type GroupSummary } from "@/lib/community/model";
import { LINK_BUTTON, MUTED } from "./styles";

/** The groups a member can open. Cards show the group's name, what it is for, its topic and size, and whether the member is in it. */
export function GroupList({ groups, locale }: { groups: readonly GroupSummary[]; locale: Locale }) {
  if (groups.length === 0) return <p className={MUTED}>{t("community.groups.empty", locale)}</p>;
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {groups.map((g) => (
        <li key={g.id}>
          <Card className="flex h-full flex-col gap-3 p-5">
            <div className="space-y-1">
              <p className={`text-xs font-medium uppercase tracking-wide ${MUTED}`}>{g.topic_label}</p>
              <h2 className="font-heading text-lg font-semibold">{g.name}</h2>
              <p className="text-sm leading-relaxed">{g.description}</p>
            </div>
            <p className={`text-sm ${MUTED}`}>
              {t(memberCountKey(g.member_count), locale, { count: g.member_count })}
              {g.my_status === "active" ? ` - ${t("community.groups.you_are_in", locale)}` : ""}
            </p>
            <div className="mt-auto flex flex-wrap items-center gap-2">
              {g.full === true && g.my_status !== "active" ? (
                <span className="inline-flex min-h-11 items-center rounded-md bg-soft-sage px-3 text-sm font-medium dark:bg-brand-green/20">{t("community.groups.full", locale)}</span>
              ) : null}
              <Link href={`/patient/community/${encodeURIComponent(g.slug)}`} className={LINK_BUTTON} aria-label={`${t("community.groups.open", locale)}: ${g.name}`}>
                {t("community.groups.open", locale)}
              </Link>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
