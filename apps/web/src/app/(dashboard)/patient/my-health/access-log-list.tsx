"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { describeEntry, fetchAccessLog, type AccessLogEntry } from "@/lib/my-health/access-log";
import { t } from "@tarragon/i18n";

const when = (value: string) =>
  new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function AccessLogList({ initial, pageSize }: { initial: AccessLogEntry[]; pageSize: number }) {
  const [entries, setEntries] = useState(initial);
  const [more, setMore] = useState(initial.length >= pageSize);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  const loadOlder = () =>
    start(async () => {
      const last = entries[entries.length - 1];
      if (!last) return;
      const r = await fetchAccessLog(createClient(), { at: last.at, rid: last.rid });
      if (!r.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setEntries((prev) => [...prev, ...r.entries]);
      setMore(r.entries.length >= pageSize);
    });

  if (entries.length === 0) return <p className="text-sm text-charcoal-ink/60">{t("my_health.log.empty")}</p>;

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {entries.map((e) => {
          const d = describeEntry(e);
          return (
            <li key={e.rid} className="rounded-lg border border-charcoal-ink/10 px-3 py-2 text-sm">
              <p className="font-medium text-charcoal-ink">{d.title}</p>
              <p className="text-charcoal-ink/70">{d.who}</p>
              <p className="text-xs text-charcoal-ink/60">
                {[when(e.at), d.what].filter(Boolean).join(" · ")}
                {d.status ? ` · ${d.status}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
      {failed && (
        <p role="alert" className="text-sm text-red-700">
          {t("my_health.log.failed")}
        </p>
      )}
      {more && (
        <Button variant="outline" size="sm" onClick={loadOlder} disabled={pending}>
          {t("my_health.log.more")}
        </Button>
      )}
    </div>
  );
}
