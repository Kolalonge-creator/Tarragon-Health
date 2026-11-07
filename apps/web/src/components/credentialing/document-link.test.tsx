import { renderToStaticMarkup } from "react-dom/server";
import { CredentialDocumentLink, isScanHeld } from "./document-link";

/** Reviewers see which credential documents are waiting for their malware scan, and get no dead link to them. */
const ID = "11111111-1111-4111-8111-111111111111";
const html = (scanStatus: string) => renderToStaticMarkup(<CredentialDocumentLink id={ID} kind="cv" scanStatus={scanStatus} />);

describe("CredentialDocumentLink", () => {
  it.each(["clean", "unscanned"])("links a %s document to the document route", (status) => {
    expect(html(status)).toContain(`href="/api/credentialing/documents/${ID}"`);
    expect(html(status)).not.toContain("safety check");
  });

  it("labels a held document and offers no link to it", () => {
    expect(html("pending_scan")).toContain("Waiting for safety check");
    expect(html("pending_scan")).not.toContain("href=");
  });

  it("tells the reviewer to ask for a fresh copy of a failed document", () => {
    expect(html("infected")).toContain("ask for a fresh copy");
    expect(html("infected")).not.toContain("href=");
  });

  it("treats held and failed documents as not checkable", () => {
    expect([isScanHeld("pending_scan"), isScanHeld("infected"), isScanHeld("clean"), isScanHeld("unscanned")]).toEqual([true, true, false, false]);
  });
});
