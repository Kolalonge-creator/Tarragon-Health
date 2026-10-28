import QRCode from "qrcode";
import { callInstitution, notice } from "@/lib/institution/call";
import { groupCode, parseCodeSheet } from "@/lib/institution/files";
import { PrintButton } from "../pilot/print-button";

export const metadata = { title: "Sign-up code sheet" };
export const dynamic = "force-dynamic";

// The code only: no name and no personal data in the picture. A printed page needs no data connection to read.
const qr = (code: string): Promise<string> => QRCode.toString(code, { type: "svg", margin: 1, width: 160 });

/** A printable sheet of your sign-up codes (low-data enrolment): large grouped text and a QR of the code, for a noticeboard or an HR desk. */
export default async function EnrolmentSheetPage() {
  const res = await callInstitution("sponsor_code_sheet", {}, parseCodeSheet);
  if (res.state !== "ok") return <p role="status">{notice(res.state)}</p>;
  const sheet = res.data;
  const entries = [
    ...(sheet.organisation_code ? [{ label: `${sheet.sponsor}: join your workplace programme`, code: sheet.organisation_code, until: null as string | null }] : []),
    ...sheet.programmes.map((p) => ({ label: p.name, code: p.code, until: p.valid_to })),
  ];
  const svgs = await Promise.all(entries.map((e) => qr(e.code)));
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <p className="text-sm">Print this page. Members open the Tarragon app, choose Enter a code, and type the code or read it from the picture.</p>
        <PrintButton label="Print this sheet" />
      </div>
      {entries.length === 0 ? (
        <p>You have no open sign-up codes yet.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {entries.map((e, i) => (
            <section key={e.code} className="break-inside-avoid rounded border p-4 text-center">
              <h2 className="text-lg font-semibold">{e.label}</h2>
              <div className="mx-auto my-2 w-40" dangerouslySetInnerHTML={{ __html: svgs[i]! }} />
              <p className="font-mono text-3xl tracking-widest" aria-label={`Code ${e.code.split("").join(" ")}`}>
                {groupCode(e.code)}
              </p>
              {e.until && <p className="text-sm">Works until {e.until}</p>}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
