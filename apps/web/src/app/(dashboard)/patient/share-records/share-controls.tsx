"use client";

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  useRecordShares,
  useCreateRecordShare,
  useRevokeRecordShare,
  recordShareUrl,
  SHARE_SECTIONS,
  type CreatedRecordShare,
  type RecordShareSection,
} from "@/lib/queries/record-shares";
import { expiryLabel, getSharingConfig } from "@/lib/my-health/share-config";
import { t, type Locale } from "@tarragon/i18n";

const SECTION_LABELS: Record<RecordShareSection, string> = {
  vitals: "share.sections.vitals",
  medications: "share.sections.medications",
  conditions: "share.sections.conditions",
  allergies: "share.sections.allergies",
  lab_results: "share.sections.lab_results",
  vaccinations: "share.sections.vaccinations",
  emergency_info: "share.sections.emergency_info",
};

const SHARING = getSharingConfig();

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ShareControls({
  patientId,
  locale = "en",
}: {
  patientId: string;
  locale?: Locale;
}) {
  const { data: shares, isLoading } = useRecordShares(patientId);
  const createShare = useCreateRecordShare();
  const revokeShare = useRevokeRecordShare();

  const [selectedSections, setSelectedSections] = useState<Set<RecordShareSection>>(new Set());
  const [expiryHours, setExpiryHours] = useState(String(SHARING.default_expiry_hours));
  const [usePin, setUsePin] = useState(false);
  const [oneSession, setOneSession] = useState(false);
  const [created, setCreated] = useState<CreatedRecordShare | null>(null);
  const [createFailed, setCreateFailed] = useState(false);
  const [pinCopied, setPinCopied] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const toggleSection = useCallback((section: RecordShareSection) => {
    setSelectedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  }, []);

  const handleCreate = useCallback(async () => {
    if (selectedSections.size === 0) return;
    setCreateFailed(false);
    try {
      const result = await createShare.mutateAsync({
        sections: Array.from(selectedSections),
        expiresInHours: Number.parseInt(expiryHours, 10),
        usePin,
        oneSession,
      });
      setCreated(result);
      setSelectedSections(new Set());
      setUsePin(false);
      setOneSession(false);
    } catch {
      setCreateFailed(true);
    }
  }, [selectedSections, expiryHours, usePin, oneSession, createShare]);

  const handleCopy = useCallback(async (token: string, shareId: string) => {
    try {
      const url = recordShareUrl(token);
      await navigator.clipboard.writeText(url);
      setCopiedId(shareId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard unavailable or denied: the link is on screen to copy by hand.
    }
  }, []);

  const handleCopyPin = useCallback(async (pin: string) => {
    try {
      await navigator.clipboard.writeText(pin);
      setPinCopied(true);
      setTimeout(() => setPinCopied(false), 2000);
    } catch {
      // Clipboard unavailable: the PIN is on screen to copy by hand.
    }
  }, []);

  const activeShares = shares?.filter(
    (s) => s.is_active && new Date(s.expires_at) > new Date()
  );

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
              <label
                key={section}
                className="flex items-center gap-2 rounded-lg border border-charcoal-ink/10 px-3 py-2 text-sm cursor-pointer hover:bg-charcoal-ink/5 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedSections.has(section)}
                  onChange={() => toggleSection(section)}
                  className="h-4 w-4 accent-brand-green"
                />
                <span>
                  {t(SECTION_LABELS[section] as Parameters<typeof t>[0], locale)}
                </span>
              </label>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Label htmlFor="expiry" className="text-sm whitespace-nowrap">
              {t("share.expiry.label", locale)}
            </Label>
            <Select
              id="expiry"
              className="w-36"
              value={expiryHours}
              onChange={(e) => setExpiryHours(e.target.value)}
            >
              {SHARING.expiry_options_hours.map((hours) => (
                <option key={hours} value={String(hours)}>
                  {expiryLabel(hours, locale)}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={usePin} onChange={(e) => setUsePin(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-green" />
              <span>
                <span className="font-medium">{t("share.pin.label", locale)}</span>
                <span className="block text-xs text-charcoal-ink/60">{t("share.pin.hint", locale, { digits: String(SHARING.pin_digits) })}</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={oneSession} onChange={(e) => setOneSession(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-green" />
              <span>
                <span className="font-medium">{t("share.session.label", locale)}</span>
                <span className="block text-xs text-charcoal-ink/60">{t("share.session.hint", locale, { minutes: String(SHARING.one_session_window_minutes) })}</span>
              </span>
            </label>
          </div>

          <p className="text-xs text-charcoal-ink/60">{t("share.consent_notice", locale)}</p>

          {createFailed && (
            <p role="alert" className="text-sm text-red-700">
              {t("share.create_failed", locale)}
            </p>
          )}

          <Button
            onClick={handleCreate}
            disabled={selectedSections.size === 0 || createShare.isPending}
            className="w-full"
          >
            {createShare.isPending
              ? t("share.creating", locale)
              : t("share.create", locale)}
          </Button>
        </CardContent>
      </Card>

      {created && (
        <Card role="status">
          <CardHeader>
            <CardTitle>{t("share.created.title", locale)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="break-all rounded-lg bg-charcoal-ink/5 p-3 text-sm">{recordShareUrl(created.token)}</p>
            <Button variant="outline" size="sm" onClick={() => handleCopy(created.token, created.id)}>
              {copiedId === created.id ? t("share.link_copied", locale) : t("share.copy_link", locale)}
            </Button>
            {created.pin && (
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="text-sm font-medium">{t("share.created.pin_title", locale)}</p>
                <p className="font-mono text-2xl tracking-widest">{created.pin}</p>
                <p className="text-xs text-charcoal-ink/70">{t("share.created.pin_warning", locale)}</p>
                <Button variant="outline" size="sm" onClick={() => handleCopyPin(created.pin as string)}>
                  {pinCopied ? t("share.pin_copied", locale) : t("share.copy_pin", locale)}
                </Button>
              </div>
            )}
            <Button size="sm" onClick={() => setCreated(null)}>
              {t("share.created.done", locale)}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("share.active_shares", locale)}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-charcoal-ink/50">Loading...</p>
          ) : !activeShares || activeShares.length === 0 ? (
            <p className="text-sm text-charcoal-ink/50">
              {t("share.no_active_shares", locale)}
            </p>
          ) : (
            <ul className="space-y-3">
              {activeShares.map((share) => (
                <li
                  key={share.id}
                  className="rounded-lg border border-charcoal-ink/10 p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm">
                      <p className="font-medium text-charcoal-ink">
                        {share.sections.join(", ")}
                        {share.pin_protected ? (
                          <span className="ml-2 rounded-full bg-charcoal-ink/10 px-2 py-0.5 text-xs">{t("share.badge.pin", locale)}</span>
                        ) : null}
                        {share.one_session ? (
                          <span className="ml-2 rounded-full bg-charcoal-ink/10 px-2 py-0.5 text-xs">{t("share.badge.session", locale)}</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-charcoal-ink/60">
                        {t("share.expires", locale, {
                          date: formatDate(share.expires_at),
                        })}
                        {" · "}
                        {t("share.views", locale, {
                          count: String(share.view_count),
                        })}
                      </p>
                      {share.locked_at ? (
                        <p role="status" className="text-xs text-red-700">
                          {t("share.locked", locale)}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopy(share.token, share.id)}
                      >
                        {copiedId === share.id
                          ? t("share.link_copied", locale)
                          : t("share.copy_link", locale)}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => {
                          setRevokingId(share.id);
                          revokeShare.mutate(share.id, {
                            onSettled: () => setRevokingId(null),
                          });
                        }}
                        disabled={revokingId === share.id}
                      >
                        {revokingId === share.id
                          ? t("share.revoking", locale)
                          : t("share.revoke", locale)}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
