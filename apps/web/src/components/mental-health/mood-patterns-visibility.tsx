"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/** Hide the patterns view, or show it again. A patient preference only; nothing else reads it. */
export function PatternsVisibilityButton({ hide }: { hide: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setFailed(false);
            const { error } = await createClient().rpc("set_mood_insights_hidden", { p_hidden: hide });
            if (error) setFailed(true);
            else router.refresh();
          })
        }
      >
        {hide ? t("insights.hide") : t("insights.show_again")}
      </Button>
      {failed && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{t("insights.error")}</p>}
    </div>
  );
}
