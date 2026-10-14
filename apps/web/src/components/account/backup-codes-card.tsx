import { createClient } from "@/lib/supabase/server";
import { BackupCodesPanel } from "./backup-codes-panel";

/**
 * Backup codes (S03b). A server component so the card shows, from the database, whether codes exist and how many are left. The
 * codes themselves are never readable again after they were shown once; only the count is.
 */
export async function BackupCodesCard() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_backup_code_status");
  const status = (data ?? {}) as { total?: number; remaining?: number; generated_at?: string | null };
  return (
    <BackupCodesPanel
      total={status.total ?? 0}
      remaining={status.remaining ?? 0}
      generatedAt={status.generated_at ?? null}
    />
  );
}
