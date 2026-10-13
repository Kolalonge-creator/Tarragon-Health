"use client";

import { ActionForm } from "./action-form";
import { setGroupImagesAction } from "./ops-actions";
import { btnQuiet, help } from "./ui";

/**
 * Pictures in one group. Off unless an admin turns it on here. Every picture then waits for a moderator before the group sees it.
 * `current` is undefined when the group list did not say, so both choices are offered and the page does not guess.
 */
export function GroupImagesForm({ id, name, current, topicNeedsCmoRules }: { id: string; name: string; current: boolean | undefined; topicNeedsCmoRules: boolean }) {
  const describedBy = `img-${id}-help`;
  return (
    <section aria-labelledby={`img-${id}-h`} className="space-y-2 rounded-lg border border-charcoal-ink/15 p-3">
      <h3 id={`img-${id}-h`} className="text-sm font-semibold text-charcoal-ink">Pictures</h3>
      <p className="text-sm text-charcoal-ink">
        {current === undefined ? "The current setting is not shown here." : current ? "Pictures are allowed in this group." : "Pictures are not allowed in this group."}
      </p>
      <p id={describedBy} className={help}>
        Pictures wait for a moderator before anyone sees them. Members cannot see a picture until a moderator approves it.
        {topicNeedsCmoRules ? " Pictures cannot be turned on for a weight-loss group." : ""}
      </p>
      <div className="flex flex-wrap gap-3">
        {current !== true && (
          <ActionForm
            action={setGroupImagesAction}
            submitLabel="Allow pictures"
            pendingLabel="Saving..."
            className="space-y-2"
            submitClassName={btnQuiet}
            confirm={`Allow pictures in "${name}"? Every picture will wait for a moderator before the group sees it.`}
          >
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="on" value="on" />
          </ActionForm>
        )}
        {current !== false && (
          <ActionForm
            action={setGroupImagesAction}
            submitLabel="Switch pictures off"
            pendingLabel="Saving..."
            className="space-y-2"
            submitClassName={btnQuiet}
            confirm={`Switch pictures off in "${name}"?`}
          >
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="on" value="off" />
          </ActionForm>
        )}
      </div>
    </section>
  );
}
