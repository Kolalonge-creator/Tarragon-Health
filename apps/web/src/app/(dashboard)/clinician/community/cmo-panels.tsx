"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatDay } from "@/components/community/staff-format";
import { StaffMessage, useStaffAction } from "@/components/community/use-staff-action";
import type { StaffActionResult } from "@/components/community/staff-types";
import type { AdminGroup, Rule, RuleSet } from "@/lib/community/model";

export interface CmoCallbacks {
  onApproveGroupRules: (input: { groupId: string; rulesVersion: number }) => Promise<StaffActionResult>;
  onSaveRule: (input: { version: number; ruleClass: "emergency" | "self_harm"; pattern: string; note?: string }) => Promise<StaffActionResult>;
  onDeleteRule: (input: { ruleId: number }) => Promise<StaffActionResult>;
  onCreateDraft: () => Promise<StaffActionResult>;
  onActivate: (input: { version: number }) => Promise<StaffActionResult>;
}

/** (a) Group rules waiting for the Chief Medical Officer's approval. */
export function GroupRulesApproval({ groups, onApproveGroupRules }: { groups: AdminGroup[] } & Pick<CmoCallbacks, "onApproveGroupRules">) {
  const { message, pending, run } = useStaffAction();
  return (
    <section aria-labelledby="gra-h" className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-white p-4">
      <h2 id="gra-h" className="font-heading text-lg font-semibold text-charcoal-ink">
        Group rules waiting for your approval
      </h2>
      <StaffMessage message={message} />
      {groups.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">No group rules are waiting for you.</p>
      ) : (
        <ul className="space-y-4">
          {groups.map((g) => (
            <li key={g.id} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
              <p className="text-sm font-semibold text-charcoal-ink">
                {g.name} <span className="font-normal text-charcoal-ink/60">(rules version {g.rules_version})</span>
              </p>
              <p className="whitespace-pre-wrap break-words rounded-md bg-warm-ivory p-3 text-sm">{g.rules_text}</p>
              <Button size="sm" disabled={pending} onClick={() => run(() => onApproveGroupRules({ groupId: g.id, rulesVersion: g.rules_version }))}>
                Approve these rules
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** (b) Emergency and self-harm rules in a draft set. Only the Chief Medical Officer can write these. */
export function SafetyRulesEditor({
  draft,
  rules,
  otherRuleCount,
  onSaveRule,
  onDeleteRule,
  onCreateDraft,
}: {
  draft: RuleSet | null;
  rules: Rule[];
  otherRuleCount: number;
} & Pick<CmoCallbacks, "onSaveRule" | "onDeleteRule" | "onCreateDraft">) {
  const uid = useId();
  const { message, pending, run } = useStaffAction();
  const [ruleClass, setRuleClass] = useState<"emergency" | "self_harm">("emergency");
  const [pattern, setPattern] = useState("");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  function save() {
    if (!draft) return;
    if (pattern.trim().length === 0) {
      setFieldError("Please write a pattern.");
      return;
    }
    setFieldError(null);
    run(
      () => onSaveRule({ version: draft.version, ruleClass, pattern: pattern.trim(), ...(note.trim() ? { note: note.trim() } : {}) }),
      (r) => {
        if (r.ok) {
          setPattern("");
          setNote("");
        }
      },
    );
  }

  return (
    <section aria-labelledby={`${uid}-h`} className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-white p-4">
      <h2 id={`${uid}-h`} className="font-heading text-lg font-semibold text-charcoal-ink">
        Emergency and self-harm rules
      </h2>
      <p className="text-sm text-charcoal-ink/80">
        These are the Chief Medical Officer&apos;s clinical-governance rules. Nobody else can write or remove them. A post that matches one is
        held back and goes only to a safety reviewer. Nothing is sent to anyone else.
      </p>
      <StaffMessage message={message} />

      {!draft ? (
        <div className="space-y-2">
          <p className="text-sm text-charcoal-ink/70">There is no draft rule set. Rules can only be changed in a draft.</p>
          <Button size="sm" disabled={pending} onClick={() => run(onCreateDraft)}>
            Start a draft from the live rule set
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm">
            Editing draft version <span className="font-semibold">{draft.version}</span>. {otherRuleCount} other{" "}
            {otherRuleCount === 1 ? "rule is" : "rules are"} in this draft and managed by administrators.
          </p>
          {rules.length === 0 ? (
            <p className="text-sm text-charcoal-ink/70">This draft has no emergency or self-harm rules yet.</p>
          ) : (
            <ul className="space-y-2">
              {rules.map((r) => (
                <li key={r.id} className="space-y-1 rounded-md border border-charcoal-ink/10 p-3 text-sm">
                  <p>
                    <span className="font-semibold">{r.class === "self_harm" ? "Self-harm" : "Emergency"}</span>
                    {": "}
                    <code className="break-all rounded bg-warm-ivory px-1">{r.pattern}</code>
                  </p>
                  {r.note && <p className="text-charcoal-ink/70">{r.note}</p>}
                  {confirmDelete === r.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>Remove this rule from the draft?</span>
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() => run(() => onDeleteRule({ ruleId: r.id }), () => setConfirmDelete(null))}
                      >
                        Yes, remove it
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                        Keep it
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => setConfirmDelete(r.id)}>
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <fieldset className="space-y-2 rounded-md border border-charcoal-ink/15 p-3">
            <legend className="px-1 text-sm font-medium">Add a rule</legend>
            <label htmlFor={`${uid}-c`} className="block text-sm">
              Kind of rule
            </label>
            <Select id={`${uid}-c`} value={ruleClass} onChange={(e) => setRuleClass(e.target.value as "emergency" | "self_harm")}>
              <option value="emergency">Emergency language</option>
              <option value="self_harm">Self-harm language</option>
            </Select>
            <label htmlFor={`${uid}-p`} className="block text-sm">
              Pattern
            </label>
            <Input
              id={`${uid}-p`}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              aria-describedby={`${uid}-help`}
              aria-invalid={fieldError ? true : undefined}
              autoComplete="off"
              spellCheck={false}
            />
            <div id={`${uid}-help`} className="space-y-1 text-sm text-charcoal-ink/70">
              <p>
                The pattern is a Postgres regular expression. <code>\y</code> marks the edge of a word, so the rule matches whole words only.
              </p>
              <p>
                Two small examples: <code>{"\\y(?:chest pain|cannot breathe)\\y"}</code> matches either phrase, and <code>{"\\ywant to die\\y"}</code>{" "}
                matches that phrase. Capital letters are ignored. If a pattern cannot be read, it will be refused and nothing is saved.
              </p>
            </div>
            <label htmlFor={`${uid}-n`} className="block text-sm">
              Note for other reviewers (optional)
            </label>
            <Input id={`${uid}-n`} value={note} onChange={(e) => setNote(e.target.value)} />
            {fieldError && (
              <p role="alert" className="text-sm text-red-700">
                {fieldError}
              </p>
            )}
            <Button size="sm" disabled={pending} onClick={save}>
              Save rule
            </Button>
          </fieldset>
        </>
      )}
    </section>
  );
}

/** (c) Make a rule set live, with who approved the live one. */
export function RuleSetActivation({ sets, onActivate }: { sets: RuleSet[] } & Pick<CmoCallbacks, "onActivate">) {
  const uid = useId();
  const { message, pending, run } = useStaffAction();
  const [confirming, setConfirming] = useState<number | null>(null);
  const live = sets.find((s) => s.status === "active") ?? null;
  const drafts = sets.filter((s) => s.status === "draft");
  return (
    <section aria-labelledby={`${uid}-h`} className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-white p-4">
      <h2 id={`${uid}-h`} className="font-heading text-lg font-semibold text-charcoal-ink">
        Make a rule set live
      </h2>
      <StaffMessage message={message} />
      <p className="text-sm">
        {live ? (
          <>
            Live now: version <span className="font-semibold">{live.version}</span>
            {live.approved_at
              ? `, approved${live.approved_by_name ? ` by ${live.approved_by_name}` : ""} on ${formatDay(live.approved_at)}.`
              : ", with no approval date recorded."}
            {" "}It has {live.safety_rule_count} emergency or self-harm {live.safety_rule_count === 1 ? "rule" : "rules"}.
          </>
        ) : (
          "No rule set is live yet."
        )}
      </p>
      {drafts.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">There is no draft to make live.</p>
      ) : (
        <ul className="space-y-2">
          {drafts.map((d) => (
            <li key={d.version} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3 text-sm">
              <p>
                Draft version <span className="font-semibold">{d.version}</span>: {d.rule_count} {d.rule_count === 1 ? "rule" : "rules"}, of which{" "}
                {d.safety_rule_count} emergency or self-harm.
              </p>
              {confirming === d.version ? (
                <div className="space-y-2" role="group" aria-label={`Confirm making version ${d.version} live`}>
                  <p className="font-medium">
                    This replaces the live version straight away. A set needs both emergency and self-harm rules before the community can be switched on.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={pending} onClick={() => run(() => onActivate({ version: d.version }), () => setConfirming(null))}>
                      Yes, make version {d.version} live
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => setConfirming(d.version)}>
                  Make version {d.version} live
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
