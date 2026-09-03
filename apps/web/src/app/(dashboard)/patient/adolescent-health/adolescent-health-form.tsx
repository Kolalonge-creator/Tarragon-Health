"use client";

import { useActionState } from "react";
import { submitAdolescentPsychosocialScreen } from "../adolescent-health-actions";
import { YES_NO_OPTIONS } from "@/lib/validation/adolescent-psychosocial-screen";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function YesNoQuestion({ name, prompt }: { name: string; prompt: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm text-charcoal-ink dark:text-night-ink">{prompt}</legend>
      <div className="flex gap-2">
        {YES_NO_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-charcoal-ink/15 dark:border-night-ink/20 px-3 py-1.5 text-xs text-charcoal-ink/80 dark:text-night-ink/80 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5 dark:has-[:checked]:bg-brand-green/10"
          >
            <input type="radio" name={name} value={opt.value} required className="accent-[color:var(--brand-green,#0E7C52)]" />
            {opt.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Adolescent psychosocial check-in (spec §49.5/§49.6) — a warm, private
 * whole-life check-in, never framed as a test or a red flag hunt (CLAUDE.md
 * brand voice: no fear-based urgency). A flagged answer is acknowledged
 * supportively here; the actual routing (emergency pathway / safeguarding
 * case) happens server-side regardless of this form.
 */
export function AdolescentHealthForm() {
  const [state, formAction, pending] = useActionState(submitAdolescentPsychosocialScreen, undefined);

  if (state?.success) {
    return (
      <Card variant="soft">
        <CardHeader>
          <CardTitle className="text-base">Thanks for checking in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
          <p>Your answers are saved and stay private to your care team.</p>
          {(state.selfHarmFlagged || state.immediateDangerFlagged) && (
            <p className="rounded-md bg-red-50 dark:bg-red-500/15 p-3 text-red-700 dark:text-red-300">
              You told us something worrying. You are not alone. A member of your care team will
              reach out to you directly. If you are in immediate danger, please contact emergency
              services or go to the nearest hospital now.
            </p>
          )}
          {state.abuseNeglectExploitationFlagged && !state.selfHarmFlagged && !state.immediateDangerFlagged && (
            <p className="rounded-md bg-amber-50 dark:bg-amber-500/15 p-3 text-amber-800 dark:text-amber-300">
              You told us something that matters. A senior member of your care team will look into
              this carefully and privately. This is never shared with anyone else without your
              safety being the first priority.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your whole-life check-in</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          A few questions about home, school, activity, and how you&apos;re really doing, the kind
          of thing a doctor might ask in person. There are no wrong answers, and your answers stay
          private to your care team.
        </p>
        <form action={formAction} className="space-y-6">
          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-deep-forest dark:text-brand-green-bright">Home</h3>
            <YesNoQuestion name="home_feels_safe" prompt="Do you feel safe at home?" />
            <YesNoQuestion
              name="home_hurt_or_threatened"
              prompt="Has anyone at home hurt you, threatened you, or made you feel unsafe recently?"
            />
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-deep-forest dark:text-brand-green-bright">
              School and everyday life
            </h3>
            <fieldset className="space-y-2">
              <legend className="text-sm text-charcoal-ink dark:text-night-ink">
                Anything you&apos;d like to share about school or how things are going day to day?
                (optional)
              </legend>
              <textarea
                name="education_note"
                maxLength={500}
                rows={2}
                className="w-full rounded-md border border-charcoal-ink/15 dark:border-night-ink/20 p-2 text-sm"
              />
            </fieldset>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-deep-forest dark:text-brand-green-bright">
              Activity and sleep
            </h3>
            <fieldset className="space-y-2">
              <legend className="text-sm text-charcoal-ink dark:text-night-ink">
                In a typical week, how many days are you physically active?
              </legend>
              <input
                type="number"
                name="days_active_per_week"
                min={0}
                max={7}
                required
                className="w-24 rounded-md border border-charcoal-ink/15 dark:border-night-ink/20 p-2 text-sm"
              />
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm text-charcoal-ink dark:text-night-ink">
                On a typical night, how many hours do you sleep?
              </legend>
              <input
                type="number"
                name="sleep_hours_per_night"
                min={0}
                max={24}
                step={0.5}
                required
                className="w-24 rounded-md border border-charcoal-ink/15 dark:border-night-ink/20 p-2 text-sm"
              />
            </fieldset>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-deep-forest dark:text-brand-green-bright">
              Substances
            </h3>
            <YesNoQuestion
              name="substance_use_last_month"
              prompt="In the last month, have you used alcohol, cigarettes, vaping, or any other substance?"
            />
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-deep-forest dark:text-brand-green-bright">
              Sexual health
            </h3>
            <YesNoQuestion
              name="sexual_health_support_requested"
              prompt="Would you like confidential information or support about sexual health (e.g. contraception, STI testing)?"
            />
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-deep-forest dark:text-brand-green-bright">
              How you&apos;re really doing
            </h3>
            <YesNoQuestion
              name="self_harm_thoughts"
              prompt="In the last two weeks, have you had thoughts of hurting yourself, or that life isn't worth living?"
            />
            <YesNoQuestion
              name="unsafe_elsewhere"
              prompt="Do you feel unsafe anywhere else in your life right now, at school, online, or elsewhere?"
            />
            <YesNoQuestion
              name="immediate_danger"
              prompt="Are you in danger right now and need help immediately?"
            />
            <fieldset className="space-y-2">
              <legend className="text-sm text-charcoal-ink dark:text-night-ink">Anything else you want us to know? (optional)</legend>
              <textarea
                name="notes"
                maxLength={1000}
                rows={2}
                className="w-full rounded-md border border-charcoal-ink/15 dark:border-night-ink/20 p-2 text-sm"
              />
            </fieldset>
          </div>

          {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save check-in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
