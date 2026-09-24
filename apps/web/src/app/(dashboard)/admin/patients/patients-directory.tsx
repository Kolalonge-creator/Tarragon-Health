"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { ageFromDateOfBirth, koboToNaira } from "@tarragon/shared";
import { formatPatientDateTime } from "@/lib/format-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SearchableList } from "@/components/ui/searchable-list";
import { downloadCsv } from "@/lib/analytics/download-csv";
import type { CsvRow } from "@/lib/analytics/to-csv";
import { logPatientDirectoryExport } from "./actions";
import { PlatformCreditPanel } from "./platform-credit-panel";

export type PatientPurchase = {
  label: string;
  amountKobo: number;
  status: string;
  purchasedAt: string | null;
};

export type PatientRow = {
  id: string;
  fullName: string | null;
  email: string | null;
  dateOfBirth: string | null;
  sex: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  patientNumber: string | null;
  organisationName: string | null;
  isActive: boolean;
  createdAt: string;
  /** Last login event (auth.users.last_sign_in_at) — "last visited the platform". */
  lastVisitAt: string | null;
  /** Last device heartbeat while a dashboard tab was open/visible — "last activity". */
  lastActiveAt: string | null;
  /** Count and total below only include purchases that were actually paid for (see page.tsx's PAID_STATUSES). */
  purchaseCount: number;
  totalSpentKobo: number;
  lastPurchaseAt: string | null;
  /** Full itemised history, every status included — shown in the row detail and the CSV export. */
  purchases: PatientPurchase[];
  platformCreditBalanceKobo: number;
  platformCreditPromoBalanceKobo: number;
};

function naira(kobo: number): string {
  return `₦${koboToNaira(kobo).toLocaleString("en-NG")}`;
}

function shortDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function shortDateTime(value: string | null): string {
  if (!value) return "—";
  return formatPatientDateTime(value);
}

const PURCHASE_STATUS_VARIANT: Record<string, "green" | "grey" | "red" | "amber" | "blue"> = {
  active: "green",
  completed: "green",
  expired: "grey",
  cancelled: "red",
  refunded: "amber",
  pending_payment: "blue",
};

export function PatientsDirectory({ rows }: { rows: PatientRow[] }) {
  const totalPatients = rows.length;
  const purchasers = rows.filter((r) => r.purchaseCount > 0).length;
  const totalRevenueKobo = rows.reduce((sum, r) => sum + r.totalSpentKobo, 0);

  function buildCsvRows(): CsvRow[] {
    return rows.map((r) => ({
      "Full name": r.fullName ?? "",
      Email: r.email ?? "",
      Age: ageFromDateOfBirth(r.dateOfBirth) ?? "",
      "Date of birth": r.dateOfBirth ?? "",
      Sex: r.sex ?? "",
      Phone: r.phone ?? "",
      City: r.city ?? "",
      State: r.state ?? "",
      "Patient number": r.patientNumber ?? "",
      Organisation: r.organisationName ?? "",
      Status: r.isActive ? "Active" : "Inactive",
      Joined: r.createdAt,
      "Last visited": r.lastVisitAt ?? "",
      "Last activity": r.lastActiveAt ?? "",
      "Purchases (paid)": r.purchaseCount,
      "Total spent (NGN)": koboToNaira(r.totalSpentKobo),
      "Last purchase": r.lastPurchaseAt ?? "",
      "Platform credit balance (NGN)": koboToNaira(r.platformCreditBalanceKobo),
      "Purchase history": r.purchases
        .map((p) => `${p.label} — ${naira(p.amountKobo)} (${p.status}, ${shortDate(p.purchasedAt)})`)
        .join(" | "),
    }));
  }

  async function handleExport() {
    // Fire-and-forget audit entry — the CSV leaves the browser either way,
    // this just records who pulled it and how many rows it covered.
    void logPatientDirectoryExport(rows.length);
    downloadCsv(`tarragon-patients-${new Date().toISOString().slice(0, 10)}.csv`, buildCsvRows());
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 py-4">
          <div>
            <p className="font-heading text-2xl font-semibold text-charcoal-ink">{totalPatients}</p>
            <p className="text-sm text-charcoal-ink/60">registered patients</p>
          </div>
          <div>
            <p className="font-heading text-2xl font-semibold text-brand-green">{purchasers}</p>
            <p className="text-sm text-charcoal-ink/60">have bought something</p>
          </div>
          <div>
            <p className="font-heading text-2xl font-semibold text-clinical-navy">{naira(totalRevenueKobo)}</p>
            <p className="text-sm text-charcoal-ink/60">total collected</p>
          </div>
          <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={handleExport} disabled={rows.length === 0}>
            <Download className="mr-1.5 h-4 w-4" strokeWidth={2} />
            Export CSV
          </Button>
        </CardContent>
      </Card>

      <SearchableList
        items={rows}
        pageSize={25}
        filterFn={(r, q) =>
          [r.fullName, r.email, r.phone, r.patientNumber, r.organisationName, r.city, r.state]
            .filter(Boolean)
            .some((field) => field!.toLowerCase().includes(q))
        }
        searchPlaceholder="Search by name, email, phone, or patient number…"
        noMatchMessage={(q) => `No patients match "${q}".`}
        emptyMessage="No patients registered yet."
        renderContainer={(children) => (
          <div className="overflow-x-auto rounded-md border border-charcoal-ink/10">
            <table className="w-full text-sm">
              <thead className="bg-charcoal-ink/5 text-left text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
                <tr>
                  <th className="px-3 py-2">Patient</th>
                  <th className="px-3 py-2">Contact</th>
                  <th className="px-3 py-2">Age / sex</th>
                  <th className="px-3 py-2">Joined</th>
                  <th className="px-3 py-2">Last visit / activity</th>
                  <th className="px-3 py-2">Purchases</th>
                  <th className="px-3 py-2">Platform credit</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-charcoal-ink/10">{children}</tbody>
            </table>
          </div>
        )}
        renderItem={(r) => <PatientTableRow key={r.id} row={r} />}
      />
    </div>
  );
}

function PatientTableRow({ row }: { row: PatientRow }) {
  const [expanded, setExpanded] = useState(false);
  const age = ageFromDateOfBirth(row.dateOfBirth);

  return (
    <>
      <tr className="align-top">
        <td className="px-3 py-2">
          <p className="font-medium text-charcoal-ink">{row.fullName ?? "Unnamed patient"}</p>
          <p className="text-xs text-charcoal-ink/50">
            {row.patientNumber ?? "No patient number"}
            {row.organisationName ? ` · ${row.organisationName}` : ""}
          </p>
          {!row.isActive && (
            <Badge variant="grey" className="mt-1">
              Inactive
            </Badge>
          )}
        </td>
        <td className="px-3 py-2">
          <p className="text-charcoal-ink/80">{row.email ?? "—"}</p>
          <p className="text-xs text-charcoal-ink/50">{row.phone ?? "—"}</p>
          <p className="text-xs text-charcoal-ink/50">
            {[row.city, row.state].filter(Boolean).join(", ") || "—"}
          </p>
        </td>
        <td className="px-3 py-2 text-charcoal-ink/80">
          {age !== null ? `${age}y` : "—"}
          {row.sex ? ` · ${row.sex}` : ""}
        </td>
        <td className="px-3 py-2 text-charcoal-ink/80">{shortDate(row.createdAt)}</td>
        <td className="px-3 py-2 text-charcoal-ink/80">
          <p>Visited {shortDateTime(row.lastVisitAt)}</p>
          <p className="text-xs text-charcoal-ink/50">Active {shortDateTime(row.lastActiveAt)}</p>
        </td>
        <td className="px-3 py-2 text-charcoal-ink/80">
          {row.purchaseCount === 0 ? (
            <span className="text-charcoal-ink/50">None yet</span>
          ) : (
            <>
              {row.purchaseCount} · {naira(row.totalSpentKobo)}
              <p className="text-xs text-charcoal-ink/50">last {shortDate(row.lastPurchaseAt)}</p>
            </>
          )}
        </td>
        <td className="px-3 py-2 text-charcoal-ink/80">
          {naira(row.platformCreditBalanceKobo)}
          {row.platformCreditPromoBalanceKobo > 0 && (
            <p className="text-xs text-charcoal-ink/50">incl. {naira(row.platformCreditPromoBalanceKobo)} promo</p>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          <Button type="button" size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Hide" : "Manage"}
          </Button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="space-y-3 bg-charcoal-ink/[0.03] px-3 py-3">
            {row.purchases.length > 0 && (
              <ul className="space-y-1">
                {row.purchases.map((p, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant={PURCHASE_STATUS_VARIANT[p.status] ?? "grey"}>{p.status}</Badge>
                    <span className="text-charcoal-ink/80">{p.label}</span>
                    <span className="text-charcoal-ink/50">
                      {naira(p.amountKobo)} · {shortDate(p.purchasedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <PlatformCreditPanel
              patientId={row.id}
              balanceKobo={row.platformCreditBalanceKobo}
              promoBalanceKobo={row.platformCreditPromoBalanceKobo}
            />
          </td>
        </tr>
      )}
    </>
  );
}
