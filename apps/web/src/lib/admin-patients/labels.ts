import { t, type Locale } from "@tarragon/i18n";
import type { LookupLabels } from "@/app/(dashboard)/admin/patients/patient-lookup";

export function lookupLabels(locale: Locale): LookupLabels {
  const k = (key: Parameters<typeof t>[0]) => t(key, locale);
  return {
    searchLabel: k("adminpatients.search.label"), searchHint: k("adminpatients.search.hint"), searchButton: k("adminpatients.search.button"),
    none: k("adminpatients.search.none"), more: k("adminpatients.search.more"),
    errQuery: k("adminpatients.err.query"), errReason: k("adminpatients.err.reason"), errNotFound: k("adminpatients.err.not_found"),
    errDenied: k("adminpatients.err.denied"), errFailed: k("adminpatients.err.failed"),
    open: k("adminpatients.row.open"), test: k("adminpatients.row.test"), inactive: k("adminpatients.row.inactive"), born: k("adminpatients.row.born"),
    reasonLabel: k("adminpatients.reason.label"), reasonHint: k("adminpatients.reason.hint"), reasonConfirm: k("adminpatients.reason.confirm"), reasonCancel: k("adminpatients.reason.cancel"),
    recordTitle: k("adminpatients.record.title"), audited: k("adminpatients.record.audited"), close: k("adminpatients.record.close"),
    purchases: k("adminpatients.record.purchases"), noPurchases: k("adminpatients.record.no_purchases"), total: k("adminpatients.record.total"),
  };
}
