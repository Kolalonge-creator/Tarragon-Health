"use client";

import { ActionForm } from "./action-form";
import { setDpoAction } from "./actions";
import { btnDanger, field, help, label } from "./ui";

export type DpoPerson = { id: string; full_name: string | null; role: string };
const ROLE: Record<string, string> = { admin: "admin", clinician: "clinician", care_coordinator: "care coordinator" };

export function NameDpoForm({ candidates }: { candidates: DpoPerson[] | null }) {
  const hasList = candidates !== null && candidates.length > 0;
  return (
    <ActionForm action={setDpoAction} submitLabel="Name this person" pendingLabel="Saving...">
      <input type="hidden" name="on" value="true" />
      {hasList && (
        <div>
          <label htmlFor="dpo-person" className={label}>Staff member</label>
          <select id="dpo-person" name="profile_id" defaultValue="" className={field}>
            <option value="">Choose a staff member</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{(c.full_name ?? "Unnamed") + " (" + (ROLE[c.role] ?? c.role) + ")"}</option>)}
          </select>
        </div>
      )}
      <div>
        <label htmlFor="dpo-paste" className={label}>{hasList ? "Or paste a staff id" : "Staff id"}</label>
        <input id="dpo-paste" name="profile_id_pasted" aria-describedby="dpo-paste-help" autoComplete="off" className={field} />
        <p id="dpo-paste-help" className={help}>
          {hasList ? "Only needed if the person is not in the list. If both are given, the pasted id is used." : "The list of staff could not be loaded, so paste the id of an active account."}
        </p>
      </div>
    </ActionForm>
  );
}

export function RemoveDpoForm({ id, who }: { id: string; who: string }) {
  return (
    <ActionForm action={setDpoAction} submitLabel="Remove" pendingLabel="Removing..." submitClassName={btnDanger} className="space-y-2" confirm={`Stop naming ${who} as the data protection officer?`}>
      <input type="hidden" name="profile_id" value={id} />
      <input type="hidden" name="on" value="false" />
    </ActionForm>
  );
}
