import { Badge } from "@/components/ui/badge";
import { approveContent, saveTestCase, saveTrainingModule } from "@/lib/credentialing/review-actions";
import { contentToParagraphs } from "@/lib/credentialing/content";
import type { CredentialingContent } from "@/lib/credentialing/schemas";
import { Field, fieldClass, Hidden, Muted, Section, SubmitButton } from "./shared";

const RETURN = "/clinician/credentialing/content";
const textareaClass =
  "w-full rounded-md border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green dark:border-night-ink/25 dark:bg-night-card dark:text-night-ink";

function ApproveForm({ kind, id }: { kind: "test_case" | "training_module"; id: string }) {
  return (
    <form action={approveContent}>
      <Hidden name="kind" value={kind} />
      <Hidden name="id" value={id} />
      <Hidden name="returnTo" value={RETURN} />
      <SubmitButton>Approve for use</SubmitButton>
    </form>
  );
}

/**
 * Where the Chief Medical Officer writes and approves the training and the test. This is clinical content: nothing
 * is seeded as approved, and editing an approved item sends it back to draft until it is approved again. Draft
 * items are never shown to an applicant.
 */
export function ContentManager({ content }: { content: CredentialingContent }) {
  return (
    <div className="space-y-6">
      <Section title="Training modules" hint="Separate paragraphs with a blank line. Every approved module must be completed before the test opens.">
        <ul className="space-y-4">
          {content.modules.map((m) => (
            <li key={m.id} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{m.title}</p>
                <Badge variant={m.status === "approved" ? "green" : "amber"}>{m.status === "approved" ? "Approved" : "Draft"}</Badge>
              </div>
              <form action={saveTrainingModule} className="space-y-2">
                <Hidden name="id" value={m.id} />
                <Hidden name="code" value={m.code} />
                <Hidden name="returnTo" value={RETURN} />
                <Field label="Title">
                  <input name="title" defaultValue={m.title} required className={fieldClass} />
                </Field>
                <Field label="Summary">
                  <input name="summary" defaultValue={m.summary} className={fieldClass} />
                </Field>
                <Field label="Content">
                  <textarea name="content" defaultValue={contentToParagraphs(m.content)} rows={6} className={textareaClass} />
                </Field>
                <Field label="Minutes">
                  <input name="minutes" type="number" min={1} defaultValue={m.minutes} className={fieldClass} />
                </Field>
                <SubmitButton tone="outline">Save as draft</SubmitButton>
              </form>
              {m.status !== "approved" ? <ApproveForm kind="training_module" id={m.id} /> : null}
            </li>
          ))}
        </ul>
        <details>
          <summary className="cursor-pointer text-sm font-medium">Add a module</summary>
          <form action={saveTrainingModule} className="mt-2 space-y-2">
            <Hidden name="returnTo" value={RETURN} />
            <Field label="Code (no spaces)">
              <input name="code" required className={fieldClass} />
            </Field>
            <Field label="Title">
              <input name="title" required className={fieldClass} />
            </Field>
            <Field label="Summary">
              <input name="summary" className={fieldClass} />
            </Field>
            <Field label="Content">
              <textarea name="content" rows={6} className={textareaClass} />
            </Field>
            <Field label="Minutes">
              <input name="minutes" type="number" min={1} defaultValue={10} className={fieldClass} />
            </Field>
            <SubmitButton>Save as draft</SubmitButton>
          </form>
        </details>
      </Section>

      <Section title="Test scenarios" hint="Every approved safety-critical scenario is in every attempt, and each must be answered correctly. Write each option on its own line like  a | the answer.">
        {content.test_cases.length === 0 ? <Muted>No scenarios yet. Until some are approved, nobody can take the test.</Muted> : null}
        <ul className="space-y-4">
          {content.test_cases.map((c) => (
            <li key={c.id} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{c.code}</p>
                <div className="flex gap-2">
                  {c.is_red ? <Badge variant="red">Safety-critical</Badge> : null}
                  <Badge variant={c.status === "approved" ? "green" : "amber"}>{c.status === "approved" ? "Approved" : "Draft"}</Badge>
                </div>
              </div>
              <form action={saveTestCase} className="space-y-2">
                <Hidden name="id" value={c.id} />
                <Hidden name="code" value={c.code} />
                <Hidden name="returnTo" value={RETURN} />
                <Field label="Scenario">
                  <textarea name="scenario" defaultValue={c.scenario} rows={3} required className={textareaClass} />
                </Field>
                <Field label="Options">
                  <textarea name="options" defaultValue={c.options.map((o) => `${o.id} | ${o.text ?? ""}`).join("\n")} rows={4} required className={textareaClass} />
                </Field>
                <Field label="Correct option id">
                  <input name="correct_option_id" defaultValue={c.correct_option_id} required className={fieldClass} />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="is_red" defaultChecked={c.is_red} /> Safety-critical (must be answered correctly)
                </label>
                <Field label="Why this is the answer (shown to reviewers only)">
                  <textarea name="rationale" defaultValue={c.rationale} rows={2} className={textareaClass} />
                </Field>
                <SubmitButton tone="outline">Save as draft</SubmitButton>
              </form>
              {c.status !== "approved" ? <ApproveForm kind="test_case" id={c.id} /> : null}
            </li>
          ))}
        </ul>
        <details>
          <summary className="cursor-pointer text-sm font-medium">Add a scenario</summary>
          <form action={saveTestCase} className="mt-2 space-y-2">
            <Hidden name="returnTo" value={RETURN} />
            <Field label="Code (no spaces)">
              <input name="code" required className={fieldClass} />
            </Field>
            <Field label="Scenario">
              <textarea name="scenario" rows={3} required className={textareaClass} />
            </Field>
            <Field label="Options">
              <textarea name="options" rows={4} required className={textareaClass} placeholder={"a | First option\nb | Second option"} />
            </Field>
            <Field label="Correct option id">
              <input name="correct_option_id" required className={fieldClass} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_red" /> Safety-critical (must be answered correctly)
            </label>
            <Field label="Why this is the answer (shown to reviewers only)">
              <textarea name="rationale" rows={2} className={textareaClass} />
            </Field>
            <SubmitButton>Save as draft</SubmitButton>
          </form>
        </details>
      </Section>
    </div>
  );
}
