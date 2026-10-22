import Link from "next/link";
import { t } from "@tarragon/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * "Who can see this" (UI-B change 5): three rows, one sentence of consequence each, a preview of what someone in the Care Circle would
 * see, and the limit stated. Only claims what is true on screen today: the rows are not switches because the care team summary cannot
 * be paused here yet (the wording says so), and the Care Circle row points to where access is actually given or taken away.
 */
const ROWS = [
  { id: "only_me", title: "uib.who.only_me.title", body: "uib.who.only_me.body" },
  { id: "care_team", title: "uib.who.care_team.title", body: "uib.who.care_team.body" },
  { id: "circle", title: "uib.who.circle.title", body: "uib.who.circle.body" },
] as const;

export function WhoCanSeeThis({ circleHref = "/patient/care-circle" }: { circleHref?: string }) {
  return (
    <Card aria-labelledby="who-can-see-title">
      <CardHeader>
        <CardTitle id="who-can-see-title" className="text-base">
          {t("uib.who.title")}
        </CardTitle>
        <CardDescription>{t("uib.who.intro")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-3">
          {ROWS.map((r) => (
            <li key={r.id} className="rounded-lg border p-3">
              <p className="font-medium">{t(r.title)}</p>
              <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t(r.body)}</p>
            </li>
          ))}
        </ul>
        <section aria-labelledby="who-preview-title" className="space-y-1 rounded-lg bg-muted/40 p-3">
          <h3 id="who-preview-title" className="text-sm font-medium">
            {t("uib.who.preview.title")}
          </h3>
          <p className="text-sm">{t("uib.who.preview.none")}</p>
          <p className="text-sm">{t("uib.who.preview.granted")}</p>
          <p className="text-sm">{t("uib.who.preview.notifications")}</p>
        </section>
        <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("uib.who.limit")}</p>
        <Link href={circleHref} className="inline-flex min-h-11 items-center text-sm font-medium underline">
          {t("uib.who.link")}
        </Link>
      </CardContent>
    </Card>
  );
}
