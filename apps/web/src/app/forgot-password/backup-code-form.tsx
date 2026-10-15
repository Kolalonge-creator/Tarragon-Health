"use client";

import { useActionState } from "react";
import { t } from "@tarragon/i18n";
import { recoverWithBackupCodeAction } from "./recovery-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";

/**
 * Recovery with one of the ten backup codes (S03b). Works with no working phone and no working email. The code is single
 * use. Every wrong identifier or code reads the same, so this form cannot be used to find out who has an account.
 */
export function BackupCodeForm() {
  const [state, formAction, pending] = useActionState(recoverWithBackupCodeAction, undefined);
  const identifierId = fieldErrorId("backup-identifier");
  const codeId = fieldErrorId("backup-code");
  const passwordId = fieldErrorId("backup-password");
  const confirmId = fieldErrorId("backup-confirm");

  if (state?.success) {
    return (
      <p role="status" className="text-sm text-charcoal-ink/70">
        {state.message}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <p className="text-sm text-charcoal-ink/60">{t("auth.recovery.backup_intro")}</p>
      <div className="space-y-1.5">
        <Label htmlFor="backup-identifier">{t("auth.recovery.identifier")}</Label>
        <Input
          id="backup-identifier"
          name="identifier"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          {...fieldErrorProps(identifierId, state?.field === "identifier")}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="backup-code">{t("auth.recovery.backup_code")}</Label>
        <Input
          id="backup-code"
          name="code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="XXXXX-XXXXX"
          required
          {...fieldErrorProps(codeId, state?.field === "code")}
        />
        <FormError id={codeId} message={state?.field === "code" ? state.error : undefined} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="backup-password">{t("auth.field.new_password")}</Label>
        <PasswordInput
          id="backup-password"
          name="password"
          autoComplete="new-password"
          required
          {...fieldErrorProps(passwordId, state?.field === "password")}
        />
        <FormError id={passwordId} message={state?.field === "password" ? state.error : undefined} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="backup-confirm">{t("auth.field.confirm_password")}</Label>
        <PasswordInput
          id="backup-confirm"
          name="confirmPassword"
          autoComplete="new-password"
          required
          {...fieldErrorProps(confirmId, state?.field === "confirmPassword")}
        />
        <FormError id={confirmId} message={state?.field === "confirmPassword" ? state.error : undefined} />
      </div>
      {state?.error && !state.field ? <FormError id={fieldErrorId("backup-general")} message={state.error} /> : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("auth.recovery.backup_submitting") : t("auth.recovery.backup_submit")}
      </Button>
    </form>
  );
}
