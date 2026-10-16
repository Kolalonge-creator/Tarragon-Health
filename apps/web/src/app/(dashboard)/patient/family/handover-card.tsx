"use client";

import { useState, useTransition } from "react";
import { t } from "@tarragon/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { completeHandoverAction } from "./handover-actions";

export interface HandoverGuardian {
  id: string;
  first_name: string;
}

/**
 * What a young person sees after their 18th birthday and first sign-in (v5 1.18). Every box starts unticked: the default is
 * that guardian access ENDS when they finish, and they opt each person in to keep viewing. The wording of the consent line is
 * draft until counsel approves it.
 */
export function HandoverCard({ guardians }: { guardians: HandoverGuardian[] }) {
  const [keep, setKeep] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dob, setDob] = useState("");
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p role="status" className="text-sm">
            {t("handover.done")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("handover.title")}</CardTitle>
        <CardDescription>{t("handover.body")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {guardians.length === 0 ? (
          <p className="text-sm">{t("handover.nobody")}</p>
        ) : (
          <fieldset className="space-y-2">
            {guardians.map((g) => (
              <label key={g.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={keep.includes(g.id)}
                  onChange={(e) => setKeep((k) => (e.target.checked ? [...k, g.id] : k.filter((x) => x !== g.id)))}
                />
                {t("handover.keep", "en", { name: g.first_name })}
              </label>
            ))}
            <p className="text-xs text-charcoal-ink/60">{t("handover.keep_note")}</p>
          </fieldset>
        )}
        <p className="text-xs text-charcoal-ink/60">{t("handover.consent_notice")}</p>
        <div className="space-y-1">
          <label htmlFor="handover-dob" className="text-sm font-medium">
            {t("handover.dob_label")}
          </label>
          <input id="handover-dob" type="date" required value={dob} onChange={(e) => setDob(e.target.value)} className="block rounded-md border px-2 py-1 text-sm" />
          <p className="text-xs text-charcoal-ink/60">{t("handover.dob_note")}</p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <Button
          type="button"
          disabled={pending || dob === ""}
          className="rounded-xl"
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await completeHandoverAction({ keep, dateOfBirth: dob });
              if (result?.ok) setDone(true);
              else if (result?.reason === "wrong_dob") setError(t("handover.error.dob", "en", { n: String(result.attemptsLeft ?? 0) }));
              else if (result?.reason === "needs_verified_phone") setError(t("handover.error.phone"));
              else if (result?.reason === "locked") setError(t("handover.error.locked"));
              else setError(t("handover.error"));
            });
          }}
        >
          {t("handover.finish")}
        </Button>
      </CardContent>
    </Card>
  );
}
