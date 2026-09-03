"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SEMANTIC_ICON } from "@/lib/icons";
import { useHealthEducationLibrary } from "@/lib/queries/health-education";
import { StiRiskCheckForm } from "./sti-risk-check-form";
import { StiTestingPanel } from "./sti-testing-panel";
import { StiCaseStatusCard } from "./sti-case-status-card";
import { EmergencyContraceptionCard } from "./emergency-contraception-card";
import { ContraceptionPanel } from "./contraception-panel";
import { FertilityAssessmentForm } from "./fertility-assessment-form";
import { SexualWellnessPanel } from "./sexual-wellness-panel";
import { startConfidentialSrhThread } from "./confidential-message-action";
import { SexualHealthPrivacySettingsCard } from "./sexual-health-privacy-settings-card";

const TABS = [
  { key: "testing", label: "Risk check & testing" },
  { key: "results", label: "My results & care" },
  { key: "contraception", label: "Contraception" },
  { key: "fertility", label: "Fertility" },
  { key: "wellness", label: "Sexual wellness" },
  { key: "learn", label: "Learn" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * Top-of-page privacy reassurance + a harm-reduction "quick exit". This is
 * deliberately a small piece of page-local markup rather than an extension
 * of ConfidentialResultNotice: that component's copy is specific to how a
 * *result* reaches a patient (never over WhatsApp/SMS/email — see its own
 * doc comment) and has nothing about a supporter's visibility or an exit
 * control, so bolting those on would blur two different promises. It still
 * borrows the same visual language (clinical-navy, the `privacy` lock icon)
 * so the two read as one family. ConfidentialResultNotice itself still
 * appears unchanged, further down, inside StiTestingPanel/StiCaseStatusCard.
 */
function PrivacyBanner() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-clinical-navy/15 bg-clinical-navy/[0.04] p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-clinical-navy">
        <SEMANTIC_ICON.privacy className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
        Your answers here stay between you and your care team, never shown to a family member,
        an employer, or an HMO, even one that pays for your plan.
      </p>
      <Link
        href="/patient"
        className="shrink-0 rounded-md border border-clinical-navy/20 px-2.5 py-1 text-xs font-medium text-clinical-navy hover:bg-clinical-navy/5"
      >
        Quick exit
      </Link>
    </div>
  );
}

/**
 * "Start a thread from elsewhere" entry point (spec §47.12/§47.13), mirroring
 * MessagesFlow's own composer but always confidential — see
 * confidential-message-action.ts. There is no per-thread deep link anywhere
 * else in the app today (MessagesFlow's own thread list is plain client
 * state, not a route/query param), so success links to /patient/messages
 * generally rather than a specific thread, same as every other "you'll find
 * it in Messages" hand-off in this codebase.
 */
function ConfidentialMessageCta() {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function send() {
    setError(null);
    startTransition(async () => {
      const result = await startConfidentialSrhThread(subject, body);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setSubject("");
      setBody("");
      setOpen(false);
      setSent(true);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SEMANTIC_ICON.privacy className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Message your care team confidentially
        </CardTitle>
        <CardDescription>
          For anything here you&apos;d rather write than say out loud. This thread is hidden from
          anyone else who supports your care, even someone with their usual access to your record.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sent && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand-green/20 bg-brand-green/5 p-3">
            <p className="text-sm text-charcoal-ink/80">
              Sent. Your care team will reply in Messages.
            </p>
            <Button asChild size="sm">
              <Link href="/patient/messages">Open Messages</Link>
            </Button>
          </div>
        )}

        {!open && (
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
            {sent ? "Send another confidential message" : "Start a confidential message"}
          </Button>
        )}

        {open && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="srh-message-subject">Subject</Label>
              <Input
                id="srh-message-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="e.g. Question about my result"
                maxLength={150}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="srh-message-body">Message</Label>
              <Textarea
                id="srh-message-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={4}
                maxLength={4000}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={pending || subject.trim().length < 3 || body.trim().length === 0}
                onClick={send}
              >
                {pending ? "Sending…" : "Send"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * "My results & care" tab. StiCaseStatusCard already renders one card per
 * open episode (or nothing at all when there are none) — this just frames
 * it so the tab is never a blank screen when nothing is open.
 */
function ResultsTab({ patientId }: { patientId: string }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-charcoal-ink/60">
        If a chlamydia, gonorrhoea, or syphilis result needs follow-up, it shows up here
        automatically. Nothing to do here unless you have an open case.
      </p>
      <StiCaseStatusCard patientId={patientId} />
    </div>
  );
}

/**
 * A short, filtered slice of the existing health-education library (spec
 * §47.9/§47.7/§47.11's "education" steps) — womens_health/mens_health are
 * where the fertility, PCOS, preconception, contraception, and men's-
 * fertility/ED articles already live (migration
 * 20260810014719_health_education_screening_womens_mens_health.sql);
 * sexual_health is the new, gender-neutral category added for consent and
 * healthy relationships (migrations 20260829120100/120200) — the two §47.11
 * topics a full-text search confirmed had no article anywhere before those.
 * No per-article route exists anywhere in this app (articles open inline
 * inside HealthEducationLibrary's own accordion, not at a URL), so every
 * link here goes to the full /patient/learn library rather than
 * re-implementing that reading UI a second time.
 */
function LearnTab() {
  const womens = useHealthEducationLibrary("womens_health");
  const mens = useHealthEducationLibrary("mens_health");
  const sexualHealth = useHealthEducationLibrary("sexual_health");
  const isLoading = womens.isLoading || mens.isLoading || sexualHealth.isLoading;
  const items = [...(sexualHealth.data ?? []), ...(womens.data ?? []), ...(mens.data ?? [])];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.learn className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Learn
        </CardTitle>
        <CardDescription>
          Plain-language reading on fertility, contraception, and related health topics.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {!isLoading && items.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">Nothing here yet.</p>
        )}
        {items.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {items.map((item) => (
              <li key={item.content_id} className="py-2.5">
                <Link
                  href="/patient/learn"
                  className="text-sm font-medium text-charcoal-ink hover:text-brand-green"
                >
                  {item.title}
                </Link>
                {item.summary && (
                  <p className="text-xs text-charcoal-ink/60">{item.summary}</p>
                )}
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/patient/learn"
          className="inline-block text-sm font-medium text-brand-green underline underline-offset-4"
        >
          Browse everything in Learn
        </Link>
      </CardContent>
    </Card>
  );
}

export function SexualHealthHub({ patientId }: { patientId: string }) {
  const [activeTab, setActiveTab] = useState<TabKey>("testing");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sexual & reproductive health"
        icon={SEMANTIC_ICON.family}
        description="Testing, contraception, fertility, and wellness: private, and reviewed by your care team."
      />

      <PrivacyBanner />

      <SexualHealthPrivacySettingsCard />

      <div className="flex gap-1.5 overflow-x-auto border-b border-charcoal-ink/10 pb-px">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`shrink-0 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "border-brand-green text-brand-green"
                : "border-transparent text-charcoal-ink/60 hover:text-charcoal-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "testing" && (
        <div className="space-y-6">
          <StiRiskCheckForm />
          <StiTestingPanel />
        </div>
      )}

      {activeTab === "results" && <ResultsTab patientId={patientId} />}

      {activeTab === "contraception" && (
        <div className="space-y-6">
          <EmergencyContraceptionCard />
          <ContraceptionPanel patientId={patientId} />
        </div>
      )}

      {activeTab === "fertility" && <FertilityAssessmentForm />}

      {activeTab === "wellness" && <SexualWellnessPanel />}

      {activeTab === "learn" && <LearnTab />}

      <ConfidentialMessageCta />
    </div>
  );
}
