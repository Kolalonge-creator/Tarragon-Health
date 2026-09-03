"use client";

import { useState, useTransition } from "react";
import type { Enums } from "@tarragon/shared";
import { useOpenStiCaseEpisodes, type StiCaseEpisode } from "@/lib/queries/sti-case-episodes";
import { usePartnerNotifications } from "@/lib/queries/sti-partner-notifications";
import {
  requestSelfNotifyPartnerCopy,
  submitClinicianAssistedPartnerNotification,
  type PartnerCopyTemplates,
} from "./sti-actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stepper, type StepperStep } from "@/components/ui/stepper";
import { ConfidentialResultNotice } from "@/components/confidential-result-notice";
import { SEMANTIC_ICON } from "@/lib/icons";

import { formatPatientDate } from "@/lib/format-date";
type StiCaseStatus = Enums<"sti_case_status">;

const STI_CODE_LABEL: Record<string, string> = {
  chlamydia_gonorrhoea: "Chlamydia & Gonorrhoea",
  syphilis: "Syphilis",
};

/** result_received -> clinical_review -> patient_notified -> treatment_in_progress
 * -> treatment_completed, mapped onto the 5-stage timeline. declined_care/closed
 * never reach this card (useOpenStiCaseEpisodes excludes both). */
const STAGE_ORDER: StiCaseStatus[] = [
  "result_received",
  "clinical_review",
  "patient_notified",
  "treatment_in_progress",
  "treatment_completed",
];
const STAGE_LABELS = ["Result received", "Clinical review", "Doctor has been in touch", "Treatment", "Follow-up"];
const STAGE_KEYS = ["result_received", "clinical_review", "doctor_in_touch", "treatment", "follow_up"];

function deriveStages(status: StiCaseStatus): StepperStep[] {
  const found = STAGE_ORDER.indexOf(status);
  const currentIndex = found === -1 ? STAGE_ORDER.length - 1 : found;
  return STAGE_LABELS.map((label, i) => ({
    key: STAGE_KEYS[i],
    label,
    state: i < currentIndex ? "complete" : i === currentIndex ? "current" : "upcoming",
  }));
}

/** Once the care team has told the patient (patient_notified or later), it's
 * meaningful to offer letting a partner know too. */
const PARTNER_NOTIFY_ELIGIBLE_STATUSES: StiCaseStatus[] = [
  "patient_notified",
  "treatment_in_progress",
  "treatment_completed",
];

function CopyBox({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied/unavailable — the text is still
      // selectable and readable either way, so this is a soft failure.
    }
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">{label}</p>
      <p className="rounded-md border border-charcoal-ink/15 dark:border-night-ink/20 bg-charcoal-ink/5 dark:bg-night-ink/10 p-3 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
        {text}
      </p>
      <Button type="button" size="sm" variant="outline" onClick={copy}>
        {copied ? "Copied" : "Copy text"}
      </Button>
    </div>
  );
}

/**
 * Optional, patient-led partner-notification flow (spec §47.6) — never
 * pressuring, never automated on Tarragon's part. self_notify hands the
 * patient copy-ready text to send themselves; clinician_assisted asks the
 * care team to make contact with details the patient chooses to share.
 */
function PartnerNotifyFlow({ episode }: { episode: StiCaseEpisode }) {
  const { data: history } = usePartnerNotifications(episode.id);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"choose" | "self_notify" | "clinician_assisted" | "done">("choose");
  const [templates, setTemplates] = useState<PartnerCopyTemplates | null>(null);
  const [partnerLabel, setPartnerLabel] = useState("");
  const [partnerContact, setPartnerContact] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function chooseSelfNotify() {
    setError(null);
    startTransition(async () => {
      const result = await requestSelfNotifyPartnerCopy(episode.id);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setTemplates(result);
      setMode("self_notify");
    });
  }

  function submitClinicianAssisted() {
    setError(null);
    startTransition(async () => {
      const result = await submitClinicianAssistedPartnerNotification(
        episode.id,
        partnerLabel || null,
        partnerContact
      );
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setMode("done");
    });
  }

  if (!open) {
    return (
      <div className="space-y-1.5">
        {(history?.length ?? 0) > 0 && (
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            You&apos;ve already looked into this for this result. You&apos;re welcome to do it
            again, or not, entirely up to you.
          </p>
        )}
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
          Let a partner know
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 bg-white dark:bg-night-card p-4">
      <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
        Totally optional, and entirely your call. A partner might want to get tested too, but
        there&apos;s no pressure either way.
      </p>

      {mode === "choose" && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={chooseSelfNotify}>
            {pending ? "One moment…" : "I'll let them know myself"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setMode("clinician_assisted")}>
            Ask my care team to help
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Not now
          </Button>
        </div>
      )}

      {mode === "self_notify" && templates && (
        <div className="space-y-4">
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            Copy whichever fits how you&apos;d usually message them. It doesn&apos;t mention you,
            your result, or Tarragon.
          </p>
          <CopyBox label="Text message" text={templates.smsTemplate} />
          <CopyBox label="WhatsApp / longer message" text={templates.whatsappTemplate} />
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      )}

      {mode === "clinician_assisted" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`partner_label_${episode.id}`}>What should we call them? (optional)</Label>
            <Input
              id={`partner_label_${episode.id}`}
              placeholder="e.g. my partner"
              value={partnerLabel}
              onChange={(event) => setPartnerLabel(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`partner_contact_${episode.id}`}>Their phone number or contact detail</Label>
            <Input
              id={`partner_contact_${episode.id}`}
              placeholder="+234…"
              value={partnerContact}
              onChange={(event) => setPartnerContact(event.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pending || !partnerContact} onClick={submitClinicianAssisted}>
              {pending ? "Sending…" : "Send to my care team"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("choose")}>
              Back
            </Button>
          </div>
        </div>
      )}

      {mode === "done" && (
        <div className="space-y-3">
          <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
            Thanks. Your care team has what they need and will take it from here.
          </p>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function StiCaseCard({ episode }: { episode: StiCaseEpisode }) {
  const stages = deriveStages(episode.status);
  const showConfidentialNotice = episode.status === "result_received" || episode.status === "clinical_review";
  const canNotifyPartner = PARTNER_NOTIFY_ELIGIBLE_STATUSES.includes(episode.status);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {STI_CODE_LABEL[episode.sti_code] ?? episode.sti_code.replace(/_/g, " ")}
        </CardTitle>
        <CardDescription>
          Started {formatPatientDate(episode.created_at)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Stepper steps={stages} />

        {showConfidentialNotice ? (
          <ConfidentialResultNotice />
        ) : (
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            Your care team has been in touch about this directly. Anything from here (treatment,
            follow-up) is between you and them.
          </p>
        )}

        {canNotifyPartner && <PartnerNotifyFlow episode={episode} />}
      </CardContent>
    </Card>
  );
}

/**
 * Positive curable-STI case tracker (spec §47.5) — one card per open episode
 * (result received through treatment/follow-up). Confidential by
 * construction: RLS on sti_case_episodes is patient-self or org staff only,
 * never a sponsor/supporter, so nothing extra is needed here to keep this
 * private.
 */
export function StiCaseStatusCard({ patientId }: { patientId: string }) {
  const { data: episodes, isLoading } = useOpenStiCaseEpisodes(patientId);

  if (isLoading || !episodes || episodes.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <SEMANTIC_ICON.escalation className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} />
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink dark:text-night-ink">
          Following up on a result
        </h2>
      </div>
      {episodes.map((episode) => (
        <StiCaseCard key={episode.id} episode={episode} />
      ))}
    </div>
  );
}
