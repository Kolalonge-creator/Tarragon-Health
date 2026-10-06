"use client";

import { useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/form-error";
import { formatPatientDate, formatPatientDateTime } from "@/lib/format-date";
import { CIRCLE_PERMISSIONS, GRANT_DAY_CHOICES, circleErrorKey, inviteLinkPath, permissionKey, type CircleMember, type CirclePermission } from "@/lib/care-circle/model";
import {
  CircleError,
  useCancelInvite,
  useCircleViewLog,
  useCreateInvite,
  useMyCircle,
  useRevokeMember,
  useUpdateMember,
} from "@/lib/queries/care-circle";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";

function PermissionBoxes({ id, value, onChange, locale }: { id: string; value: readonly CirclePermission[]; onChange: (next: CirclePermission[]) => void; locale: Locale }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t("circle.invite.permissions", locale)}</legend>
      {CIRCLE_PERMISSIONS.map((p) => {
        const boxId = `${id}-${p}`;
        const on = value.includes(p);
        return (
          <div key={p} className={`flex items-start gap-3 ${TOUCH}`}>
            <input
              id={boxId}
              type="checkbox"
              className="mt-1 h-5 w-5"
              checked={on}
              onChange={() => onChange(on ? value.filter((x) => x !== p) : [...value, p])}
            />
            <Label htmlFor={boxId} className="font-normal leading-snug">{t(permissionKey(p), locale)}</Label>
          </div>
        );
      })}
    </fieldset>
  );
}

function MemberRow({ member, locale }: { member: CircleMember; locale: Locale }) {
  const update = useUpdateMember();
  const revoke = useRevokeMember();
  const [draft, setDraft] = useState<CirclePermission[]>(member.permissions);
  const [saved, setSaved] = useState(false);
  const [errorKey, setErrorKey] = useState<ReturnType<typeof circleErrorKey> | null>(null);
  const changed = draft.length !== member.permissions.length || draft.some((p) => !member.permissions.includes(p));

  async function save() {
    setErrorKey(null);
    setSaved(false);
    try {
      await update.mutateAsync({ memberId: member.member_id, permissions: draft });
      setSaved(true);
    } catch (e) {
      setErrorKey(circleErrorKey(e instanceof CircleError ? e.message : null));
    }
  }

  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{member.name} <span className={`text-sm font-normal ${MUTED}`}>({member.relationship})</span></p>
        <p className={`text-sm ${MUTED}`}>{t("circle.member.until", locale, { date: formatPatientDate(member.expires_at) })}</p>
      </div>
      <PermissionBoxes id={`m-${member.member_id}`} value={draft} onChange={(n) => { setDraft(n); setSaved(false); }} locale={locale} />
      <div className="flex flex-wrap gap-3">
        <Button type="button" className={TOUCH} onClick={save} disabled={!changed || draft.length === 0 || update.isPending}>
          {t("circle.member.save", locale)}
        </Button>
        <Button
          type="button"
          variant="outline"
          className={TOUCH}
          disabled={revoke.isPending}
          onClick={() => {
            if (window.confirm(t("circle.member.remove_confirm", locale, { name: member.name }))) revoke.mutate(member.member_id);
          }}
        >
          {t("circle.member.remove", locale)}
        </Button>
      </div>
      {saved ? <p role="status" className="text-sm">{t("circle.member.saved", locale)}</p> : null}
      <FormError id={`member-error-${member.member_id}`} message={errorKey ? t(errorKey, locale) : null} />
    </li>
  );
}

type Share = (text: string, link: string) => Promise<void>;
const browserShare: Share = async (text, link) => {
  if (typeof navigator.share === "function") {
    await navigator.share({ text });
  } else {
    await navigator.clipboard.writeText(link);
  }
};

function InviteMade({ link, expiresAt, locale, onDone, share = browserShare }: { link: string; expiresAt: string; locale: Locale; onDone: () => void; share?: Share }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3" role="status">
      <p>{t("circle.invite.made", locale)}</p>
      <p className="break-all rounded-md border p-3 text-sm">{link}</p>
      <p className={`text-sm ${MUTED}`}>{t("circle.invite.once", locale)} {t("circle.invite.expires", locale, { date: formatPatientDateTime(expiresAt) })}</p>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          className={TOUCH}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? t("circle.invite.copied", locale) : t("circle.invite.copy", locale)}
        </Button>
        <Button
          type="button"
          variant="outline"
          className={TOUCH}
          onClick={() => {
            // A cancelled share sheet is not an error; the link is still on screen to copy.
            share(t("circle.invite.share_text", locale, { link }), link).catch(() => undefined);
          }}
        >
          {t("circle.invite.share", locale)}
        </Button>
        <Button type="button" variant="outline" className={TOUCH} onClick={onDone}>{t("circle.invite.done", locale)}</Button>
      </div>
    </div>
  );
}

function InviteForm({ locale, origin }: { locale: Locale; origin: string }) {
  const create = useCreateInvite();
  const [kind, setKind] = useState<"email" | "phone">("email");
  const [contact, setContact] = useState("");
  const [relationship, setRelationship] = useState("");
  const [perms, setPerms] = useState<CirclePermission[]>([]);
  const [days, setDays] = useState<number>(365);
  const [errorKey, setErrorKey] = useState<ReturnType<typeof circleErrorKey> | null>(null);
  const [made, setMade] = useState<{ link: string; expiresAt: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrorKey(null);
    try {
      const r = await create.mutateAsync({ kind, contact: contact.trim(), relationship: relationship.trim(), permissions: perms, days });
      setMade({ link: `${origin}${inviteLinkPath(r.token)}`, expiresAt: r.expires_at });
    } catch (err) {
      setErrorKey(circleErrorKey(err instanceof CircleError ? err.message : null));
    }
  }

  if (made) {
    return (
      <InviteMade
        link={made.link}
        expiresAt={made.expiresAt}
        locale={locale}
        onDone={() => {
          setMade(null);
          setContact("");
          setRelationship("");
          setPerms([]);
        }}
      />
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("circle.invite.kind", locale)}</legend>
        <div className="flex gap-4">
          {(["email", "phone"] as const).map((k) => (
            <label key={k} className={`flex items-center gap-2 ${TOUCH}`}>
              <input type="radio" name="invite-kind" checked={kind === k} onChange={() => setKind(k)} />
              {t(k === "email" ? "circle.invite.kind.email" : "circle.invite.kind.phone", locale)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1">
        <Label htmlFor="invite-contact">{t("circle.invite.contact", locale)}</Label>
        <Input id="invite-contact" type={kind === "email" ? "email" : "tel"} inputMode={kind === "email" ? "email" : "tel"} autoComplete="off" value={contact} onChange={(e) => setContact(e.target.value)} className={TOUCH} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="invite-relationship">{t("circle.invite.relationship", locale)}</Label>
        <Input id="invite-relationship" maxLength={40} value={relationship} onChange={(e) => setRelationship(e.target.value)} className={TOUCH} />
      </div>
      <PermissionBoxes id="invite" value={perms} onChange={setPerms} locale={locale} />
      <div className="space-y-1">
        <Label htmlFor="invite-days">{t("circle.invite.days", locale)}</Label>
        <select id="invite-days" className={`w-full rounded-md border bg-transparent px-3 ${TOUCH}`} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {GRANT_DAY_CHOICES.map((d) => (
            <option key={d} value={d}>{t("circle.invite.days.option", locale, { days: d })}</option>
          ))}
        </select>
      </div>
      <Button type="submit" className={TOUCH} disabled={create.isPending || perms.length === 0 || contact.trim() === "" || relationship.trim() === ""}>
        {t("circle.invite.create", locale)}
      </Button>
      <FormError id="invite-error" message={errorKey ? t(errorKey, locale) : null} />
    </form>
  );
}

/** `origin` is passed by a test; the app uses the browser's own. */
export function CareCircleManager({ locale, origin }: { locale: Locale; origin?: string }) {
  const circle = useMyCircle();
  const log = useCircleViewLog();
  const cancel = useCancelInvite();
  const base = origin ?? (typeof window === "undefined" ? "" : window.location.origin);
  const members = circle.data?.members ?? [];
  const invites = circle.data?.invites ?? [];

  return (
    <div className="space-y-6">
      <p className={MUTED}>{t("circle.intro", locale)}</p>

      <Card>
        <CardHeader><CardTitle>{t("circle.members.title", locale)}</CardTitle></CardHeader>
        <CardContent>
          {circle.isSuccess && members.length === 0 ? <p className={MUTED}>{t("circle.members.empty", locale)}</p> : null}
          <ul className="divide-y">{members.map((m) => <MemberRow key={m.member_id} member={m} locale={locale} />)}</ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("circle.invites.title", locale)}</CardTitle></CardHeader>
        <CardContent>
          {circle.isSuccess && invites.length === 0 ? <p className={MUTED}>{t("circle.invites.empty", locale)}</p> : null}
          <ul className="divide-y">
            {invites.map((i) => (
              <li key={i.invite_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{i.hint} <span className={`text-sm font-normal ${MUTED}`}>({i.relationship})</span></p>
                  <p className={`text-sm ${MUTED}`}>{t("circle.invite.expires", locale, { date: formatPatientDateTime(i.expires_at) })}</p>
                </div>
                <Button type="button" variant="outline" className={TOUCH} disabled={cancel.isPending} onClick={() => cancel.mutate(i.invite_id)}>
                  {t("circle.invite.cancel", locale)}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("circle.invite.new", locale)}</CardTitle></CardHeader>
        <CardContent><InviteForm locale={locale} origin={base} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("circle.log.title", locale)}</CardTitle></CardHeader>
        <CardContent>
          {log.isSuccess && (log.data?.length ?? 0) === 0 ? <p className={MUTED}>{t("circle.log.empty", locale)}</p> : null}
          <ul className="space-y-1">
            {(log.data ?? []).map((row) => (
              <li key={`${row.viewer}-${row.at}`}>{t("circle.log.line", locale, { name: row.viewer, date: formatPatientDateTime(row.at) })}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
