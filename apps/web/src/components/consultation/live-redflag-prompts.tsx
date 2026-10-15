"use client";

import { useState, useTransition } from "react";
import { t } from "@tarragon/i18n";
import { livePromptsForSegment } from "@tarragon/clinical/live-redflag";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dismissLivePrompt, recordLivePrompt } from "@/lib/live-prompts/actions";

interface Shown {
  readonly id: string;
  readonly phrase: string;
}

/**
 * Live red-flag prompts for the consulting clinician (S77, 23.7, S-10). Typed or pasted transcript segments only: there is no speech-to-text.
 * The check runs in this browser with the deterministic matcher in @tarragon/clinical; the text is never sent anywhere. Only a matched phrase from
 * the signed list is recorded, so every show and every dismissal is logged. A prompt is visual and dismissible; it never blocks the consultation.
 *
 * NOT MOUNTED in the consultation room yet: the room does not host the scribe or any text input for the transcript (OQ-210). Mount it where the
 * scribe panel is mounted once that is decided. The server refuses unless the guard is on and the patient's consent stands.
 */
export function LiveRedFlagPrompts({ encounterId }: { encounterId: string }) {
  const [segment, setSegment] = useState("");
  const [shown, setShown] = useState<readonly Shown[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const check = () => {
    setNotice(null);
    const found = livePromptsForSegment(segment, shown.map((s) => s.phrase));
    if (found.length === 0) {
      setNotice(t("liveprompt.none", "en"));
      return;
    }
    startTransition(async () => {
      const added: Shown[] = [];
      for (const p of found) {
        const res = await recordLivePrompt({ encounterId, phrase: p.phrase });
        if (res.ok) {
          added.push({ id: res.id, phrase: p.phrase });
        } else {
          setNotice(res.reason === "guard_off" ? t("liveprompt.off", "en") : res.reason === "no_consent" ? t("liveprompt.no_consent", "en") : t("liveprompt.err.generic", "en"));
          break;
        }
      }
      if (added.length > 0) setShown((cur) => [...cur, ...added]);
      setSegment("");
    });
  };

  const dismiss = (id: string) => {
    startTransition(async () => {
      const res = await dismissLivePrompt(id);
      if (res.ok) setShown((cur) => cur.filter((s) => s.id !== id));
      else setNotice(t("liveprompt.err.generic", "en"));
    });
  };

  return (
    <section className="space-y-3">
      {shown.map((s) => (
        <div key={s.id} role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <div className="flex-1">
            <p className="font-medium">{t("liveprompt.title", "en")}: {s.phrase}</p>
            <p>{t("liveprompt.hint", "en")}</p>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => dismiss(s.id)}>
            {t("liveprompt.dismiss", "en")}
          </Button>
        </div>
      ))}
      <div className="space-y-1">
        <Label htmlFor="live-segment">{t("liveprompt.segment.label", "en")}</Label>
        <Textarea id="live-segment" rows={3} maxLength={4000} value={segment} onChange={(e) => setSegment(e.target.value)} />
        <p className="text-xs text-charcoal-ink/60">{t("liveprompt.segment.help", "en")}</p>
      </div>
      <Button type="button" size="sm" disabled={pending || segment.trim().length === 0} onClick={check}>
        {t("liveprompt.check", "en")}
      </Button>
      {notice && <p role="status" className="text-sm text-charcoal-ink/70">{notice}</p>}
    </section>
  );
}
