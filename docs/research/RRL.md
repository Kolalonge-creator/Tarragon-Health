# RRL research: records request letter

Evidence caveat: general knowledge of public products and of the Nigeria Data Protection Act 2023 only; nothing here is legal advice and no statute text was checked against a primary source. Counsel confirms before the wording is signed.

## Asking a facility for your own records (competitors: US patient portals, UK subject access request generators, Eka Care)
- US portals mostly pull data over an integration; where that fails, apps offer a "request records" form that is faxed or emailed on the person's behalf. UK services generate a subject access request letter and leave sending to the person. Eka Care ingests whatever document the person uploads.
- Unsafe or unsuitable for Nigeria: sending on the person's behalf needs a contract and identity checks with each facility, which do not exist; an automated send would also be a channel a feature depends on. A letter that cites section numbers or deadlines as law, if wrong, makes a person demand something the facility is not bound to give, or sets a false deadline in their head.
- Decision: a patient-owned letter, printed or sent by the person; wording in versioned config marked unsigned placeholder; the NDPA 2023 right of access named only as the person's own request; no section, deadline or penalty stated; the app tracks a reminder date from a placeholder period, shown as "not a legal deadline".

## Tracking and receiving
- Competitors track "request sent / received" lightly or not at all; the useful part is a nudge when nothing has come back. In Nigeria records offices may take days and ask for an in-person visit, a fee or ID, so the letter asks the facility to say what it needs.
- Decision: states prepared, sent, received, withdrawn; overdue is derived (sent and past its date) and shown in the app only (Passport banner, list, detail, phone); no SMS, no WhatsApp, no push, no notification row. When received, one tap goes to the existing document capture screen, where nothing joins the record until the person confirms it.

## The letter itself
- Plain language, one A4 page, black on white so any office printer or photocopier works; blanks left for the hospital number and where to send the records; signature line. Scope is a closed list (discharge summary, lab results, scan and X-ray reports, whole record) so a letter cannot ask for something the app cannot later file.
