"use client";

import { Button } from "@/components/ui/button";
import { t } from "@tarragon/i18n";

/** A tiny client island so the card page itself stays a server component. */
export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()}>
      {t("my_health.immunisation.print")}
    </Button>
  );
}
