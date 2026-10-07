"use client";

import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  useRecordShares,
  useRecordShareAttempts,
  useRecordShareConfig,
  useCreateRecordShare,
  useRevokeRecordShare,
  recordShareUrl,
  SHARE_SECTIONS,
  type CreatedShare,
  type RecordShareSection,
} from "@/lib/queries/record-shares";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";

const SECTION_LABELS: Record<RecordShareSection, MessageKey> = {
  vitals: "share.sections.vitals",
  medications: "share.sections.medications",
  conditions: "share.sections.conditions",
  allergies: "share.sections.allergies",
  lab_results: "share.sections.lab_results",
  vaccinations: "share.sections.vaccinations",
  emergency_info: "share.sections.emergency_info",
  procedures: "share.sections.procedures",
  family_history: "share.sections.family_history",
};

// "default" means: send nothing, so the database applies the configured default.
const EXPIRY_OPTIONS: { value: string; labelKey: MessageKey }[] = [
  { value: "default", labelKey: "share.expiry.default_choice" },
  { value: "1", labelKey: "share.expiry.1h" },
  { value: "24", labelKey: "share.expiry.24h" },
  { value: "72", labelKey: "share.expiry.72h" },
  { value: "168", labelKey: "share.expiry.7d" },
  { value: "720", labelKey: "share.expiry.30d" },
];

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** The QR is made in the browser from the link, so the link never leaves this page to be drawn. */
function LinkQr({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    import("qrcode")
      .then((q) => q.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 180 }))
      .then((d) => alive && setSrc(d))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [url]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" width={180} height={180} className="rounded border border-charcoal-ink/10" /> : null;
}

export function ShareControls({ patientId, locale = "en" }: { patientId: string; locale?: Locale }) {
  const { data: shares, isLoading } = useRecordShares(patientId);
  const { data: attempts } = useRecordShareAttempts(patientId);
  const { data: config } = useRecordShareConfig();
  const createShare = useCreateRecordShare();
  const revokeShare = useRevokeRecordShare();

  const [selectedSections, setSelectedSections] = useState<Set<RecordShareSection>>(new Set());
  const [expiry, setExpiry] = useState("default");
  const [pin, setPin] = useState("");
  const [maxViews, setMaxViews] = useState("");
  const [created, setCreated] = useState<CreatedShare | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const toggleSection = useCallback((section: RecordShareSection) => {
    setSelectedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);

  const handleCreate = useCallback(async () => {
    if (selectedSections.size === 0) return;
    setError(null);
    try {
      const result = await createShare.mutateAsync({
        sections: Array.from(selectedSections),
        expiresInHours: expiry === "default" ? undefined : Number.parseInt(expiry, 10),
        pin: pin.trim() || undefined,
        maxViews: maxViews.trim() ? Number.parseInt(maxViews, 10) : undefined,
      });
      setCreated(result);
      setSelectedSections(new Set());
      setPin("");
      setMaxViews("");
    } catch {
      setError(t("healthhistory.error", locale));
    }
  }, [selectedSections, expiry, pin, maxViews, createShare, locale]);

  const copy = useCallback(async (token: string) => {
    try {
      await navigator.clipboard.writeText(recordShareUrl(token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable or denied: the link is still on screen to copy by hand.
    }
  }, []);

  const activeShares = shares?.filter((s) => s.is_active && new Date(s.expires_at) > new Date());
  const minPin = config?.min_pin_length ?? 4;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("share.title", locale)}</CardTitle>
          <CardDescription>{t("share.description", locale)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {SHARE_SECTIONS.map((section) => (
              <label key={section} className="flex cursor-pointer items-center gap-2 rounded-lg border border-charcoal-ink/10 px-3 py-2 text-sm transition-colors hover:bg-charcoal-ink/5">
                <input type="checkbox" checked={selectedSections.has(section)} onChange={() => toggleSection(section)} className="h-4 w-4 accent-brand-green" />
                <span>{t(SECTION_LABELS[section], locale)}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-charcoal-ink/60">{t("share.excluded_note", locale)}</p>

          <div className="flex items-center gap-3">
            <Label htmlFor="expiry" className="whitespace-nowrap text-sm">
              {t("share.expiry.label", locale)}
            </Label>
            <Select id="expiry" className="w-44" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              {EXPIRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.value === "default" && config ? t("share.expiry.default_hours", locale, { hours: String(config.default_hours) }) : t(opt.labelKey, locale)}
                </option>
              ))}
            </Select>
          </div>
          {config && <p className="text-xs text-charcoal-ink/60">{t("share.default_note", locale, { hours: String(config.default_hours) })}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="share-pin" className="text-sm">
                {t("share.pin.label", locale)}
              </Label>
              <Input id="share-pin" inputMode="numeric" autoComplete="off" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder={`${minPin}-8`} />
              <p className="mt-1 text-xs text-charcoal-ink/60">{t("share.pin.help", locale)}</p>
            </div>
            <div>
              <Label htmlFor="share-max" className="text-sm">
                {t("share.max_views.label", locale)}
              </Label>
              <Input id="share-max" inputMode="numeric" maxLength={4} value={maxViews} onChange={(e) => setMaxViews(e.target.value.replace(/\D/g, ""))} placeholder="1-1000" />
            </div>
          </div>

          <p className="text-xs text-charcoal-ink/60">{t("share.consent_notice", locale)}</p>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <Button onClick={handleCreate} disabled={selectedSections.size === 0 || createShare.isPending || (pin.length > 0 && pin.length < minPin)} className="w-full">
            {createShare.isPending ? t("share.creating", locale) : t("share.create", locale)}
          </Button>
        </CardContent>
      </Card>

      {created && (
        <Card>
          <CardHeader>
            <CardTitle>{t("share.new_link", locale)}</CardTitle>
            <CardDescription>{t("share.link_once", locale)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="break-all rounded bg-charcoal-ink/5 p-2 font-mono text-xs">{recordShareUrl(created.token)}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => copy(created.token)}>
                {copied ? t("share.link_copied", locale) : t("share.copy_link", locale)}
              </Button>
              <span className="text-xs text-charcoal-ink/60">{t("share.expires", locale, { date: formatDate(created.expires_at) })}</span>
            </div>
            <LinkQr url={recordShareUrl(created.token)} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("share.active_shares", locale)}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-charcoal-ink/50">...</p>
          ) : !activeShares || activeShares.length === 0 ? (
            <p className="text-sm text-charcoal-ink/50">{t("share.no_active_shares", locale)}</p>
          ) : (
            <ul className="space-y-3">
              {activeShares.map((share) => (
                <li key={share.id} className="rounded-lg border border-charcoal-ink/10 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm">
                      <p className="font-medium text-charcoal-ink">{share.sections.map((s) => t(SECTION_LABELS[s], locale)).join(", ")}</p>
                      <p className="text-xs text-charcoal-ink/60">
                        {t("share.expires", locale, { date: formatDate(share.expires_at) })}
                        {" · "}
                        {share.max_views ? t("share.views_cap", locale, { count: String(share.view_count), max: String(share.max_views) }) : t("share.views", locale, { count: String(share.view_count) })}
                        {share.has_pin ? ` · ${t("share.has_pin", locale)}` : ""}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-red-200 text-red-600 hover:bg-red-50"
                      onClick={() => {
                        setRevokingId(share.id);
                        revokeShare.mutate(share.id, { onSettled: () => setRevokingId(null) });
                      }}
                      disabled={revokingId === share.id}
                    >
                      {revokingId === share.id ? t("share.revoking", locale) : t("share.revoke", locale)}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("share.attempts.title", locale)}</CardTitle>
        </CardHeader>
        <CardContent>
          {!attempts || attempts.length === 0 ? (
            <p className="text-sm text-charcoal-ink/50">{t("share.attempts.none", locale)}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {attempts.map((a) => (
                <li key={a.id} className="flex justify-between gap-3">
                  <span className={a.outcome === "viewed" ? "" : "text-amber-800"}>{t(`share.outcome.${a.outcome}` as MessageKey, locale)}</span>
                  <span className="text-xs text-charcoal-ink/60">{formatDate(a.looked_up_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
