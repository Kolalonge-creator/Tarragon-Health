"use client";

import { useEffect, useRef, useState } from "react";
import { t, type MessageKey } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listMySkinPhotos, uploadSkinPhoto, withdrawSkinPhoto, type MySkinPhoto } from "./skin-photo-actions";
import { BODY_AREAS } from "./skin-photo-config";

/** Shrinks a large photo in the browser before it is sent (kind to slow connections; also drops metadata and fixes rotation). The
 *  server strips metadata again and is the one that decides: this is a courtesy, never a check. */
async function shrink(file: File, maxEdge = 1600): Promise<File> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    return blob ? new File([blob], "photo.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

/** Photos for the care team to look at (spec 12.7). Never scored: a clinician reviews it and it is not a diagnosis. Open only while the checker is. */
export function SkinPhotoCard({ assessmentId }: { assessmentId: string | null }) {
  const [photos, setPhotos] = useState<MySkinPhoto[]>([]);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "closed" | "error">("idle");
  const [reason, setReason] = useState<string>("other");
  const [consent, setConsent] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    void listMySkinPhotos().then(setPhotos).catch(() => setPhotos([]));
  }, [state]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const f = fd.get("photo");
    if (!(f instanceof File) || f.size === 0) return;
    setState("sending");
    fd.set("photo", await shrink(f));
    if (assessmentId) fd.set("assessment_id", assessmentId);
    try {
      const r = await uploadSkinPhoto(fd);
      if (r.status === "sent") {
        setState("sent");
        form.current?.reset();
        setConsent(false);
      } else if (r.status === "unavailable") setState("closed");
      else {
        setReason(r.reason);
        setState("error");
      }
    } catch {
      setReason("other");
      setState("error");
    }
  }

  const errorKey: Record<string, MessageKey> = {
    too_big: "symptom.skin.too_big",
    bad_type: "symptom.skin.bad_type",
    too_many: "symptom.skin.too_many",
    consent: "symptom.skin.consent",
    other: "symptom.skin.error",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("symptom.skin.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>{t("symptom.skin.intro")}</p>
        <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("symptom.skin.no_private")}</p>
        <form ref={form} onSubmit={submit} className="space-y-2">
          <label className="block">
            {t("symptom.skin.area")}
            <select name="body_area" className="mt-1 block w-full rounded border border-charcoal-ink/20 bg-transparent p-1" defaultValue="other">
              {BODY_AREAS.map((a) => (
                <option key={a} value={a}>
                  {t(`symptom.skin.area.${a}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            {t("symptom.skin.note")}
            <textarea name="note" maxLength={500} rows={2} className="mt-1 block w-full rounded border border-charcoal-ink/20 bg-transparent p-1" />
          </label>
          <label className="block">
            {t("symptom.skin.choose")}
            <input name="photo" type="file" accept="image/jpeg,image/png" capture="environment" required className="mt-1 block w-full" />
          </label>
          <label className="flex items-start gap-2">
            <input name="consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
            <span>{t("symptom.skin.consent")}</span>
          </label>
          <Button type="submit" disabled={!consent || state === "sending"}>
            {t("symptom.skin.send")}
          </Button>
        </form>
        {state === "sent" && <p>{t("symptom.skin.sent")}</p>}
        {state === "closed" && <p>{t("symptom.skin.closed")}</p>}
        {state === "error" && <p className="text-red-800">{t(errorKey[reason] ?? "symptom.skin.error")}</p>}
        {photos.length > 0 && (
          <ul className="space-y-2">
            {photos.map((p) => (
              <li key={p.id} className="rounded border border-charcoal-ink/10 p-2">
                {/* a short-lived signed link to a private file: next/image cannot optimise it */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.url && <img src={p.url} alt="" className="mb-1 h-24 w-24 rounded object-cover" />}
                <p>{p.status === "reviewed" ? t("symptom.skin.reviewed") : t("symptom.skin.waiting")}</p>
                {p.message && <p>{p.message}</p>}
                {p.status === "submitted" && (
                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={async () => {
                      await withdrawSkinPhoto(p.id);
                      setPhotos((xs) => xs.filter((x) => x.id !== p.id));
                    }}
                  >
                    {t("symptom.skin.withdraw")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
