"use client";

import { useActionState } from "react";
import { COUNTRY_CALLING_CODES } from "@tarragon/shared";
import { t, type Locale } from "@tarragon/i18n";
import { startProxySetupAction } from "./proxy-setup-actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * "Set up for my parent" (v5 8.2, function 1.19). The proxy enters a name and a number; the code goes to the parent's
 * phone, never to this screen, and this screen never shows anything about the parent beyond what was typed here.
 */
export function ProxySetupForm({ locale }: { locale: Locale }) {
  const [state, formAction, pending] = useActionState(startProxySetupAction, undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("proxy.setup.title", locale)}</CardTitle>
        <CardDescription>{t("proxy.setup.intro", locale)}</CardDescription>
      </CardHeader>
      <CardContent>
        {state?.sent ? (
          <p role="status" className="text-sm text-charcoal-ink/80">
            {t("proxy.setup.sent", locale, { hours: String(state.hours ?? 72) })}
          </p>
        ) : (
          <form action={formAction} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="proxy-name">{t("proxy.setup.name_label", locale)}</Label>
              <Input id="proxy-name" name="fullName" autoComplete="off" required maxLength={200} className="h-11 rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proxy-phone">{t("proxy.setup.phone_label", locale)}</Label>
              <div className="flex gap-2">
                <Select
                  name="countryCode"
                  defaultValue={COUNTRY_CALLING_CODES[0].dialCode}
                  className="h-11 w-auto shrink-0 rounded-xl"
                  aria-label="Country code"
                  required
                >
                  {COUNTRY_CALLING_CODES.map((country) => (
                    <option key={country.iso} value={country.dialCode}>
                      {country.label} ({country.dialCode})
                    </option>
                  ))}
                </Select>
                <Input id="proxy-phone" name="phone" type="tel" inputMode="tel" autoComplete="off" required className="h-11 rounded-xl" />
              </div>
            </div>
            {state?.error && (
              <p role="alert" className="text-sm text-red-700">
                {state.error}
              </p>
            )}
            <Button type="submit" disabled={pending} className="rounded-xl">
              {t("proxy.setup.submit", locale)}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
