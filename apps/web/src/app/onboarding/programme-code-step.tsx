"use client";

import { useState, useTransition } from "react";
import { t, type MessageKey } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { joinProgrammeCode } from "./actions";
import { OnboardingNarration } from "./onboarding-narration";

/**
 * Optional sponsor or programme code (S41, spec 1.8). Skippable and never blocks setup. A code only records that the person
 * joined; it unlocks nothing by itself (entitlements wait for S26) and shares nothing (sharing is its own choice).
 */
export function ProgrammeCodeStep() {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<MessageKey | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const r = await joinProgrammeCode(code);
      if (r.status === "joined" || r.status === "already") {
        setDone(true);
        setMessage("onb.cohort.ok");
      } else setMessage(r.status === "bad_code" ? "onb.cohort.bad" : "onb.cohort.error");
    });
  }

  if (done) {
    return (
      <p role="status" className="rounded-xl border border-brand-green/20 bg-brand-green/[0.04] px-4 py-3 text-sm text-charcoal-ink">
        {t("onb.cohort.ok")}
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
      <h2 className="font-heading text-lg font-semibold text-charcoal-ink">{t("onb.cohort.title")}</h2>
      <p className="text-sm text-charcoal-ink/70">{t("onb.cohort.body")}</p>
      <OnboardingNarration clipId="ONB-008" />
      <div className="space-y-1.5">
        <Label htmlFor="programme-code">{t("onb.cohort.label")}</Label>
        <Input
          id="programme-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={20}
          autoComplete="off"
          autoCapitalize="characters"
          className="uppercase"
        />
      </div>
      {message ? (
        <p role="status" className="text-sm text-charcoal-ink">
          {t(message)}
        </p>
      ) : null}
      <p className="text-xs text-charcoal-ink/50">{t("onb.cohort.privacy")}</p>
      <Button type="button" disabled={pending || code.trim().length < 4} onClick={submit}>
        {pending ? t("onb.cohort.joining") : t("onb.cohort.join")}
      </Button>
    </div>
  );
}
