"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/components/community/staff-format";
import { StaffMessage, useStaffAction } from "@/components/community/use-staff-action";
import type { StaffActionResult } from "@/components/community/staff-types";
import type { AdminGroup, Rule, RuleSet } from "@/lib/community/model";

export type AttestCode = "crisis_owner_named" | "consent_text_approved" | "clinical_safety_case_current";

export interface Attestation {
  code: AttestCode;
  met: boolean;
}

export interface ReadOnlyCondition {
  code: string;
  label: string;
  met: boolean;
  detail: string | null;
}

export interface SignoffProps {
  /** The rule set that is live now, if any. */
  live: RuleSet | null;
  /** The newest draft rule set, if any, with its emergency and self-harm rules. */
  draft: RuleSet | null;
  draftSafetyRules: Rule[];
  waitingGroups: AdminGroup[];
  attestations: Attestation[];
  consentText: string;
  consentVersion: string;
  otherConditions: ReadOnlyCondition[];
  onLoadStarter: () => Promise<StaffActionResult>;
  onActivate: (input: { version: number }) => Promise<StaffActionResult>;
  onApproveGroupRules: (input: { groupId: string; rulesVersion: number }) => Promise<StaffActionResult>;
  onAttest: (input: { code: AttestCode; note: string }) => Promise<StaffActionResult>;
}

const ATTEST_COPY: Record<AttestCode, { title: string; says: string; help: string; minChars: number }> = {
  crisis_owner_named: {
    title: "Who owns the self-harm queue",
    says: "A named person owns the self-harm queue and the response time is recorded.",
    help: "Write the person's name and role and how fast they must respond, for example: Dr Ada Obi (Chief Medical Officer) owns it, first look within 30 minutes, named reviewers on the rota.",
    minChars: 10,
  },
  consent_text_approved: {
    title: "The consent text members agree to",
    says: "The join consent text and the retention periods are approved.",
    help: "Write what you are approving and on what basis. Be exact about who reviewed it.",
    minChars: 10,
  },
  clinical_safety_case_current: {
    title: "The clinical safety case",
    says: "A current clinical safety case and hazard log exist and are signed off.",
    help: "Name the safety case document, its version and who signed it.",
    minChars: 25,
  },
};

function StatusPill({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <span
      className={
        done
          ? "rounded-full bg-brand-green/10 px-2.5 py-0.5 text-xs font-semibold text-brand-green"
          : "rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900"
      }
    >
      {children}
    </span>
  );
}

function StepShell({ n, title, done, doneText, children }: { n: number; title: string; done: boolean; doneText: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="font-heading text-lg font-semibold text-charcoal-ink">
          {n}. {title}
        </h2>
        <StatusPill done={done}>{done ? doneText : "Waiting for you"}</StatusPill>
      </div>
      {children}
    </section>
  );
}

/** A tick-box that must be ticked before the signing button works, so a stray click can never sign. */
function SignTick({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4" />
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
    </div>
  );
}

function SafetyRulesStep({ live, draft, rules, onLoadStarter, onActivate }: Pick<SignoffProps, "live" | "draft" | "onLoadStarter" | "onActivate"> & { rules: Rule[] }) {
  const { message, pending, run } = useStaffAction();
  const [ticked, setTicked] = useState(false);
  const liveSigned = live !== null && live.safety_rule_count > 0 && live.approved_at !== null;
  const draftHasRules = draft !== null && draft.safety_rule_count > 0;
  const selfHarm = rules.filter((r) => r.class === "self_harm");
  const emergency = rules.filter((r) => r.class === "emergency");

  return (
    <StepShell
      n={1}
      title="Emergency and self-harm rules"
      done={liveSigned && !draftHasRules}
      doneText={live?.approved_at ? `Signed ${formatDay(live.approved_at)}` : "Signed"}
    >
      <StaffMessage message={message} />
      {liveSigned && (
        <p className="text-sm">
          Live now: version <span className="font-semibold">{live.version}</span> with {live.safety_rule_count} emergency or self-harm{" "}
          {live.safety_rule_count === 1 ? "rule" : "rules"}
          {live.approved_by_name ? `, signed by ${live.approved_by_name}` : ""}
          {live.approved_at ? ` on ${formatDay(live.approved_at)}` : ""}.
        </p>
      )}
      {!draftHasRules && !liveSigned && (
        <div className="space-y-2 rounded-md border border-brand-green/30 bg-soft-sage p-3">
          <p className="text-sm">
            The wording you approved in chat on 12 October (self-harm, severe disordered eating, and emergency signs such as chest pain or stroke signs) is ready to
            load. Loading makes a draft only. It has no effect until you sign it below.
          </p>
          <Button size="sm" disabled={pending} onClick={() => run(onLoadStarter)}>
            Load the approved rules into a draft
          </Button>
        </div>
      )}
      {draftHasRules && draft && (
        <div className="space-y-3">
          <p className="text-sm">
            Draft version <span className="font-semibold">{draft.version}</span> holds {selfHarm.length} self-harm and {emergency.length} emergency{" "}
            {emergency.length === 1 ? "rule" : "rules"}. Read them, then sign.
          </p>
          <details className="rounded-md border border-charcoal-ink/10 p-3 text-sm">
            <summary className="cursor-pointer font-medium">Read the rules ({rules.length})</summary>
            <ul className="mt-2 space-y-2">
              {rules.map((r) => (
                <li key={r.id}>
                  <span className="font-semibold">{r.class === "self_harm" ? "Self-harm" : "Emergency"}</span>
                  {": "}
                  <code className="break-all rounded bg-warm-ivory px-1">{r.pattern}</code>
                  {r.note ? <span className="text-charcoal-ink/70"> ({r.note})</span> : null}
                </li>
              ))}
            </ul>
          </details>
          <p className="text-sm text-charcoal-ink/80">
            Signing makes this set live straight away, replacing the one now live. A post that matches one of these rules is held back, shows the member a care card and goes
            only to a safety reviewer.
          </p>
          <SignTick label="I have read these rules and I am signing them myself." checked={ticked} onChange={setTicked} />
          <Button
            size="sm"
            disabled={pending || !ticked}
            onClick={() => run(() => onActivate({ version: draft.version }), (r) => r.ok && setTicked(false))}
          >
            Sign and make version {draft.version} live
          </Button>
        </div>
      )}
    </StepShell>
  );
}

function GroupRulesStep({ groups, onApprove }: { groups: AdminGroup[]; onApprove: SignoffProps["onApproveGroupRules"] }) {
  const { message, pending, run } = useStaffAction();
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  return (
    <StepShell n={2} title="Group rules that need your approval" done={groups.length === 0} doneText="Nothing waiting">
      <StaffMessage message={message} />
      {groups.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">No group rules are waiting for you.</p>
      ) : (
        <ul className="space-y-4">
          {groups.map((g) => (
            <li key={g.id} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
              <p className="text-sm font-semibold">
                {g.name} <span className="font-normal text-charcoal-ink/60">(rules version {g.rules_version})</span>
              </p>
              <p className="whitespace-pre-wrap break-words rounded-md bg-warm-ivory p-3 text-sm">{g.rules_text}</p>
              <SignTick
                label={`I have read the rules for ${g.name} and I approve them.`}
                checked={ticked[g.id] === true}
                onChange={(v) => setTicked((t) => ({ ...t, [g.id]: v }))}
              />
              <Button
                size="sm"
                disabled={pending || ticked[g.id] !== true}
                onClick={() => run(() => onApprove({ groupId: g.id, rulesVersion: g.rules_version }))}
              >
                Approve these rules
              </Button>
            </li>
          ))}
        </ul>
      )}
    </StepShell>
  );
}

function AttestBlock({ code, met, children, onAttest }: { code: AttestCode; met: boolean; children?: React.ReactNode; onAttest: SignoffProps["onAttest"] }) {
  const id = useId();
  const copy = ATTEST_COPY[code];
  const { message, pending, run } = useStaffAction();
  const [note, setNote] = useState("");
  const [ticked, setTicked] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  function submit() {
    if (note.trim().length < copy.minChars) {
      setFieldError(code === "clinical_safety_case_current" ? "Name the safety case document, its version and who signed it." : "Please write a sentence saying what was checked and by whom.");
      return;
    }
    setFieldError(null);
    run(() => onAttest({ code, note: note.trim() }), (r) => r.ok && (setNote(""), setTicked(false)));
  }

  return (
    <li className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{copy.title}</p>
        <StatusPill done={met}>{met ? "Recorded" : "Waiting for you"}</StatusPill>
      </div>
      <p className="text-sm text-charcoal-ink/80">{copy.says}</p>
      {children}
      <StaffMessage message={message} />
      {!met && (
        <div className="space-y-2">
          <label htmlFor={`${id}-n`} className="block text-sm font-medium">
            Your note
          </label>
          <textarea
            id={`${id}-n`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={1000}
            aria-describedby={`${id}-h`}
            aria-invalid={fieldError ? true : undefined}
            className="w-full rounded-md border border-charcoal-ink/20 p-2 text-sm"
          />
          <p id={`${id}-h`} className="text-sm text-charcoal-ink/70">
            {copy.help}
          </p>
          {fieldError && (
            <p role="alert" className="text-sm text-red-700">
              {fieldError}
            </p>
          )}
          <SignTick label="This is true and I am recording it myself." checked={ticked} onChange={setTicked} />
          <Button size="sm" disabled={pending || !ticked} onClick={submit}>
            Record this
          </Button>
        </div>
      )}
    </li>
  );
}

function AttestationsStep({ attestations, consentText, consentVersion, onAttest }: Pick<SignoffProps, "attestations" | "consentText" | "consentVersion" | "onAttest">) {
  const byCode = new Map(attestations.map((a) => [a.code, a.met]));
  const allDone = attestations.length === 3 && attestations.every((a) => a.met);
  return (
    <StepShell n={3} title="Three statements only you can make" done={allDone} doneText="All recorded">
      <p className="text-sm text-charcoal-ink/80">
        Each one is recorded with your name and today&apos;s date. They do not switch anything on.
      </p>
      <ul className="space-y-4">
        <AttestBlock code="crisis_owner_named" met={byCode.get("crisis_owner_named") === true} onAttest={onAttest} />
        <AttestBlock code="consent_text_approved" met={byCode.get("consent_text_approved") === true} onAttest={onAttest}>
          <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-950">
            Version {consentVersion} was accepted as written by the founder and Chief Medical Officer on 12 October 2026. Counsel has not reviewed it. If you record this,
            say that in your note so the record is accurate.
          </p>
          <details className="rounded-md border border-charcoal-ink/10 p-3 text-sm">
            <summary className="cursor-pointer font-medium">Read the consent text members agree to</summary>
            <p className="mt-2 whitespace-pre-wrap break-words">{consentText}</p>
          </details>
        </AttestBlock>
        <AttestBlock code="clinical_safety_case_current" met={byCode.get("clinical_safety_case_current") === true} onAttest={onAttest} />
      </ul>
    </StepShell>
  );
}

function OthersStep({ conditions }: { conditions: ReadOnlyCondition[] }) {
  const open = conditions.filter((c) => !c.met);
  return (
    <StepShell n={4} title="What an administrator still has to do" done={open.length === 0} doneText="Nothing left">
      <p className="text-sm text-charcoal-ink/80">
        These are checked from the data and cannot be signed. They are here so you can see how close the community is to being ready.
      </p>
      <ul className="space-y-1 text-sm">
        {conditions.map((c) => (
          <li key={c.code} className="flex flex-wrap items-baseline gap-2">
            <span aria-hidden="true">{c.met ? "✓" : "○"}</span>
            <span>
              {c.label}
              <span className="sr-only">{c.met ? " (done)" : " (not done yet)"}</span>
              {c.detail ? <span className="text-charcoal-ink/60"> ({c.detail})</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </StepShell>
  );
}

/** The Chief Medical Officer's single place to read and sign everything Community needs from them. Each signing is a separate, deliberate act. */
export function SignoffChecklist(props: SignoffProps) {
  return (
    <div className="space-y-4">
      <SafetyRulesStep live={props.live} draft={props.draft} rules={props.draftSafetyRules} onLoadStarter={props.onLoadStarter} onActivate={props.onActivate} />
      <GroupRulesStep groups={props.waitingGroups} onApprove={props.onApproveGroupRules} />
      <AttestationsStep attestations={props.attestations} consentText={props.consentText} consentVersion={props.consentVersion} onAttest={props.onAttest} />
      <OthersStep conditions={props.otherConditions} />
    </div>
  );
}
