"use client";

import { ActionForm } from "./action-form";
import { grantStaffAction, revokeStaffAction } from "./actions";
import { btnDanger, field, help, label } from "./ui";

export type Candidate = { id: string; full_name: string | null; role: string };
const ROLE = (r: string) => (r === "care_coordinator" ? "care coordinator" : r);

export function GrantStaffForm({ candidates, groups }: { candidates: Candidate[] | null; groups: Array<{ id: string; name: string }> }) {
  return (
    <ActionForm action={grantStaffAction} submitLabel="Give permission" pendingLabel="Saving...">
      {candidates && candidates.length > 0 && (
        <div>
          <label htmlFor="gs-person" className={label}>Staff member</label>
          <select id="gs-person" name="profile_id" defaultValue="" className={field}>
            <option value="">Choose a staff member</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{(c.full_name ?? "Unnamed") + " (" + ROLE(c.role) + ")"}</option>)}
          </select>
        </div>
      )}
      <div>
        <label htmlFor="gs-paste" className={label}>{candidates && candidates.length > 0 ? "Or paste a staff id" : "Staff id"}</label>
        <input id="gs-paste" name="profile_id_pasted" aria-describedby="gs-paste-help" autoComplete="off" className={field} />
        <p id="gs-paste-help" className={help}>
          {candidates && candidates.length > 0
            ? "Only needed if the person is not in the list. Only care coordinator accounts can be given a permission. If both are given, the pasted id is used."
            : "The list of staff could not be loaded, so paste the id of an active care coordinator account."}
        </p>
      </div>
      <fieldset>
        <legend className={label}>Permission</legend>
        <div className="mt-1 space-y-1 text-sm text-charcoal-ink">
          <div className="flex items-start gap-2">
            <input id="gs-mod" type="radio" name="scope" value="moderator" required className="mt-1" />
            <label htmlFor="gs-mod">Moderator: sees post text and community names, never who a member is.</label>
          </div>
          <div className="flex items-start gap-2">
            <input id="gs-safe" type="radio" name="scope" value="safety_reviewer" className="mt-1" />
            <label htmlFor="gs-safe">Safety reviewer: sees posts flagged for emergency or self-harm language.</label>
          </div>
        </div>
      </fieldset>
      <div>
        <label htmlFor="gs-group" className={label}>Group (optional)</label>
        <select id="gs-group" name="group_id" defaultValue="" className={field}>
          <option value="">All groups</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <p className={help}>Leave blank to cover every group.</p>
      </div>
    </ActionForm>
  );
}

export function RevokeStaffForm({ id, who }: { id: string; who: string }) {
  return (
    <ActionForm action={revokeStaffAction} submitLabel="Revoke" pendingLabel="Revoking..." submitClassName={btnDanger} className="space-y-2" confirm={`End this permission for ${who}?`}>
      <input type="hidden" name="id" value={id} />
    </ActionForm>
  );
}
