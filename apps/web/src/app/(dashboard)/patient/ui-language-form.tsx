"use client";

import { useActionState } from "react";
import { updateUiLanguage } from "./ui-language-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_ICON } from "@/lib/icons";
import { UI_LANGUAGE_LABEL, type UiLanguage } from "@tarragon/shared";

const OPTIONS: Array<{ value: UiLanguage; hint: string }> = [
  { value: "en", hint: "The default" },
  { value: "pcm", hint: "Naija Pidgin, for getting around the app" },
];

/**
 * Interface language. The note under the buttons is not decoration: a patient
 * who picks Pidgin and then meets an English emergency screen should have been
 * told in advance that safety guidance stays in English, rather than
 * discovering it at the worst possible moment.
 */
export function UiLanguageForm({ initial }: { initial: UiLanguage }) {
  const [state, formAction, pending] = useActionState(updateUiLanguage, undefined);
  const Icon = APP_ICON.learn;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon aria-hidden className="h-5 w-5 text-brand-green dark:text-brand-green-bright" />
          App language
        </CardTitle>
        <CardDescription>
          Which language the menus and buttons use as you move around the app.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="sr-only">App language</legend>
            {OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-charcoal-ink/10 p-3 hover:border-brand-green/40 dark:border-night-ink/15 dark:hover:border-brand-green-bright/40"
              >
                <input
                  type="radio"
                  name="language"
                  value={option.value}
                  defaultChecked={initial === option.value}
                  className="mt-1 h-4 w-4 accent-brand-green"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-charcoal-ink dark:text-night-ink">
                    {UI_LANGUAGE_LABEL[option.value]}
                  </span>
                  <span className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                    {option.hint}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            Your health information, anything a doctor writes to you, and every safety message stay
            in English, whichever you pick. We would rather keep those in one language than give you
            half a translation of something that matters.
          </p>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {state?.success && (
              <span className="text-sm text-brand-green dark:text-brand-green-bright">Saved.</span>
            )}
            {state?.error && (
              <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
