import type { ReactElement } from "react";

// @react-pdf/renderer ships ESM only, which this CJS ts-jest transform cannot
// load. The primitives are swapped for plain host-component tags so the
// document still builds a real React element tree — which is all these tests
// walk. Font registration is a side-effecting file read, so it is stubbed too.
jest.mock("@react-pdf/renderer", () => ({
  Document: "Document",
  Page: "Page",
  Text: "Text",
  View: "View",
  Image: "Image",
  StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock("@/lib/pdf/register-fonts", () => ({
  registerPdfFonts: () => undefined,
  PDF_FONT_FAMILY: "Helvetica",
}));

import {
  InvoiceDocument,
  type InvoiceBillTo,
  type InvoiceDocumentData,
  type InvoiceLetterhead,
} from "./invoice-document";

/**
 * Regression cover for a defect found 2026-09-22: `registered_address` was
 * declared on InvoiceLetterhead, selected by invoice_letterhead_details(),
 * and passed through the receipt route — but no part of the rendered document
 * ever read it, so the legal registered office could never appear on a patient
 * invoice no matter what an admin entered at /admin/settings/company-profile.
 *
 * The document is a @react-pdf/renderer tree, not DOM, so these tests walk the
 * returned element tree and collect its text rather than rendering a PDF.
 */

function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null || node === false) return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  const element = node as Partial<ReactElement<{ children?: unknown }>>;
  if (element.props && "children" in element.props) {
    collectText(element.props.children, out);
  }
  return out;
}

const invoice: InvoiceDocumentData = {
  invoice_number: "INV-2026-000123",
  service_type: "consultation",
  service_label: "Doctor consultation",
  reference: "PAY-REF-9001",
  total_minor: 1_500_000,
  subtotal_minor: 1_500_000,
  vat_minor: 0,
  vat_treatment: "exempt",
  vat_rate_pct: null,
  currency: "NGN",
  issued_at: "2026-09-22T09:00:00.000Z",
};

const billTo: InvoiceBillTo = {
  name: "Ada Obi",
  patientNumber: "TH-00042",
  phone: "+2348012345678",
};

const emptyLetterhead: InvoiceLetterhead = {
  legal_name: "Tarragon Health Limited",
  trading_name: null,
  rc_number: null,
  tin: null,
  vat_registration_number: null,
  registered_address: null,
  registered_email: null,
  registered_phone: null,
};

function renderText(letterhead: InvoiceLetterhead): string {
  return collectText(InvoiceDocument({ invoice, billTo, letterhead })).join("\n");
}

type FooterText = ReactElement<{
  children?: unknown;
  style?: {
    fontSize?: number;
    color?: string;
    lineHeight?: number;
    maxLines?: number;
    textOverflow?: string;
  };
}>;

/**
 * Collects <Text> nodes carrying the `footerLine` style. `lineHeight` is part
 * of the predicate because `pageNumber` shares footerLine's size and colour and
 * would otherwise be counted as a footer line too.
 */
function footerLines(letterhead: InvoiceLetterhead): FooterText[] {
  const found: FooterText[] = [];
  const walk = (node: unknown): void => {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const element = node as Partial<FooterText>;
    const style = element.props?.style;
    if (
      element.type === "Text" &&
      style?.fontSize === 7.5 &&
      style?.color === "#7a8792" &&
      style?.lineHeight === 1.4
    ) {
      found.push(element as FooterText);
    }
    if (element.props && "children" in element.props) walk(element.props.children);
  };
  walk(InvoiceDocument({ invoice, billTo, letterhead }));
  return found;
}

function countFooterLines(letterhead: InvoiceLetterhead): number {
  return footerLines(letterhead).length;
}

function findAddressNode(letterhead: InvoiceLetterhead): FooterText | undefined {
  return footerLines(letterhead).find((node) => node.props.style?.maxLines !== undefined);
}

describe("InvoiceDocument registered office", () => {
  it("prints the registered address once it is on file", () => {
    const text = renderText({
      ...emptyLetterhead,
      registered_address: "14 Karimu Kotun Street, Victoria Island, Lagos",
    });

    expect(text).toContain("14 Karimu Kotun Street, Victoria Island, Lagos");
  });

  it("collapses a multi-line address onto one footer line", () => {
    // The admin form stores this field from a <Textarea>, so newlines are
    // legitimate input. The footer is absolutely positioned, so a four-line
    // address would grow upward into the invoice body.
    const text = renderText({
      ...emptyLetterhead,
      registered_address: "14 Karimu Kotun Street\n  Victoria Island\n\nLagos\n",
    });

    expect(text).toContain("14 Karimu Kotun Street, Victoria Island, Lagos");
    const addressLine = text
      .split("\n")
      .find((segment) => segment.includes("Karimu Kotun"));
    expect(addressLine).not.toMatch(/\n/);
  });

  it("omits the line entirely when no address is on file, rather than printing a blank row", () => {
    // The live state on 2026-09-22 is a null column, so the invoice has to read
    // as an omission — one fewer footer line — not as a gap where an empty
    // <Text> still consumed a row.
    expect(countFooterLines(emptyLetterhead)).toBe(2);
    expect(
      countFooterLines({ ...emptyLetterhead, registered_address: "1 Somewhere Road, Lagos" }),
    ).toBe(3);

    const text = renderText(emptyLetterhead);
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("null");
  });

  it("caps the address at the number of lines the page reserves room for", () => {
    // The footer is absolutely positioned and grows upward. Collapsing newlines
    // is not enough on its own — a long address still wraps on width — so the
    // line count has to be bounded or it runs into the invoice body.
    const addressNode = findAddressNode({
      ...emptyLetterhead,
      registered_address: "Suite 4C, Plot 1234B, Admiralty Way, ".repeat(10),
    });

    // The cap has to live on the STYLE: @react-pdf/layout reads it as
    // node.style?.maxLines, so a `maxLines` JSX prop would silently do nothing.
    expect(addressNode).toBeDefined();
    expect(addressNode?.props.style?.maxLines).toBe(2);
    expect(addressNode?.props.style?.textOverflow).toBe("ellipsis");
  });

  it("still falls back to the platform contact details when email and phone are unset", () => {
    const text = renderText(emptyLetterhead);
    expect(text).toContain("TarragonHealth");
    expect(text).toContain("INV-2026-000123");
  });
});
