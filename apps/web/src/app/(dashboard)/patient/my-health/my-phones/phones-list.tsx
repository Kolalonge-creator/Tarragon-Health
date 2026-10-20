"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { fetchMyPhones, reportPhoneLost } from "@/lib/my-phones/phones";
import { canReportLost, phoneState, sortPhones, type PhoneLeaseRow, type PhoneState } from "@tarragon/shared";
import { describePhone, t } from "@tarragon/i18n";

/** Colour is never the only signal: every state has its own words, and the dot is decoration (aria-hidden). */
const DOT: Record<PhoneState, string> = {
  active: "bg-green-600",
  lease_ending: "bg-amber-500",
  lease_lapsed: "bg-amber-500",
  lost_reported: "bg-amber-500",
  cleared: "bg-charcoal-ink/40",
  quiet: "bg-charcoal-ink/40",
};

export function PhonesList({ initial }: { initial: PhoneLeaseRow[] }) {
  const [phones, setPhones] = useState(initial);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  // The clock at the time the list was shown (a lazy initialiser, so it is not read again on every render).
  const [now] = useState(() => Date.now());

  if (phones.length === 0) return <p className="text-sm text-charcoal-ink/60">{t("phones.empty")}</p>;

  const report = (deviceId: string) =>
    start(async () => {
      const supabase = createClient();
      const accepted = await reportPhoneLost(supabase, deviceId);
      setConfirming(null);
      if (!accepted) {
        setMessage({ kind: "error", text: t("phones.lost.failed") });
        return;
      }
      setMessage({ kind: "ok", text: t("phones.lost.done") });
      const fresh = await fetchMyPhones(supabase);
      if (fresh.ok) setPhones(fresh.phones);
    });

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {sortPhones(phones, now).map((p) => {
          const state = phoneState(p, now);
          const copy = describePhone({
            state,
            platform: p.platform,
            lastCheckinAt: p.last_checkin_at,
            leaseExpiresAt: p.lease_expires_at,
            wipeConfirmedAt: p.wipe_confirmed_at,
            unsentAtWipe: p.unsent_at_wipe,
            dangerAtWipe: p.danger_at_wipe,
          });
          return (
            <li key={p.device_id} className="rounded-lg border border-charcoal-ink/10 px-3 py-3 text-sm">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[state]}`} />
                <p className="font-medium text-charcoal-ink">{copy.name}</p>
              </div>
              <p className="mt-1 text-charcoal-ink/70">{copy.stateLine}</p>
              {copy.clearedLines.map((line) => (
                <p key={line} className="text-charcoal-ink/70">
                  {line}
                </p>
              ))}
              <p className="text-xs text-charcoal-ink/60">{copy.lastSeen}</p>
              {canReportLost(state) &&
                (confirming === p.device_id ? (
                  <div className="mt-3 space-y-2 rounded-md bg-charcoal-ink/5 p-3" role="group" aria-label={t("phones.lost.title")}>
                    <p className="font-medium text-charcoal-ink">{t("phones.lost.title")}</p>
                    <p className="text-charcoal-ink/80">{t("phones.lost.body")}</p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => report(p.device_id)} disabled={pending}>
                        {t("phones.lost.confirm")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirming(null)} disabled={pending}>
                        {t("phones.lost.cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button className="mt-3" size="sm" variant="outline" onClick={() => setConfirming(p.device_id)}>
                    {t("phones.lost.button")}
                  </Button>
                ))}
            </li>
          );
        })}
      </ul>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm text-red-700" : "text-sm text-charcoal-ink/80"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
