import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON } from "@/lib/icons";
import { AGE_BANDS, type AgeBandDistribution } from "@/lib/corporate/load-age-band-distribution";

export function AgeBandSummary({ distribution }: { distribution: AgeBandDistribution }) {
  if (!distribution) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.family className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Age segmentation
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {AGE_BANDS.map((band) => (
          <StatTile key={band} icon={SEMANTIC_ICON.family} label={band} value={String(distribution[band])} />
        ))}
      </CardContent>
    </Card>
  );
}
