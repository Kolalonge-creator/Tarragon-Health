"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { fetchMyPhones, requestPhoneRemoval, updateMyPhone } from "@/lib/my-health/my-phones";
import { buildPhoneViews, cleanPhoneName, PHONE_NAME_MAX, type PhoneView } from "@tarragon/shared";
import { t } from "@tarragon/i18n";

const when = (value: string) =>
  new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

type Notice = { kind: "ok" | "error"; text: string } | null;

export function PhonesList({ initial, dropped }: { initial: PhoneView[]; dropped: number }) {
  const [phones, setPhones] = useState(initial);
  const [partial, setPartial] = useState(dropped > 0);
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reload = async () => {
    const r = await fetchMyPhones(createClient());
    if (!r.ok) {
      setStale(true);
      return;
    }
    setStale(false);
    setPhones(buildPhoneViews(r.rows, new Date(), null));
    setPartial(r.dropped > 0);
  };

  // Read after mount and kept current, so the markup matches on the server and the banner follows the connection.
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const saveName = (id: string) =>
    start(async () => {
      const name = cleanPhoneName(draft);
      const ok = await updateMyPhone(createClient(), id, { label: name });
      if (!ok) return setNotice({ kind: "error", text: t("my_phones.save_failed") });
      setEditing(null);
      setNotice({ kind: "ok", text: t("my_phones.saved") });
      await reload();
    });

  const toggleShared = (p: PhoneView, next: boolean) =>
    start(async () => {
      const ok = await updateMyPhone(createClient(), p.deviceId, { shared: next });
      if (!ok) return setNotice({ kind: "error", text: t("my_phones.save_failed") });
      setNotice({ kind: "ok", text: t("my_phones.saved") });
      await reload();
    });

  const remove = (id: string) =>
    start(async () => {
      const ok = await requestPhoneRemoval(createClient(), id);
      if (!ok) return setNotice({ kind: "error", text: t("my_phones.remove_failed") });
      setRemoving(null);
      setNotice({ kind: "ok", text: t("my_phones.remove_sent") });
      await reload();
    });

  return (
    <div className="space-y-4">
      {offline && (
        <p role="status" className="text-sm text-charcoal-ink/70">
          {t("my_phones.offline")}
        </p>
      )}
      {partial && (
        <p role="status" className="text-sm text-charcoal-ink/70">
          {t("my_phones.partial")}
        </p>
      )}
      {stale && (
        <p role="alert" className="text-sm text-red-700">
          {t("my_phones.stale")}
        </p>
      )}
      {notice && (
        <p role={notice.kind === "error" ? "alert" : "status"} className={notice.kind === "error" ? "text-sm text-red-700" : "text-sm text-green-800"}>
          {notice.text}
        </p>
      )}

      {phones.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">{t("my_phones.empty_web")}</p>
      ) : (
        phones.map((p) => {
          const manageable = p.status === "active" || p.status === "lapsed";
          return (
            <Card key={p.deviceId}>
              <CardHeader>
                <CardTitle>
                  {p.name}
                  {p.shared && <span className="ml-2 text-xs font-normal text-charcoal-ink/70">{t("my_phones.shared_badge")}</span>}
                </CardTitle>
                <CardDescription>{t(`my_phones.status.${p.status}`)}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{t("my_phones.last_seen", "en", { when: when(p.lastSeenAt) })}</p>
                {p.status === "active" && <p className="text-charcoal-ink/70">{t("my_phones.lease", "en", { when: when(p.leaseExpiresAt) })}</p>}
                {p.status === "wiped" && p.unsentAtWipe !== null && (
                  <p>
                    {p.unsentAtWipe === 0
                      ? t("my_phones.wiped_count_none")
                      : t("my_phones.wiped_count", "en", { n: String(p.unsentAtWipe) })}
                    {p.urgentAtWipe ? ` ${t("my_phones.wiped_count_urgent", "en", { u: String(p.urgentAtWipe) })}` : ""}
                  </p>
                )}

                {manageable && (
                  <>
                    {editing === p.deviceId ? (
                      <form
                        className="flex flex-wrap items-end gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          saveName(p.deviceId);
                        }}
                      >
                        <label className="block">
                          <span className="block text-xs text-charcoal-ink/70">{t("my_phones.rename_label")}</span>
                          <input
                            value={draft}
                            maxLength={PHONE_NAME_MAX}
                            onChange={(e) => setDraft(e.target.value)}
                            className="mt-1 h-11 w-64 max-w-full rounded-md border border-charcoal-ink/30 px-3"
                          />
                        </label>
                        <Button type="submit" size="lg" disabled={pending}>
                          {t("my_phones.save")}
                        </Button>
                        <Button type="button" size="lg" variant="outline" onClick={() => setEditing(null)}>
                          {t("my_phones.cancel")}
                        </Button>
                      </form>
                    ) : (
                      <Button
                        type="button"
                        size="lg"
                        variant="outline"
                        onClick={() => {
                          setEditing(p.deviceId);
                          setDraft(p.nameIsDefault ? "" : p.name);
                        }}
                      >
                        {t("my_phones.rename")}
                      </Button>
                    )}

                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={p.shared}
                        disabled={pending}
                        onChange={(e) => toggleShared(p, e.target.checked)}
                        className="mt-0.5 h-5 w-5 accent-brand-green"
                      />
                      <span>
                        <span className="font-medium">{t("my_phones.shared_toggle")}</span>
                        <span className="block text-xs text-charcoal-ink/70">{t("my_phones.shared_hint")}</span>
                      </span>
                    </label>

                    {removing === p.deviceId ? (
                      <div role="alertdialog" aria-label={t("my_phones.remove_title")} className="space-y-2 rounded-md border border-charcoal-ink/20 p-3">
                        <p className="font-medium">{t("my_phones.remove_title")}</p>
                        <p>{t("my_phones.remove_body")}</p>
                        <p>{t("my_phones.remove_last_try")}</p>
                        <p>{t("my_phones.remove_urgent")}</p>
                        {p.shared && <p>{t("my_phones.remove_shared_warning")}</p>}
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="lg" disabled={pending} onClick={() => remove(p.deviceId)}>
                            {t("my_phones.remove_confirm")}
                          </Button>
                          <Button type="button" size="lg" variant="outline" onClick={() => setRemoving(null)}>
                            {t("my_phones.cancel")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button type="button" size="lg" variant="outline" onClick={() => setRemoving(p.deviceId)}>
                        {t("my_phones.remove")}
                      </Button>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

/** Shown with the "could not load" line so a patient can try again without leaving the page. */
export function ReloadButton() {
  const router = useRouter();
  return (
    <Button type="button" size="lg" variant="outline" onClick={() => router.refresh()}>
      {t("my_phones.retry")}
    </Button>
  );
}
