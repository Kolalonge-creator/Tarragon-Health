"use client";

import { useState, useActionState } from "react";
import Link from "next/link";
import { saveWomensHealthStage } from "./womens-health-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

const STAGES = [
  { value: "general", label: "Staying well" },
  { value: "trying_to_conceive", label: "Trying to conceive" },
  { value: "pregnant", label: "Pregnant" },
  { value: "postpartum", label: "Recently had a baby" },
  { value: "perimenopause", label: "Perimenopause / menopause" },
] as const;

/** What each stage routes to — existing surfaces only, no new clinical
 * machinery. The bridge's job is routing tracking-age attention into the
 * screening, programme, and education paths that already exist (the gap
 * every cycle tracker leaves open in Nigeria). */
const STAGE_GUIDANCE: Record<string, { lines: string[]; }> = {
  general: {
    lines: [
      "Cervical screening is recommended every 3–5 years from age 25 — it's on your screening calendar, and you can book it confidentially any time.",
      "The Women's Health preventive programme keeps your checks and reminders in one track.",
    ],
  },
  trying_to_conceive: {
    lines: [
      "Worth doing now: a general check (blood sugar, blood pressure, genotype if you've never confirmed it) and starting folic acid — talk it through with your care team.",
      "If you've been trying for over a year (or 6 months if you're over 35), that's a conversation for a doctor — message your care team.",
    ],
  },
  pregnant: {
    lines: [
      "Tarragon doesn't provide antenatal care — please register at an antenatal clinic as early as you can; it's the single most important thing for you and the baby.",
      "We can still help alongside: blood-pressure tracking matters in pregnancy, and your care team can watch your readings with you.",
    ],
  },
  postpartum: {
    lines: [
      "A blood-pressure and blood-sugar check after delivery is worth booking — especially if you had blood pressure or sugar issues in pregnancy.",
      "Your baby's immunization schedule can be tracked on your family plan — BCG and the birth doses start on day one.",
    ],
  },
  perimenopause: {
    lines: [
      "This is the stage where heart health quietly changes — blood pressure, cholesterol, and blood sugar checks earn their keep. They're all in the Health Check.",
      "Bone and breast screening become more relevant from here; your screening calendar reflects your age automatically.",
    ],
  },
};

/**
 * The women's health bridge — deliberately NOT a cycle tracker (that race is
 * lost to Flo); it routes each life stage into the care Tarragon already
 * delivers: confidential cervical screening, the Women's Health programme,
 * checks, and family immunization. Stage lives in profiles.metadata.
 */
export function WomensHealthCard({ initialStage }: { initialStage: string | null }) {
  const [stage, setStage] = useState(initialStage ?? "");
  const [state, formAction, pending] = useActionState(saveWomensHealthStage, undefined);
  const guidance = stage ? STAGE_GUIDANCE[stage] : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Your health, your stage
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/70">
          Tell us where you are, and we&apos;ll point you at the checks and support that
          matter most right now.
        </p>
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <select
            name="stage"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            aria-label="Life stage"
            className="rounded-md border border-charcoal-ink/15 px-3 py-1.5 text-sm"
          >
            <option value="">Choose…</option>
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" variant="outline" disabled={!stage || pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          {state?.message && <span className="text-xs text-charcoal-ink/60">{state.message}</span>}
        </form>

        {guidance && (
          <ul className="space-y-2 border-t border-charcoal-ink/10 pt-3">
            {guidance.lines.map((line) => (
              <li key={line} className="text-sm leading-relaxed text-charcoal-ink/80">
                {line}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-3 border-t border-charcoal-ink/10 pt-3 text-sm">
          <Link href="/patient/prevention#screenings" className="text-brand-green hover:underline">
            Book a confidential screening →
          </Link>
          <Link href="/patient/prevention" className="text-brand-green hover:underline">
            Women&apos;s Health programme →
          </Link>
          <Link href="/patient/family" className="text-brand-green hover:underline">
            Family immunization cards →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
