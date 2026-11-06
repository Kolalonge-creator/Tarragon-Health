import { useCallback, useEffect, useState } from "react";
import { Linking, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import {
  directionsUrl,
  findPlaces,
  findTests,
  getImagingRequestPrintUrl,
  getOpenImagingRequests,
  loadBranchProfile,
  openSuggestedPlace,
  type BranchProfile,
  type DirectoryRead,
  type ImagingRequestItem,
  type PlaceRow,
  type SuggestedPlace,
  type TestMatch,
} from "@/lib/diagnostic-directory";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton, SectionLabel } from "@/ui/legacy-kit";
import { Chip, Field } from "@/ui/kit";
import { AppText } from "@/ui/kit/AppText";

/**
 * Diagnostic directory Phases 5 and 6 on the phone, mirroring the web patient screens:
 *  - SuggestedPlaceButton: the place a doctor suggested for one lab or imaging request. Opening it records the first view.
 *  - ImagingRequestsSection: open imaging requests, each with its printable request and suggested place.
 *  - DiagnosticSearchSection: find the exact test, then branches that do it in a state and LGA, with each branch's details.
 * The partner label is a plain outlined chip with its commercial explanation one tap away (DIR-1), and every place card says the
 * patient may go anywhere. Copy is the shared dxsearch.* text, so web and phone say the same thing.
 */

function useT() {
  const locale = asLocale(useUiLanguage());
  return (key: Parameters<typeof t>[0], vars?: Record<string, string | number>) => t(key, locale, vars);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
}

function open(url: string) {
  Linking.openURL(url).catch(() => {});
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  return <AppText variant="label" tone="brandText" onPress={onPress} accessibilityRole="link">{label}</AppText>;
}

function PartnerLabel() {
  const tr = useT();
  const [shown, setShown] = useState(false);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ alignSelf: "flex-start", borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, opacity: 0.85 }}>
        <AppText variant="caption" onPress={() => setShown((s) => !s)} accessibilityRole="button">{tr("dxsearch.partner.badge")}</AppText>
      </View>
      {shown ? <MutedText>{tr("dxsearch.partner.explainer")}</MutedText> : null}
    </View>
  );
}

function placeLine(parts: (string | null)[]): string {
  return parts.filter(Boolean).join(", ");
}

// ---- Phase 5 -------------------------------------------------------------------------------------------------------------

export function SuggestedPlaceButton({ kind, orderId }: { kind: "lab" | "imaging"; orderId: string }) {
  const tr = useT();
  const [read, setRead] = useState<DirectoryRead<SuggestedPlace | null> | null>(null);
  const [shown, setShown] = useState(false);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (shown) return setShown(false);
    setShown(true);
    if (read && read.ok) return;
    setLoading(true);
    setRead(await openSuggestedPlace(kind, orderId));
    setLoading(false);
  }

  return (
    <View style={{ gap: 6 }}>
      <Link label={shown ? tr("dxsearch.place.hide") : tr("dxsearch.place.open")} onPress={toggle} />
      {shown ? (
        loading || !read ? (
          <MutedText>{tr("dxsearch.place.loading")}</MutedText>
        ) : !read.ok ? (
          <ErrorText>{tr("dxsearch.place.error")}</ErrorText>
        ) : !read.data ? (
          <MutedText>{tr("dxsearch.place.none")}</MutedText>
        ) : (
          <PlaceCard place={read.data} />
        )
      ) : null}
    </View>
  );
}

function PlaceCard({ place }: { place: SuggestedPlace }) {
  const tr = useT();
  const maps = directionsUrl(place.latitude, place.longitude);
  return (
    <View style={{ gap: 4, borderWidth: 1, borderRadius: 10, padding: 10, borderColor: "rgba(0,0,0,0.1)" }}>
      <MutedText>
        {place.suggestedBy
          ? tr("dxsearch.place.title", { name: place.suggestedBy, date: formatDate(place.suggestedAt) })
          : tr("dxsearch.place.title_team", { date: formatDate(place.suggestedAt) })}
      </MutedText>
      <AppText variant="bodyStrong">{place.providerName}: {place.branchName}</AppText>
      {place.isPartner ? <PartnerLabel /> : null}
      <MutedText>{placeLine([place.address, place.town, place.lga, place.state])}</MutedText>
      {place.phone ? <Link label={place.phone} onPress={() => open(`tel:${place.phone}`)} /> : null}
      {maps ? <Link label={tr("dxsearch.place.directions")} onPress={() => open(maps)} /> : null}
      <MutedText>{tr("dxsearch.place.for", { test: place.test })}</MutedText>
      {place.appointmentRequired ? <MutedText>{tr("dxsearch.place.call_first")}</MutedText> : null}
      {place.preparationNote ? <MutedText>{tr("dxsearch.place.prep", { note: place.preparationNote })}</MutedText> : null}
      {!place.stillRecommendable ? <ErrorText>{tr("dxsearch.place.no_longer")}</ErrorText> : null}
      <MutedText>{tr("dxsearch.place.free_choice")}</MutedText>
    </View>
  );
}

export function ImagingRequestsSection({ patientId, refreshKey }: { patientId: string; refreshKey: number }) {
  const [read, setRead] = useState<DirectoryRead<ImagingRequestItem[]> | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOpenImagingRequests(patientId).then((r) => { if (!cancelled) setRead(r); });
    return () => { cancelled = true; };
  }, [patientId, refreshKey]);

  const print = useCallback(async (id: string) => {
    setPrintError(null);
    const url = await getImagingRequestPrintUrl(id);
    if (!url.ok) return setPrintError("Could not open your imaging request. Please sign in again and retry.");
    await WebBrowser.openBrowserAsync(url.data);
  }, []);

  if (!read) return null;
  if (!read.ok) {
    return (
      <View style={{ gap: 10 }}>
        <SectionLabel>Your imaging requests</SectionLabel>
        <Card><ErrorText>Could not load your imaging requests.</ErrorText></Card>
      </View>
    );
  }
  if (read.data.length === 0) return null;
  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>Your imaging requests</SectionLabel>
      {read.data.map((o) => (
        <Card key={o.id} style={{ gap: 6 }}>
          <AppText variant="bodyStrong">{o.studyName}</AppText>
          <MutedText>Requested {formatDate(o.createdAt)}{o.urgency !== "routine" ? ` · ${o.urgency}` : ""}</MutedText>
          <SecondaryButton title="Open your imaging request" onPress={() => print(o.id)} />
          <SuggestedPlaceButton kind="imaging" orderId={o.id} />
        </Card>
      ))}
      {printError ? <ErrorText>{printError}</ErrorText> : null}
    </View>
  );
}

// ---- Phase 6 -------------------------------------------------------------------------------------------------------------

export function DiagnosticSearchSection({ defaultState, defaultLga }: { defaultState: string | null; defaultLga: string | null }) {
  const tr = useT();
  const [text, setText] = useState("");
  const [tests, setTests] = useState<DirectoryRead<{ matches: TestMatch[]; clarifying: string | null }> | null>(null);
  const [test, setTest] = useState<TestMatch | null>(null);
  const [state, setState] = useState(defaultState ?? "");
  const [lga, setLga] = useState(defaultLga ?? "");
  const [result, setResult] = useState<DirectoryRead<{ rows: PlaceRow[]; total: number | null }> | null>(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);


  async function searchTest() {
    setBusy(true);
    setTest(null);
    setResult(null);
    setTests(await findTests(text));
    setBusy(false);
  }

  async function searchPlaces(nextPage: number) {
    if (!test) return;
    setBusy(true);
    const r = await findPlaces({ conceptId: test.conceptId, state, lga, page: nextPage });
    setPage(nextPage);
    setResult((prev) =>
      nextPage > 0 && prev?.ok && r.ok ? { ok: true, data: { rows: [...prev.data.rows, ...r.data.rows], total: r.data.total ?? prev.data.total } } : r,
    );
    setBusy(false);
  }

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>{tr("dxsearch.find.title")}</SectionLabel>
      <Card style={{ gap: 10 }}>
        <MutedText>{tr("dxsearch.find.intro")}</MutedText>
        <Field label={tr("dxsearch.find.test")} placeholder={tr("dxsearch.find.test_placeholder")} value={text} onChangeText={setText}
          returnKeyType="search" onSubmitEditing={() => { if (text.trim().length >= 2) searchTest(); }} />
        <PrimaryButton title={tr("dxsearch.find.search_test")} onPress={searchTest} disabled={busy || text.trim().length < 2} />

        {tests && !tests.ok ? <ErrorText>{tr("dxsearch.find.error")}</ErrorText> : null}
        {tests && tests.ok && tests.data.matches.length === 0 ? <MutedText>{tr("dxsearch.find.no_test")}</MutedText> : null}
        {tests && tests.ok && tests.data.matches.length > 0 && !test ? (
          <View style={{ gap: 6 }}>
            {tests.data.clarifying ? <AppText variant="body">{tr("dxsearch.find.which_one", { group: tests.data.clarifying })}</AppText> : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {tests.data.matches.map((m) => (
                <Chip key={m.conceptId} label={m.display} selected={false} onPress={() => { setTest(m); setResult(null); }} />
              ))}
            </View>
          </View>
        ) : null}

        {test ? (
          <View style={{ gap: 8 }}>
            <AppText variant="bodyStrong">{test.display}</AppText>
            {test.description ? <MutedText>{test.description}</MutedText> : null}
            <AppText variant="body">{tr("dxsearch.find.where")}</AppText>
            <Field label={tr("dxsearch.find.state")} value={state} onChangeText={setState} autoCapitalize="words" />
            <Field label={tr("dxsearch.find.lga")} value={lga} onChangeText={setLga} autoCapitalize="words" />
            <PrimaryButton title={tr("dxsearch.find.search_places")} onPress={() => searchPlaces(0)} disabled={busy || state.trim().length < 2} />
            <Link label={tr("dxsearch.find.change_test")} onPress={() => { setTest(null); setResult(null); }} />
          </View>
        ) : null}

        {result ? <Results result={result} test={test} busy={busy} onMore={() => searchPlaces(page + 1)} /> : null}
        <MutedText>{tr("dxsearch.verified.explainer")}</MutedText>
      </Card>
    </View>
  );
}

function Results({ result, test, busy, onMore }: {
  result: DirectoryRead<{ rows: PlaceRow[]; total: number | null }>; test: TestMatch | null; busy: boolean; onMore: () => void;
}) {
  const tr = useT();
  if (!result.ok) return <ErrorText>{tr(result.reason === "closed" ? "dxsearch.find.closed" : "dxsearch.find.error")}</ErrorText>;
  const { rows, total } = result.data;
  if (rows.length === 0) return <MutedText>{tr("dxsearch.find.none")}</MutedText>;
  const recommended = rows.filter((r) => r.resultGroup !== "unconfirmed");
  const unconfirmed = rows.filter((r) => r.resultGroup === "unconfirmed");
  const hasPartner = rows.some((r) => r.isPartner);
  return (
    <View style={{ gap: 8 }}>
      {test ? <AppText variant="bodyStrong">{tr("dxsearch.find.for_test", { test: test.display })}</AppText> : null}
      {recommended.map((r) => <PlaceResult key={r.serviceId} r={r} />)}
      {unconfirmed.length > 0 ? (
        <>
          <AppText variant="label" tone="textSubtle">{tr("dxsearch.find.unconfirmed_group")}</AppText>
          {unconfirmed.map((r) => <PlaceResult key={r.serviceId} r={r} />)}
        </>
      ) : null}
      {hasPartner ? (
        <View style={{ gap: 2 }}>
          <AppText variant="label">{tr("dxsearch.partner.explainer_title")}</AppText>
          <MutedText>{tr("dxsearch.partner.explainer")}</MutedText>
        </View>
      ) : null}
      {total !== null && rows.length < total ? <SecondaryButton title={tr("dxsearch.find.more")} onPress={onMore} disabled={busy} /> : null}
    </View>
  );
}

function PlaceResult({ r }: { r: PlaceRow }) {
  const tr = useT();
  const [details, setDetails] = useState(false);
  return (
    <View style={{ gap: 4, borderWidth: 1, borderRadius: 10, padding: 10, borderColor: "rgba(0,0,0,0.1)" }}>
      <AppText variant="bodyStrong">{r.providerName}: {r.branchName}</AppText>
      {r.isPartner ? <PartnerLabel /> : null}
      <MutedText>{placeLine([r.address, r.neighbourhood, r.town, r.lga, r.state])}</MutedText>
      {r.resultGroup === "unconfirmed" ? <ErrorText>{tr("dxsearch.find.unconfirmed")}</ErrorText> : null}
      {r.byAppointment ? <MutedText>{tr("dxsearch.find.by_appointment")}</MutedText> : null}
      {r.performedElsewhere ? <MutedText>{tr("dxsearch.find.sent_elsewhere")}</MutedText> : null}
      {r.preparationNote ? <MutedText>{tr("dxsearch.place.prep", { note: r.preparationNote })}</MutedText> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
        <Link label={r.phone} onPress={() => open(`tel:${r.phone}`)} />
        <Link label={tr("dxsearch.place.directions")} onPress={() => open(directionsUrl(r.latitude, r.longitude) ?? "")} />
        <Link label={details ? tr("dxsearch.place.hide") : tr("dxsearch.find.details")} onPress={() => setDetails((d) => !d)} />
      </View>
      {details ? <BranchDetails branchListingId={r.branchListingId} /> : null}
    </View>
  );
}

/** Phase 6 branch profile, opened inline under a search result (the labs screen is already a sheet, so no second modal). */
export function BranchDetails({ branchListingId }: { branchListingId: string }) {
  const tr = useT();
  const [read, setRead] = useState<DirectoryRead<BranchProfile | null> | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadBranchProfile(branchListingId).then((r) => { if (!cancelled) setRead(r); });
    return () => { cancelled = true; };
  }, [branchListingId]);

  if (!read) return <MutedText>{tr("dxsearch.place.loading")}</MutedText>;
  if (!read.ok) return <ErrorText>{tr(read.reason === "closed" ? "dxsearch.find.closed" : "dxsearch.find.error")}</ErrorText>;
  if (!read.data) return <MutedText>{tr("dxsearch.branch.not_found")}</MutedText>;
  const p = read.data;
  return (
    <View style={{ gap: 6, marginTop: 6 }}>
      <AppText variant="label">{tr("dxsearch.branch.contact")}</AppText>
      {p.email ? <Link label={p.email} onPress={() => open(`mailto:${p.email}`)} /> : null}
      {p.website ? <Link label={p.website} onPress={() => WebBrowser.openBrowserAsync(p.website as string)} /> : null}
      {p.locationCheckedOn ? <MutedText>{tr("dxsearch.branch.checked", { date: formatDate(p.locationCheckedOn) })}</MutedText> : null}
      <MutedText>{tr("dxsearch.branch.prices")}</MutedText>
      <AppText variant="label">{tr("dxsearch.branch.tests")}</AppText>
      {p.services.length === 0 ? (
        <MutedText>{tr("dxsearch.branch.no_tests")}</MutedText>
      ) : (
        p.services.map((s) => (
          <View key={s.conceptId} style={{ gap: 2 }}>
            <AppText variant="body">{s.test}</AppText>
            {s.byAppointment ? <MutedText>{tr("dxsearch.find.by_appointment")}</MutedText> : null}
            {s.performedElsewhere ? <MutedText>{tr("dxsearch.find.sent_elsewhere")}</MutedText> : null}
            {s.preparationNote ? <MutedText>{tr("dxsearch.place.prep", { note: s.preparationNote })}</MutedText> : null}
          </View>
        ))
      )}
    </View>
  );
}
