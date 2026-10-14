"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { t } from "@tarragon/i18n";

export function PassToggle({ enabled, signed }: { enabled: boolean; signed: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [state, setState] = useState<"idle" | "saved" | "failed">("idle");
  const [pending, start] = useTransition();

  const save = (next: boolean) =>
    start(async () => {
      const { error } = await createClient().rpc("set_lock_screen_pass", { p_enabled: next });
      if (error) {
        setState("failed");
        return;
      }
      setOn(next);
      setState("saved");
      router.refresh();
    });

  return (
    <div className="space-y-3 print:hidden">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={(e) => save(e.target.checked)}
          className="mt-0.5 h-5 w-5 accent-brand-green"
        />
        <span>
          <span className="font-medium">{t("my_health.pass.toggle")}</span>
          <span className="block text-xs text-charcoal-ink/70">{on ? t("my_health.pass.on_hint") : t("my_health.pass.off_hint")}</span>
        </span>
      </label>
      <p className="text-xs text-charcoal-ink/70">{t("my_health.pass.shared_phone")}</p>
      {!signed && <p className="text-xs text-charcoal-ink/70">{t("my_health.pass.unsigned")}</p>}
      {state === "saved" && (
        <p role="status" className="text-xs text-green-800">
          {t("my_health.pass.saved")}
        </p>
      )}
      {state === "failed" && (
        <p role="alert" className="text-xs text-red-700">
          {t("my_health.pass.failed")}
        </p>
      )}
      {on && (
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          {t("my_health.pass.print")}
        </Button>
      )}
    </div>
  );
}
