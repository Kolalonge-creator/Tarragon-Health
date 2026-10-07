"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { resolveFacilityChoice } from "@/lib/referrals/facility-choice";

interface DirectoryFacility {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
}

/**
 * S64 (15.6): name the facility a referral letter goes to. A directory entry is preferred (so the name is a real listing); free text
 * is only the fallback for a place that is not in the directory. Never both, and only while the referral is unsigned: the database
 * (set_referral_facility) enforces both, this form just never offers what it would refuse.
 */
export function ReferralFacilityForm({
  referralId,
  currentFacilityId,
  currentFreeText,
  signed,
}: {
  referralId: string;
  currentFacilityId: string | null;
  currentFreeText: string | null;
  signed: boolean;
}) {
  const router = useRouter();
  const [facilityId, setFacilityId] = useState(currentFacilityId ?? "");
  const [freeText, setFreeText] = useState(currentFreeText ?? "");
  const [notice, setNotice] = useState<{ ok: boolean; key: "referral.facility.saved" | "referral.facility.failed" } | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: facilities } = useQuery({
    queryKey: ["referrals", "directory-facilities"] as const,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("facilities")
        .select("id, name, city, state")
        .eq("is_active", true)
        .order("name", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as DirectoryFacility[];
    },
  });

  if (signed) {
    return (
      <p className="text-xs text-charcoal-ink/60">
        {currentFacilityId ? facilities?.find((f) => f.id === currentFacilityId)?.name : currentFreeText}
      </p>
    );
  }

  const choice = resolveFacilityChoice(facilityId, freeText);

  async function save() {
    setSaving(true);
    setNotice(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_referral_facility" as never, {
      p_referral: referralId,
      p_facility: choice.facilityId,
      p_free_text: choice.freeText,
    } as never);
    setSaving(false);
    if (error) {
      setNotice({ ok: false, key: "referral.facility.failed" });
      return;
    }
    setNotice({ ok: true, key: "referral.facility.saved" });
    router.refresh();
  }

  return (
    <div className="space-y-2 border-t border-charcoal-ink/10 pt-3">
      <p className="text-xs font-medium text-charcoal-ink">{t("referral.facility.label", "en")}</p>
      <label className="block text-xs text-charcoal-ink/70" htmlFor={`facility-${referralId}`}>{t("referral.facility.choose", "en")}</label>
      <Select id={`facility-${referralId}`} value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
        <option value="">{t("referral.facility.none", "en")}</option>
        {(facilities ?? []).map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
            {f.city ? `, ${f.city}` : ""}
          </option>
        ))}
      </Select>
      <label className="block text-xs text-charcoal-ink/70" htmlFor={`facility-text-${referralId}`}>{t("referral.facility.or_type", "en")}</label>
      <Input
        id={`facility-text-${referralId}`}
        value={freeText}
        maxLength={200}
        disabled={facilityId !== ""}
        onChange={(e) => setFreeText(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={saving} onClick={save}>
          {t("referral.facility.save", "en")}
        </Button>
        {notice && (
          <p role={notice.ok ? "status" : "alert"} className={notice.ok ? "text-xs text-brand-green" : "text-xs text-red-600"}>
            {t(notice.key, "en")}
          </p>
        )}
      </div>
    </div>
  );
}
