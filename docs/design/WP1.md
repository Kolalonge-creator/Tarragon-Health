# WP1: pricing transparency

Competitor gaps B1 (a "not included" list with prices), B2 (a price-change notice) and B3 (a monthly equivalent of a yearly price). Migration `*_wp1_pricing_transparency.sql`; proof `packages/db/tests/wp1_pricing_transparency.sql`; registry key `pricing.transparency`.

## Decisions
- **D1 Information is not tied to the buying switch.** `catalogue_not_included()` shows the list for any item that is on sale with a live price (active, patient audience, price exists). It does not look at `v5_checkout`. The what-is-included page (`catalogue_item`) is itself hidden while checkout is closed, so wherever that page shows, the list shows; the list is never the thing that stays hidden.
- **D2 Prices on the list always come from the price book.** A row is either a real catalogue item (name and price come from the catalogue) or an i18n label with no price (for example medicines). An extra that is off sale, or has no live price, returns a null amount and the screen says "Ask us". Nothing is ever typed or guessed.
- **D3 Versioned by dates, not by edits.** `catalog_item_extras` rows are immutable except for closing once (`valid_to`). Replacing the list closes rows and adds rows, so the history is the trail. At most 12 open rows per item, counting words rows and priced rows together; the row guard and the admin function both lock the item before counting, so two admins cannot exceed it. The admin function refuses with `extras_too_many`.
- **D4 The notice never blocks a price.** A trigger on `prices` writes one in-app `price_change_notice` per person, to the holder of an unfinished entitlement bought at the old list price and to the person who paid when that is someone else (a Care Circle supporter). A unique index (recipient, template, price id) makes a replay a no-op. A sponsor-covered purchase is never told a list price (it did not pay it). If writing the notice fails, the error is logged with the organisation; if even that fails it is swallowed. The price is set either way. The bell line is neutral (INV-07); the details are on the Membership screen (`my_price_change_notices()`).
- **D5 The old price is honoured because nothing renews by itself.** What was paid stays paid until the entitlement ends; the new price applies only if the person chooses to buy again. The card says exactly that. No renewal lock was added.
- **D6 The monthly line is OFF.** `monthly_equivalent.enabled = false` in `pricing.transparency`. Web (`showMonthlyEquivalent()`, read on the server) and mobile read the flag and show nothing monthly while it is off. When on: kobo / 12 rounded half up to whole naira, only for items 360 to 370 days long, only when something is left to pay, always as one sentence ending "Billed once a year, not monthly." No monthly payment exists (S72-2). Founder confirmation: OQ-WP1-02.

## Day-one behaviour worth knowing
- The seeded priced extras (a consultation, a lab package) have no live price yet, so they show "Ask us" on the plan card and the what-is-included page. The page renders this plainly, with the note that extras are sold separately. They get a number the moment the founder prices them with `set_item_price` and switches them on.
- All seeded wording is PROPOSED and unreviewed (OQ-WP1-03).

## Out of scope
- **Label-only rows** (words with no price, such as medicines) have no admin screen. They need i18n copy, so they are code-governed: add the key to `packages/i18n/src/en.ts` and insert a row in a migration (effective-dated, never edited; to remove one, a migration closes it with `valid_to`). `admin_set_item_extras` leaves them alone.
- Organisation member prices and institutional price book rates are not announced (OQ-WP1-01).
