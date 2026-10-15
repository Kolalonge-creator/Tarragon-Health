"use client";

import { useActionState } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FOLLOW_UP_OUTCOMES } from "@/lib/clinician/follow-ups";
import { acknowledgeFollowUp, closeFollowUp, type FollowUpActionState } from "./actions";

const Err = ({ text }: { text?: string }) =>
  text ? (
    <p role="alert" className="text-sm text-red-600">
      {text}
    </p>
  ) : null;

export function AcknowledgeForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FollowUpActionState, FormData>(acknowledgeFollowUp, undefined);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {t("followups.acknowledge", "en")}
      </Button>
      <Err text={state?.error} />
    </form>
  );
}

export function CloseForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FollowUpActionState, FormData>(closeFollowUp, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <div className="space-y-1">
        <Label htmlFor={`outcome-${id}`}>{t("followups.outcome", "en")}</Label>
        <Select id={`outcome-${id}`} name="outcome" required defaultValue="">
          <option value="" disabled>
            {t("followups.outcome.choose", "en")}
          </option>
          {FOLLOW_UP_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {t(`followups.outcome.${o}`, "en")}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`reason-${id}`}>{t("followups.reason", "en")}</Label>
        <Textarea id={`reason-${id}`} name="reason" required minLength={10} maxLength={1000} rows={2} />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {t("followups.close", "en")}
      </Button>
      <Err text={state?.error} />
    </form>
  );
}
