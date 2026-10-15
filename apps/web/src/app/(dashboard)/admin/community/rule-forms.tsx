"use client";

import { ActionForm } from "./action-form";
import { activateRuleSetAction, deleteRuleAction, newDraftAction, saveHostsAction, saveRuleAction } from "./actions";
import { btnDanger, btnQuiet, field, help, label } from "./ui";
import { DETECTORS, RULE_CLASSES } from "./schemas";

export const CLASS_LABEL: Record<string, string> = {
  contact: "Contact details (phone, email, links, handles)",
  contact_platform: "Mentions of another app",
  commerce: "Selling or promoting",
  cure_claim: "Claims about a treatment or product",
  medicine_instruction: "Telling others to change a medicine",
  abuse: "Threats or abuse",
  spam: "Spam",
  emergency: "Emergency language (Chief Medical Officer)",
  self_harm: "Self-harm language (Chief Medical Officer)",
};

export function AddRuleForm({ version }: { version: number }) {
  return (
    <ActionForm action={saveRuleAction} submitLabel="Add rule" pendingLabel="Saving...">
      <input type="hidden" name="version" value={version} />
      <div>
        <label htmlFor="ar-class" className={label}>Class</label>
        <select id="ar-class" name="class" required defaultValue="" className={field}>
          <option value="" disabled>Choose a class</option>
          {RULE_CLASSES.map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="ar-kind" className={label}>Kind</label>
        <select id="ar-kind" name="kind" defaultValue="regex" aria-describedby="ar-kind-help" className={field}>
          <option value="regex">Regular expression</option>
          <option value="detector">Built-in detector</option>
        </select>
        <p id="ar-kind-help" className={help}>For a built-in detector, the pattern is one of: {DETECTORS.join(", ")}.</p>
      </div>
      <div>
        <label htmlFor="ar-pattern" className={label}>Pattern</label>
        <input id="ar-pattern" name="pattern" required maxLength={500} autoComplete="off" className={`${field} font-mono`} />
      </div>
      <div>
        <label htmlFor="ar-action" className={label}>What happens</label>
        <select id="ar-action" name="action" defaultValue="hold" className={field}>
          <option value="hold">Hold the post for a moderator</option>
          <option value="block">Block the post</option>
        </select>
      </div>
      <p className={help}>Emergency and self-harm rules are written only by the Chief Medical Officer, in the clinician area.</p>
    </ActionForm>
  );
}

export function DeleteRuleForm({ version, ruleId }: { version: number; ruleId: number }) {
  return (
    <ActionForm action={deleteRuleAction} submitLabel="Delete" pendingLabel="Deleting..." submitClassName={btnDanger} className="space-y-1" confirm="Delete this rule from the draft?">
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="rule_id" value={ruleId} />
    </ActionForm>
  );
}

export function HostsForm({ version, hosts }: { version: number; hosts: string[] }) {
  return (
    <ActionForm action={saveHostsAction} submitLabel="Save allowed hostnames" pendingLabel="Saving...">
      <input type="hidden" name="version" value={version} />
      <div>
        <label htmlFor="ah-hosts" className={label}>Allowed link hostnames (one per line)</label>
        <textarea id="ah-hosts" name="hosts" rows={3} defaultValue={hosts.join("\n")} aria-describedby="ah-help" className={`${field} font-mono`} />
        <p id="ah-help" className={help}>Exact hostnames only, like tarragonhealth.ng. No paths and no wildcards. Links to any other site are blocked.</p>
      </div>
    </ActionForm>
  );
}

export function NewDraftForm({ fromVersion }: { fromVersion: number | null }) {
  return (
    <ActionForm action={newDraftAction} submitLabel={fromVersion ? `Start a new draft from version ${fromVersion}` : "Start a new draft"} pendingLabel="Starting..." submitClassName={btnQuiet} className="space-y-2">
      <input type="hidden" name="from_version" value={fromVersion ?? ""} />
    </ActionForm>
  );
}

export function ActivateForm({ version }: { version: number }) {
  return (
    <ActionForm
      action={activateRuleSetAction}
      submitLabel={`Make version ${version} live`}
      pendingLabel="Working..."
      confirm={`Make version ${version} live? It replaces the live version immediately. A version with emergency or self-harm rules can only be made live by the Chief Medical Officer, and the database will refuse it otherwise. A version must keep blocking phone numbers, email addresses, links and handles.`}
    >
      <input type="hidden" name="version" value={version} />
      <p className={help}>This replaces the live version immediately. A version with emergency or self-harm rules can only be made live by the Chief Medical Officer. A version must keep blocking phone numbers, email addresses, links and handles.</p>
    </ActionForm>
  );
}
