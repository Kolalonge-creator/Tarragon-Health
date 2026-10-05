/**
 * The company details printed on the letterhead (public.invoice_letterhead_details, the same source as invoices). A failed
 * or empty read degrades to the TarragonHealth name alone; it never blocks the prescription.
 */
export interface Letterhead {
  tradingName: string;
  legalName: string | null;
  rcNumber: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
}

export const DEFAULT_LETTERHEAD: Letterhead = {
  tradingName: "TarragonHealth",
  legalName: null,
  rcNumber: null,
  address: null,
  email: null,
  phone: null,
};

