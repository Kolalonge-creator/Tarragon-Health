import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { t } from "@tarragon/i18n";
import { supabase } from "@/lib/supabase";
import { parseAccessLog, parseDeletionStatus, type AccessRow, type DeletionStatus } from "@/lib/cycle-privacy";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, SecondaryButton } from "@/ui/legacy-kit";

/**
 * Who has looked at the cycle summary, and deleting what the person entered (S66, decision C). Same RPCs and same rules as the web card:
 * a failed load says so and is never shown as "nobody has looked"; deletion is a request with a waiting period she can cancel; what the
 * care team recorded or acted on is kept sealed.
 */

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });

export function CyclePrivacyControls() {
  const colors = useLegacyColors();
  const [access, setAccess] = useState<AccessRow[] | "failed" | null>(null);
  const [status, setStatus] = useState<DeletionStatus | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);

  const load = useCallback(async () => {
    const [a, d] = await Promise.all([supabase.rpc("my_reproductive_access_log", { p_limit: 20 }), supabase.rpc("reproductive_tracker_deletion_status")]);
    setAccess(a.error ? "failed" : parseAccessLog(a.data));
    setStatus(d.error ? "failed" : parseDeletionStatus(d.data));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(name: "request_reproductive_tracker_deletion" | "cancel_reproductive_tracker_deletion") {
    setBusy(true);
    setProblem(false);
    const { error } = await supabase.rpc(name);
    setBusy(false);
    if (error) setProblem(true);
    await load();
  }

  return (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("cycle.access.title")}</Text>
        <MutedText>{t("cycle.access.intro")}</MutedText>
        {access === "failed" && <ErrorText>{t("cycle.access.load_failed")}</ErrorText>}
        {Array.isArray(access) && access.length === 0 && <MutedText>{t("cycle.access.empty")}</MutedText>}
        {Array.isArray(access) &&
          access.map((row, i) => (
            <Text key={`${row.at}-${i}`} style={{ fontSize: 13, color: colors.ink }}>
              {t(row.result === "success" ? "cycle.access.row" : "cycle.access.refused", undefined, { when: when(row.at), reader: row.reader })}
            </Text>
          ))}
        <MutedText>{t("cycle.access.not_shared")}</MutedText>
      </Card>

      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("cycle.delete.title")}</Text>
        <MutedText>{t("cycle.delete.intro")}</MutedText>
        {status === "failed" && <ErrorText>{t("cycle.delete.failed")}</ErrorText>}
        {status && status !== "failed" && (
          <>
            <Text style={{ fontSize: 13, color: colors.ink }}>
              {t("cycle.delete.counts", undefined, {
                cycles: status.counts.menstrual_cycles,
                logs: status.counts.menstrual_daily_logs + status.counts.menopause_logs_deleted,
                reminders: status.counts.reminders,
                sealed: status.counts.menopause_logs_sealed,
              })}
            </Text>
            {status.pending ? (
              <>
                <Text style={{ fontSize: 13, color: colors.ink }}>{t("cycle.delete.pending", undefined, { when: when(status.pending.execute_after) })}</Text>
                <SecondaryButton title={t("cycle.delete.cancel")} loading={busy} onPress={() => void act("cancel_reproductive_tracker_deletion")} />
              </>
            ) : (
              <SecondaryButton title={t("cycle.delete.ask")} loading={busy} onPress={() => void act("request_reproductive_tracker_deletion")} />
            )}
            {status.lastReceipt && (
              <MutedText>
                {t("cycle.delete.receipt", undefined, {
                  when: when(status.lastReceipt.completed_at),
                  cycles: status.lastReceipt.receipt.menstrual_cycles_deleted,
                  logs: status.lastReceipt.receipt.menstrual_daily_logs_deleted + status.lastReceipt.receipt.menopause_logs_deleted,
                  reminders: status.lastReceipt.receipt.reminders_deleted,
                  sealed: status.lastReceipt.receipt.menopause_logs_sealed_kept,
                })}
              </MutedText>
            )}
          </>
        )}
        {problem && <ErrorText>{t("cycle.delete.failed")}</ErrorText>}
      </Card>
    </View>
  );
}
