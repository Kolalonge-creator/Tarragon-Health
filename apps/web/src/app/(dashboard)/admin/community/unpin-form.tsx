"use client";

import { ActionForm } from "./action-form";
import { unpinAction } from "./actions";
import { btnDanger } from "./ui";

export function UnpinForm({ id, groupId }: { id: string; groupId: string }) {
  return (
    <ActionForm action={unpinAction} submitLabel="Unpin" pendingLabel="Working..." submitClassName={btnDanger} className="space-y-1" confirm="Unpin this note? Members will stop seeing it.">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="group_id" value={groupId} />
    </ActionForm>
  );
}
