import { t, circleToolsCanKey, circleToolsSeesKey, type Locale } from "@tarragon/i18n";
import { previewForPermissions } from "@tarragon/shared";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

/**
 * The plain-language promise (S69b): exactly what a person will see and be able to do, built from the real permission list so it can
 * never say more than the database will show. Used before an invite is sent (the patient) and before it is accepted (the invitee).
 * `audience` only changes the wording ("they" or "you"); the lines are the same.
 */
export function PermissionSummary({
  permissions,
  audience,
  name,
  crossOrganisation = false,
  headingLevel = "h3",
}: {
  permissions: readonly string[];
  audience: "sender" | "invitee";
  /** The other person's first name, used in the line about who can stop sharing. */
  name?: string;
  crossOrganisation?: boolean;
  headingLevel?: "h3" | "h4";
}) {
  const locale: Locale = "en";
  const p = previewForPermissions(permissions);
  const Heading = headingLevel;
  const invitee = audience === "invitee";
  const empty = p.sees.length === 0 && p.can.length === 0;
  return (
    <section aria-label={t(invitee ? "cctools.preview.title.invitee" : "cctools.preview.title.sender", locale)} className="space-y-3 rounded-lg border p-4" data-testid="permission-summary">
      <Heading className="font-medium">{t(invitee ? "cctools.preview.title.invitee" : "cctools.preview.title.sender", locale)}</Heading>
      {empty ? <p className={`text-sm ${MUTED}`}>{t("cctools.preview.none", locale)}</p> : null}
      {p.sees.length > 0 ? (
        <div>
          <p className="text-sm font-medium">{t(invitee ? "cctools.preview.sees.invitee" : "cctools.preview.sees", locale)}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {p.sees.map((c) => <li key={c}>{t(circleToolsSeesKey(c), locale)}</li>)}
          </ul>
        </div>
      ) : null}
      {p.can.length > 0 ? (
        <div>
          <p className="text-sm font-medium">{t(invitee ? "cctools.preview.can.invitee" : "cctools.preview.can", locale)}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {p.can.map((c) => <li key={c}>{t(circleToolsCanKey(c), locale)}</li>)}
          </ul>
        </div>
      ) : null}
      {empty ? null : <p className="text-sm">{t("cctools.preview.never", locale)}</p>}
      {invitee && crossOrganisation ? <p className="text-sm">{t("cctools.preview.cross_org", locale)}</p> : null}
      <p className={`text-sm ${MUTED}`}>
        {invitee ? t("cctools.preview.control.invitee", locale, { name: name ?? "They" }) : t("cctools.preview.control.sender", locale)}
      </p>
    </section>
  );
}
