"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createRiskQuestionnaireConfigDraftAction,
  type SaveRiskQuestionnaireConfigState,
} from "./actions";

/**
 * A structured point-and-click editor for a full question bank + per-
 * condition scoring ruleset (branching predicates included) is a
 * substantial UI on its own — this ships as a reviewed JSON editor first: a
 * Director can read, edit, and re-save the full config, and
 * riskQuestionnaireConfigJsonSchema (server-side) rejects anything that
 * doesn't structurally match what the engine expects before it is ever
 * stored as a draft. A friendlier field-by-field editor is a natural
 * follow-up once real usage shows which edits are most common.
 */
export function RiskQuestionnaireConfigEditor({ defaultConfigJson }: { defaultConfigJson: string }) {
  const [state, action, pending] = useActionState<SaveRiskQuestionnaireConfigState, FormData>(
    createRiskQuestionnaireConfigDraftAction,
    undefined
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New version</CardTitle>
        <CardDescription>
          Edit the questions and/or scoring rules below, then save as a new draft version. It
          will not affect the live risk assessment until a Clinical Director signs it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="notes">What changed, and why</Label>
            <Textarea
              id="notes"
              name="notes"
              required
              maxLength={2000}
              placeholder="e.g. Added a CKD risk domain per the nephrology protocol review."
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="configJson">Configuration (JSON)</Label>
            <Textarea
              id="configJson"
              name="configJson"
              required
              defaultValue={defaultConfigJson}
              rows={20}
              className="font-mono text-xs"
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save as new draft version"}
          </Button>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && (
            <p className="text-sm text-brand-green">Saved as a new draft — sign it below to bring it into force.</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
