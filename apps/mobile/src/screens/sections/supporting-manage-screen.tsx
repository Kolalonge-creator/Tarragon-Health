import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { koboToNaira } from "@tarragon/shared";
import {
  loadSupportedPeopleFinance,
  type SupportedPersonFinance,
  type SupportedPersonVoucher,
} from "@/lib/supporting-finance";
import { loadSponsorCareReport, type SponsorCareReport } from "@/lib/sponsor-care-report";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, radius, spacing } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, SecondaryButton, SectionLabel } from "@/ui/components";

function naira(kobo: number): string {
  return `₦${koboToNaira(kobo).toLocaleString("en-NG")}`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

/**
 * The "what you've funded" half of "People you support" — native replacement
 * for the WebView modal that used to embed /patient/supporting wholesale
 * inside supporting-screen.tsx. Mirrors
 * apps/web/src/app/(dashboard)/patient/supporting/supported-people.tsx's
 * voucher/funding summary (useSupportedPeople in
 * apps/web/src/lib/queries/sponsorship.ts) — read-only, same RLS-scoped
 * query direction as acting.ts's loadPeopleISupport (`grantee_user_id = me`).
 *
 * Deliberately NOT ported natively, and left as a system-browser hand-off to
 * the real web page instead (never an embedded WebView — see the button at
 * the bottom):
 *   - Every payment action (pay a bill on your own card, pay for someone's
 *     plan, split a bill with them, redeem a voucher against a bill) —
 *     these end in a Paystack hosted-checkout redirect
 *     (initiateSponsorBillCheckout / initiateSponsoredSubscriptionCheckout /
 *     initiateSubsidizedCheckout), which needs a real browser page to
 *     complete card entry; rebuilding that natively is a Paystack mobile SDK
 *     integration project of its own, not a one-pass port.
 *   - Booking a check, arranging a refill, and "help fill in their details"
 *     — moderate-complexity mutations that aren't access-graph/consent
 *     writes (so the safety pressure to port them natively is lower), bundled
 *     with the payment flows above under the same "open the real page"
 *     button rather than duplicated as three separate native forms.
 *   - The three-way conversation thread with their care team
 *     (SupporterConversation) and the clinical "how they are doing" summary
 *     (HealthSummary/CareTeamStatus) — both read from `person.categories`,
 *     the same category-scoped consent this file does not fetch; porting
 *     them would mean re-deriving access-graph state a second time in a
 *     screen whose whole point is money, not clinical data.
 * "Open their account" reuses the existing acting.ts mechanism unchanged —
 * supporting-screen.tsx already renders that control for the same list of
 * people, so it is not duplicated here.
 */
export function SupportingManageScreen({ userId }: { userId: string }) {
  const [people, setPeople] = useState<SupportedPersonFinance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await loadSupportedPeopleFinance(userId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setPeople(result.data);
  }, [userId]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const totalReady = people.reduce((sum, p) => sum + p.readyVouchers.length, 0);
  const totalUsed = people.reduce((sum, p) => sum + p.usedVouchers.length, 0);
  const totalFunded = people.reduce((sum, p) => sum + p.fundedKobo, 0);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
      <View>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>What you&apos;ve funded</Text>
        <MutedText>
          Money you&apos;ve put toward someone else&apos;s care, and what it actually paid for. Every person here
          keeps their own account and their own plan.
        </MutedText>
      </View>

      {loading && <ActivityIndicator color={colors.brand} />}
      {error && <ErrorText>{error}</ErrorText>}

      {!loading && !error && people.length === 0 && (
        <Card style={{ gap: 6 }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>You are not supporting anyone yet</Text>
          <MutedText>
            Once someone accepts a request to let you help manage their care, they appear here and you can fund
            their care directly.
          </MutedText>
        </Card>
      )}

      {people.length > 0 && (
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 18 }}>
            <View>
              <Text style={{ fontSize: 22, fontWeight: "700", color: colors.ink }}>{people.length}</Text>
              <MutedText>{people.length === 1 ? "person you support" : "people you support"}</MutedText>
            </View>
            <View>
              <Text style={{ fontSize: 22, fontWeight: "700", color: colors.brand }}>{totalUsed}</Text>
              <MutedText>
                {totalUsed === 1 ? "check has been used" : "checks have been used"}
                {totalFunded > 0 ? ` of ${naira(totalFunded)} paid` : ""}
              </MutedText>
            </View>
            <View>
              <Text style={{ fontSize: 22, fontWeight: "700", color: colors.ink }}>{totalReady}</Text>
              <MutedText>paid for and waiting to be used</MutedText>
            </View>
          </View>
        </Card>
      )}

      {people.map((person) => (
        <PersonFinanceCard key={person.profileId} person={person} />
      ))}

      <Card style={{ gap: 8 }}>
        <SectionLabel>Bills, plans and refills</SectionLabel>
        <MutedText>
          Paying a bill, funding someone&apos;s plan, splitting a bill with them, booking a check, arranging a
          refill, or messaging their care team all open the full patient app in your browser, signed in as you.
        </MutedText>
        <SecondaryButton
          title="Manage payments &amp; bills"
          onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/supporting`)}
        />
      </Card>
    </ScrollView>
  );
}

function VoucherRow({ voucher, trailing }: { voucher: SupportedPersonVoucher; trailing: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <Text style={{ fontSize: 13, color: colors.muted, flex: 1 }} numberOfLines={1}>
        {voucher.label}
        <Text style={{ color: colors.faint }}> · {voucher.voucherNumber}</Text>
      </Text>
      {trailing}
    </View>
  );
}

/**
 * The activity half of "what your money paid for" — mirrors
 * apps/web/src/components/sponsor-care-report.tsx's SponsorCareReport.
 * Payment facts already render above from loadSupportedPeopleFinance; this
 * adds the part that component alone can't show — how it's going, and only
 * as far as the patient has chosen to share. Fetched per-card rather than
 * batched with the voucher load above because it's a separate RPC
 * (sponsor_care_report) keyed by beneficiary, not a table read.
 */
function SponsorActivitySection({ beneficiaryId }: { beneficiaryId: string }) {
  const [report, setReport] = useState<SponsorCareReport | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSponsorCareReport(beneficiaryId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(true);
        return;
      }
      setReport(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [beneficiaryId]);

  if (error || !report) return null;

  if (report.sharing_level === "none") {
    return (
      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
        <MutedText>{report.note}</MutedText>
      </View>
    );
  }

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, gap: 4 }}>
      <Text style={{ fontSize: 12, fontWeight: "700", color: colors.ink }}>How it is going, in the last 30 days</Text>
      <MutedText>
        {report.readings_logged
          ? `${report.readings_logged} reading${report.readings_logged === 1 ? "" : "s"} logged.`
          : "No readings logged yet this month."}
      </MutedText>
      {report.last_clinical_review ? <MutedText>A doctor reviewed their readings on {shortDate(report.last_clinical_review)}.</MutedText> : null}
      {report.next_check_due ? <MutedText>Their next check is due {shortDate(report.next_check_due)}.</MutedText> : null}
      {report.monitoring_active_until ? <MutedText>Watched until {shortDate(report.monitoring_active_until)}.</MutedText> : null}
      <MutedText>{report.note}</MutedText>
    </View>
  );
}

function PersonFinanceCard({ person }: { person: SupportedPersonFinance }) {
  const name = person.fullName ?? "This person";

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink, flexShrink: 1 }}>{name}</Text>
        <Badge tone={person.permissionLevel === "manage" ? "brand" : "neutral"}>
          {person.permissionLevel === "manage" ? "You can act for them" : "You can follow"}
        </Badge>
        {person.isDependentAccount ? <Badge tone="neutral">Child</Badge> : null}
      </View>

      <MutedText>
        {person.lastFundedAt ? `You last bought care for them ${shortDate(person.lastFundedAt)}.` : "You have not bought anything for them yet."}{" "}
        {person.usedVouchers.length > 0
          ? `${person.usedVouchers.length} of what you bought has been used.`
          : "Nothing has been used yet."}
      </MutedText>

      {person.readyVouchers.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: colors.ink }}>
            Paid for and waiting ({person.readyVouchers.length})
          </Text>
          {person.readyVouchers.map((v) => (
            <VoucherRow key={v.id} voucher={v} trailing={<Badge tone="brand">Ready</Badge>} />
          ))}
        </View>
      )}

      {person.savingVouchers.map((v) => {
        const pct = v.faceValueKobo > 0 ? Math.min(100, Math.round((v.amountPaidKobo / v.faceValueKobo) * 100)) : 0;
        return (
          <View key={v.id} style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 11.5, color: colors.muted }}>Still paying for {v.label}</Text>
              <Text style={{ fontSize: 11.5, color: colors.muted }}>
                {naira(v.amountPaidKobo)} of {naira(v.faceValueKobo)}
              </Text>
            </View>
            <View style={{ height: 6, borderRadius: 999, backgroundColor: colors.groupBg, overflow: "hidden" }}>
              <View style={{ height: "100%", width: `${pct}%`, borderRadius: 999, backgroundColor: colors.brand }} />
            </View>
          </View>
        );
      })}

      {person.usedVouchers.length > 0 && (
        <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: colors.ink }}>What it has paid for</Text>
          {person.usedVouchers.map((v) => (
            <VoucherRow
              key={v.id}
              voucher={v}
              trailing={
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.ink }}>{naira(v.faceValueKobo)}</Text>
                  {v.redeemedAt && <Text style={{ fontSize: 10.5, color: colors.faint }}>{shortDate(v.redeemedAt)}</Text>}
                </View>
              }
            />
          ))}
        </View>
      )}

      {person.readyVouchers.length === 0 && person.savingVouchers.length === 0 && person.usedVouchers.length === 0 && (
        <MutedText>No vouchers yet.</MutedText>
      )}

      <SponsorActivitySection beneficiaryId={person.profileId} />

      <Pressable
        accessibilityRole="button"
        onPress={() =>
          void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/supporting`)
        }
        style={({ pressed }) => ({
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.control,
          paddingVertical: 10,
          alignItems: "center",
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.brand }}>
          Pay a bill or fund their plan for {name.trim().split(/\s+/)[0] || "them"}
        </Text>
      </Pressable>
    </Card>
  );
}
