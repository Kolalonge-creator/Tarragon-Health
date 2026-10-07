"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { formatPatientDate } from "@/lib/format-date";
import { t } from "@tarragon/i18n";
import { parseAccessLog, parseDeletionStatus, type AccessRow, type DeletionStatus } from "./privacy-parsers";

/**
 * Who can see this, and deleting what you entered (S66: the privacy position, and decision C). Lives inside the private section.
 *  - The access list shows every time a member of the care team opened the cycle summary, and every time one tried and was refused.
 *    A failed load says so plainly: it is never shown as "nobody has looked".
 *  - Deletion is a request with a waiting period the person can cancel. What the care team recorded or acted on is kept sealed.
 */
export function CyclePrivacyControls() {
  const [access, setAccess] = useState<AccessRow[] | "failed" | null>(null);
  const [deletion, setDeletion] = useState<DeletionStatus | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [a, d] = await Promise.all([supabase.rpc("my_reproductive_access_log", { p_limit: 20 }), supabase.rpc("reproductive_tracker_deletion_status")]);
    setAccess(a.error ? "failed" : parseAccessLog(a.data));
    setDeletion(d.error ? "failed" : parseDeletionStatus(d.data));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(name: "request_reproductive_tracker_deletion" | "cancel_reproductive_tracker_deletion") {
    setBusy(true);
    setProblem(false);
    const { error } = await createClient().rpc(name);
    setBusy(false);
    if (error) setProblem(true);
    await load();
  }

  const when = (iso: string) => formatPatientDate(iso, { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("cycle.access.title")}</CardTitle>
          <CardDescription>{t("cycle.access.intro")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {access === "failed" && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {t("cycle.access.load_failed")}
            </p>
          )}
          {Array.isArray(access) && access.length === 0 && <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("cycle.access.empty")}</p>}
          {Array.isArray(access) &&
            access.map((row, i) => (
              <p key={`${row.at}-${i}`} className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
                {t(row.result === "success" ? "cycle.access.row" : "cycle.access.refused", undefined, { when: when(row.at), reader: row.reader })}
              </p>
            ))}
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("cycle.access.not_shared")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("cycle.delete.title")}</CardTitle>
          <CardDescription>{t("cycle.delete.intro")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {deletion === "failed" && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {t("cycle.delete.failed")}
            </p>
          )}
          {deletion && deletion !== "failed" && (
            <>
              <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
                {t("cycle.delete.counts", undefined, {
                  cycles: deletion.counts.menstrual_cycles,
                  logs: deletion.counts.menstrual_daily_logs + deletion.counts.menopause_logs_deleted,
                  reminders: deletion.counts.reminders,
                  sealed: deletion.counts.menopause_logs_sealed,
                })}
              </p>
              {deletion.pending ? (
                <div className="space-y-2">
                  <p className="text-sm" role="status">
                    {t("cycle.delete.pending", undefined, { when: when(deletion.pending.execute_after) })}
                  </p>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void act("cancel_reproductive_tracker_deletion")}>
                    {t("cycle.delete.cancel")}
                  </Button>
                </div>
              ) : (
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void act("request_reproductive_tracker_deletion")}>
                  {t("cycle.delete.ask")}
                </Button>
              )}
              {deletion.lastReceipt && (
                <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  {t("cycle.delete.receipt", undefined, {
                    when: when(deletion.lastReceipt.completed_at),
                    cycles: deletion.lastReceipt.receipt.menstrual_cycles_deleted,
                    logs: deletion.lastReceipt.receipt.menstrual_daily_logs_deleted + deletion.lastReceipt.receipt.menopause_logs_deleted,
                    reminders: deletion.lastReceipt.receipt.reminders_deleted,
                    sealed: deletion.lastReceipt.receipt.menopause_logs_sealed_kept,
                  })}
                </p>
              )}
            </>
          )}
          {problem && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {t("cycle.delete.failed")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
