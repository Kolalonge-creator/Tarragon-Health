"use client";

import { t } from "@tarragon/i18n";
import { groupBacklog } from "@tarragon/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyHint } from "@/components/ui/empty-hint";
import { LoadErrorCard } from "@/components/ui/load-error-card";
import { Select } from "@/components/ui/select";
import {
  useLearningExpiryBacklog,
  useLearningExpirySummary,
  useLearningOwnerCandidates,
  useSetLearningContentOwner,
  type LearningExpiryRow,
} from "@/lib/queries/learning-centre";

/**
 * The learning content review list (S55 expiry, people side). Shared by the admin page and the Chief Medical Officer page: both read the
 * same database functions, which refuse everyone else, so this component decides nothing about access. The buckets (30, 14, 7 days by
 * default) come from the rows, which come from versioned configuration. Nothing here changes the S55 rule that hides an item on its review date.
 */
export function ExpiryBacklog() {
  const backlog = useLearningExpiryBacklog();
  const summary = useLearningExpirySummary();
  const candidates = useLearningOwnerCandidates();
  const setOwner = useSetLearningContentOwner();

  if (backlog.isLoading) return <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{t("learn.expiry.loading")}</p>;
  if (backlog.isError || !backlog.data) {
    return <LoadErrorCard title={t("learn.expiry.title")} what={t("learn.expiry.title")} detail={t("learn.expiry.error")} />;
  }

  const groups = groupBacklog(backlog.data);
  const metric = (m: string) => summary.data?.find((r) => r.metric === m)?.n ?? 0;
  const withinBuckets = (summary.data ?? [])
    .map((r) => ({ metric: r.metric, days: /^d(\d{1,4})$/.exec(r.metric)?.[1] }))
    .filter((r): r is { metric: string; days: string } => r.days !== undefined)
    .sort((a, b) => Number(a.days) - Number(b.days));

  return (
    <div className="space-y-6">
      <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("learn.expiry.intro")}</p>

      {summary.data && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="expiry-summary">
          <SummaryTile label={t("learn.expiry.summary.hidden")} value={metric("hidden")} tone={metric("hidden") > 0 ? "red" : "grey"} />
          {withinBuckets.map((b) => (
            <SummaryTile key={b.metric} label={t("learn.expiry.summary.within", "en", { days: b.days })} value={metric(b.metric)} tone={metric(b.metric) > 0 ? "amber" : "grey"} />
          ))}
          <SummaryTile label={t("learn.expiry.summary.no_owner")} value={metric("no_owner")} tone={metric("no_owner") > 0 ? "amber" : "grey"} />
          <SummaryTile label={t("learn.expiry.summary.no_date")} value={metric("no_review_date")} tone="grey" />
        </dl>
      )}
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("learn.expiry.no_date_note")}</p>

      {groups.length === 0 && <EmptyHint>{t("learn.expiry.empty")}</EmptyHint>}

      {groups.map((g) => (
        <Card key={g.bucket} data-testid={`expiry-bucket-${g.bucket}`}>
          <CardHeader>
            <CardTitle>
              {g.days === null ? t("learn.expiry.bucket.hidden") : t("learn.expiry.bucket.within", "en", { days: String(g.days) })}
              <span className="ml-2 text-sm font-normal text-charcoal-ink/60 dark:text-night-ink/60">({g.rows.length})</span>
            </CardTitle>
            <CardDescription className="sr-only">{t("learn.expiry.title")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">
                    <th className="py-2 pr-3 font-medium">{t("learn.expiry.col.item")}</th>
                    <th className="py-2 pr-3 font-medium">{t("learn.expiry.col.due")}</th>
                    <th className="py-2 pr-3 font-medium">{t("learn.expiry.col.days")}</th>
                    <th className="py-2 pr-3 font-medium">{t("learn.expiry.col.state")}</th>
                    <th className="py-2 font-medium">{t("learn.expiry.col.owner")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
                  {g.rows.map((r) => (
                    <tr key={r.content_id}>
                      <td className="py-2 pr-3">
                        <span className="font-medium">{r.title}</span>
                        <span className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">{r.code}</span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{r.next_review_due}</td>
                      <td className="py-2 pr-3 tabular-nums">{daysLabel(r.days_until_due)}</td>
                      <td className="py-2 pr-3">
                        <StateBadge row={r} />
                      </td>
                      <td className="py-2">
                        <OwnerCell
                          row={r}
                          candidates={candidates.data ?? []}
                          saving={setOwner.isPending}
                          onChange={(ownerId) => setOwner.mutate({ contentId: r.content_id, ownerId })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
      {setOwner.isError && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {t("learn.expiry.owner.failed")}
        </p>
      )}
      {setOwner.isSuccess && <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("learn.expiry.owner.saved")}</p>}
    </div>
  );
}

function daysLabel(days: number): string {
  if (days === 0) return t("learn.expiry.days.today");
  if (days < 0) return t("learn.expiry.days.overdue", "en", { days: String(Math.abs(days)) });
  return String(days);
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: "red" | "amber" | "grey" }) {
  return (
    <div className="rounded-xl border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
      <dt className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{label}</dt>
      <dd className="mt-1">
        <Badge variant={tone}>{value}</Badge>
      </dd>
    </div>
  );
}

function StateBadge({ row }: { row: LearningExpiryRow }) {
  if (row.hidden) return <Badge variant="red">{t("learn.expiry.state.hidden")}</Badge>;
  if (row.review_flagged) return <Badge variant="amber">{t("learn.expiry.state.flagged")}</Badge>;
  return <Badge variant="green">{t("learn.expiry.state.live")}</Badge>;
}

function OwnerCell({
  row,
  candidates,
  saving,
  onChange,
}: {
  row: LearningExpiryRow;
  candidates: readonly { profile_id: string; full_name: string }[];
  saving: boolean;
  onChange: (ownerId: string | null) => void;
}) {
  return (
    <div className="space-y-1">
      {!row.owner_profile_id && <span className="block text-xs text-amber-800 dark:text-amber-300">{t("learn.expiry.owner.none")}</span>}
      <Select
        aria-label={`${t("learn.expiry.owner.assign")}: ${row.title}`}
        value={row.owner_profile_id ?? ""}
        disabled={saving}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className="h-8 min-w-40 text-xs"
      >
        <option value="">{row.owner_profile_id ? t("learn.expiry.owner.clear") : t("learn.expiry.owner.choose")}</option>
        {candidates.map((c) => (
          <option key={c.profile_id} value={c.profile_id}>
            {c.full_name}
          </option>
        ))}
      </Select>
    </div>
  );
}
