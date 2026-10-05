import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface ProxySetupRow {
  id: string;
  target_full_name: string;
  state: "pending_confirmation" | "confirmed" | "expired" | "declined";
  expires_at: string;
}

/** The proxy's own requests. Name and state only: nothing about the parent's record is ever read here. */
export function ProxySetupList({ rows, locale }: { rows: ProxySetupRow[]; locale: Locale }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("proxy.setup.list.title", locale)}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between py-2 text-sm">
              <span>{row.target_full_name}</span>
              <span className="text-charcoal-ink/70">{t(`proxy.setup.state.${row.state}` as MessageKey, locale)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
