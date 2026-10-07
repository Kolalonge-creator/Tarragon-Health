import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { loadFigures, loadProgrammes, type FiguresLoad, type ProgrammesLoad, type Programme } from "@/lib/sponsor-figures";
import { space } from "@/ui/design";
import { AppText, Button, Card, EmptyState, Screen, Skeleton, SkeletonGroup } from "@/ui/kit";

/**
 * What a sponsor's own staff see (S38f). Their programmes, and for each the group figures written after each month closed. No member, no
 * name, no list; a group too small to show is said to be withheld. Nothing on this screen can be refreshed into a different answer: the
 * figure for a month is written once.
 */
export function SponsorHome({ onSignOut }: { onSignOut: () => void }) {
  const [list, setList] = useState<ProgrammesLoad | null>(null);
  const [open, setOpen] = useState<Programme | null>(null);
  const [figures, setFigures] = useState<FiguresLoad | null>(null);

  const loadList = useCallback(async () => {
    setList(null);
    setList(await loadProgrammes());
  }, []);
  useEffect(() => void loadList(), [loadList]);

  const show = useCallback(async (p: Programme) => {
    setOpen(p);
    setFigures(null);
    setFigures(await loadFigures(p.id));
  }, []);

  if (open) {
    return (
      <Screen>
        <Button title="Back to programmes" onPress={() => setOpen(null)} variant="secondary" />
        <AppText variant="headline" heading>
          {open.name}
        </AppText>
        {figures === null ? (
          <SkeletonGroup label="Loading figures">
            <Skeleton width="100%" height={160} />
          </SkeletonGroup>
        ) : !figures.ok ? (
          <Card style={{ gap: space.md }}>
            <AppText variant="body">The figures could not be loaded. Try again.</AppText>
            <Button title="Try again" onPress={() => void show(open)} variant="secondary" />
          </Card>
        ) : figures.months.length === 0 ? (
          <EmptyState icon="heart" title="No figures yet" body="A figure is written once a month, a few days after the month ends. The first one will appear here." />
        ) : (
          figures.months.map((m, i) => (
            <Card key={m.period} style={{ gap: space.sm }}>
              <AppText variant="title" heading>
                {m.label}
              </AppText>
              {m.lines.map((l) => (
                <View key={l.label} style={{ gap: 2 }}>
                  <AppText variant="body" tone="textMuted">
                    {l.label}
                  </AppText>
                  <AppText variant="body">{l.value}</AppText>
                </View>
              ))}
              {i === 0 && m.note ? (
                <AppText variant="body" tone="textMuted">
                  {m.note}
                </AppText>
              ) : null}
            </Card>
          ))
        )}
      </Screen>
    );
  }

  return (
    <Screen>
      <AppText variant="headline" heading>
        {list?.ok ? list.sponsor : "Programmes"}
      </AppText>
      {list === null ? (
        <SkeletonGroup label="Loading programmes">
          <Skeleton width="100%" height={96} />
        </SkeletonGroup>
      ) : !list.ok ? (
        <Card style={{ gap: space.md }}>
          <AppText variant="body">Your programmes could not be loaded. Try again.</AppText>
          <Button title="Try again" onPress={() => void loadList()} variant="secondary" />
        </Card>
      ) : list.programmes.length === 0 ? (
        <EmptyState icon="heart" title="No programmes yet" body="When Tarragon sets up a programme for you, it will appear here with its sign-up code." />
      ) : (
        list.programmes.map((p) => (
          <Card key={p.id} style={{ gap: space.sm }}>
            <AppText variant="title" heading>
              {p.name}
            </AppText>
            <AppText variant="body" tone="textMuted">
              {p.status === "active" ? `Open until ${p.validTo}` : "Closed"}
            </AppText>
            {p.code ? <AppText variant="body">{`Sign-up code: ${p.code}`}</AppText> : null}
            <Button title="See group figures" onPress={() => void show(p)} />
          </Card>
        ))
      )}
      <Button title="Sign out" onPress={onSignOut} variant="secondary" />
    </Screen>
  );
}
