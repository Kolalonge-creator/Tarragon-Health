import { useEffect, useState } from "react";
import { View } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { loadSupported } from "@/lib/care-circle/api";
import { loadPeopleISupport } from "@/lib/acting";
import { SegmentedControl } from "@/ui/kit/SegmentedControl";
import { space } from "@/ui/design";

type Mode = "mine" | "supporting";

/**
 * "My health / People I support" for an account that is both (supporter join path). Shown on the person's own home only once they
 * support somebody (a Care Circle or account access); a failed read hides it rather than showing a switch to an empty page.
 */
export function CareModeSwitch({ userId, active, onSelect }: { userId: string; active: Mode; onSelect: (mode: Mode) => void }) {
  const locale = asLocale(useUiLanguage());
  const [supportsSomeone, setSupportsSomeone] = useState(active === "supporting");

  useEffect(() => {
    if (active === "supporting") return;
    let alive = true;
    void Promise.all([loadSupported(), loadPeopleISupport(userId).catch(() => [])]).then(([circle, managed]) => {
      if (alive) setSupportsSomeone((circle.ok && circle.data.length > 0) || managed.length > 0);
    });
    return () => {
      alive = false;
    };
  }, [active, userId]);

  if (!supportsSomeone) return null;
  return (
    <View style={{ paddingHorizontal: space.xl, paddingTop: space.md }}>
      <SegmentedControl<Mode>
        options={[
          { value: "mine", label: t("supporterjoin.mode.mine", locale) },
          { value: "supporting", label: t("supporterjoin.mode.supporting", locale) },
        ]}
        value={active}
        onChange={(mode) => {
          if (mode !== active) onSelect(mode);
        }}
        accessibilityLabel={t("supporterjoin.mode.label", locale)}
      />
    </View>
  );
}
