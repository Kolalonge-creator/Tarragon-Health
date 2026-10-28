import { useEffect, useState } from "react";
import { asLocale, t } from "@tarragon/i18n";
import { hasLowCarbProgramme } from "@/lib/lowcarb";
import { useUiLanguage } from "@/lib/ui-language";
import type { SectionId } from "@/lib/sections";
import { AppText, Button, Card } from "@/ui/kit";

/**
 * One quiet link to the supported eating programme (S50b), shown ONLY to someone a clinician has offered it. Everyone else sees nothing at all: the
 * programme is never advertised, and it has no entry in the drawer. A failed check shows nothing (the screen asks again when opened).
 */
export function LowCarbLinkCard({ onNavigate }: { onNavigate?: (id: SectionId) => void }) {
  const locale = asLocale(useUiLanguage());
  const [show, setShow] = useState(false);
  useEffect(() => {
    let live = true;
    void hasLowCarbProgramme().then((ok) => {
      if (live) setShow(ok);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!show || !onNavigate) return null;
  return (
    <Card>
      <AppText variant="bodyStrong">{t("lowcarb.title", locale)}</AppText>
      <Button title={t("lowcarb.link.open", locale)} variant="secondary" onPress={() => onNavigate("lowCarb")} />
    </Card>
  );
}
