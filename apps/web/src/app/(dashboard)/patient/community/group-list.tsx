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
              {/* The topic line is dropped when it only repeats the group's name. */}
              {g.topic_label && g.topic_label.trim().toLowerCase() !== g.name.trim().toLowerCase() ? (
                <p className={`text-xs font-medium uppercase tracking-wide ${MUTED}`}>{g.topic_label}</p>
              ) : null}
              <h2 className="font-heading text-lg font-semibold">{g.name}</h2>
              <p className="text-sm leading-relaxed">{g.description}</p>
            </div>
            <p className={`flex flex-wrap items-center gap-2 text-sm ${MUTED}`}>
              {/* An empty group invites rather than counts: "0 members" reads as abandoned. */}
              <span>{g.member_count === 0 ? t("community.groups.be_first", locale) : t(memberCountKey(g.member_count), locale, { count: g.member_count })}</span>
              {g.my_status === "active" ? (
                <span className="inline-flex items-center rounded-full bg-soft-sage px-2.5 py-0.5 text-xs font-semibold text-brand-green dark:bg-brand-green/20">
                  {t("community.groups.you_are_in", locale)}
                </span>
              ) : null}
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
