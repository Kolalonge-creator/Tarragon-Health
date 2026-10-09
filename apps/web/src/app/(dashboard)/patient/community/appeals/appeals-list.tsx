import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { formatPatientDate } from "@/lib/format-date";
import type { MyActions } from "@/lib/community/model";
import { MUTED } from "../styles";
import { AppealForm } from "./appeal-form";

const SANCTION_KEY: Record<MyActions["sanctions"][number]["kind"], MessageKey> = {
  warning: "community.appeals.sanction_warning",
  mute: "community.appeals.sanction_mute",
  suspend: "community.appeals.sanction_suspend",
  ban: "community.appeals.sanction_ban",
};
const STATUS_KEY: Record<"open" | "upheld" | "overturned", MessageKey> = {
  open: "community.appeals.status.open",
  upheld: "community.appeals.status.upheld",
  overturned: "community.appeals.status.overturned",
};

/**
 * Removed posts and access changes, with an appeal form where one is still possible. Deliberately shows no moderator name and never the
 * text of a removed post: only the group's name, what happened and when.
 */
export function AppealsList({ actions, locale }: { actions: MyActions; locale: Locale }) {
  const { removed_posts: removed, sanctions } = actions;
  if (removed.length === 0 && sanctions.length === 0) return <p className={MUTED}>{t("community.appeals.empty", locale)}</p>;
  return (
    <div className="space-y-8">
      {removed.length > 0 ? (
        <section aria-labelledby="appeals-removed-title" className="space-y-3">
          <h2 id="appeals-removed-title" className="font-heading text-lg font-semibold">
            {t("community.appeals.removed_title", locale)}
          </h2>
          <ul className="space-y-3">
            {removed.map((r) => (
              <li key={r.post_id} className="space-y-2 rounded-xl border p-4">
                <p>{t("community.appeals.removed_line", locale, { group: r.group_name })}</p>
                {r.removed_at ? <p className={`text-sm ${MUTED}`}>{formatPatientDate(r.removed_at)}</p> : null}
                {r.appeal_status ? <p className="text-sm font-medium">{t(STATUS_KEY[r.appeal_status], locale)}</p> : null}
                {r.can_appeal ? <AppealForm kind="removal" targetId={r.post_id} locale={locale} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {sanctions.length > 0 ? (
        <section aria-labelledby="appeals-sanctions-title" className="space-y-3">
          <h2 id="appeals-sanctions-title" className="font-heading text-lg font-semibold">
            {t("community.appeals.sanctions_title", locale)}
          </h2>
          <ul className="space-y-3">
            {sanctions.map((s) => (
              <li key={s.sanction_id} className="space-y-2 rounded-xl border p-4">
                <p>
                  {t(SANCTION_KEY[s.kind], locale)}
                  {s.group_name ? ` (${s.group_name})` : ""}
                </p>
                <p className={`text-sm ${MUTED}`}>{formatPatientDate(s.starts_at)}</p>
                {s.overturned ? <p className="text-sm font-medium">{t("community.appeals.overturned_note", locale)}</p> : null}
                {s.appeal_status ? <p className="text-sm font-medium">{t(STATUS_KEY[s.appeal_status], locale)}</p> : null}
                {s.can_appeal ? <AppealForm kind="sanction" targetId={s.sanction_id} locale={locale} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
