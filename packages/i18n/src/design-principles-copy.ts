/**
 * Design-principles pass (2026-10). English only (D-14). Keys are namespaced `dp.`.
 * Rules: no em dashes, "your care team", no clinical claim. Nothing here names a condition, a reading or a result.
 * The Home "next step" card wording is plain navigation copy; the CMO is asked in OQ-DP-02 to confirm the safety-message line.
 */
export const designPrinciplesCopy = {
  "dp.price.you_pay": "You pay {amount}",
  "dp.price.no_charge": "No charge",

  "dp.next.label": "Next step",
  "dp.next.red_alert.title": "A safety message is waiting for you",
  "dp.next.red_alert.body": "Please open it first, before anything else on this page.",
  "dp.next.red_alert.cta": "Open it now",
  "dp.next.dose.title": "Time for your care plan check",
  "dp.next.dose.body": "Open your list and mark what you have done today.",
  "dp.next.dose.cta": "Open my list",
  "dp.next.reading.title": "Log a reading today",
  "dp.next.reading.body": "A fresh reading keeps your care team's picture of you current. It takes under a minute.",
  "dp.next.reading.cta": "Log a reading",
  "dp.next.refill.title": "{name} is due for a refill soon",
  "dp.next.refill.body": "Sort the refill now so your supply keeps going.",
  "dp.next.refill.cta": "Sort my refill",
  "dp.next.screening.title": "Your {name} is due",
  "dp.next.screening.body": "Booking takes about a minute, and an early catch is the whole point of screening.",
  "dp.next.screening.cta": "Book it now",
  "dp.next.consult.title": "Your care team offered times for a video call",
  "dp.next.consult.body": "Pick whichever works for you. It only takes a tap to confirm.",
  "dp.next.consult.cta": "Pick a time",
  "dp.next.checkin.title": "A 2-minute medicines check-in is waiting",
  "dp.next.checkin.body": "Tell us how the medicine is going. It helps your care team spot problems early.",
  "dp.next.checkin.cta": "Answer now",
  "dp.next.review.title": "Your medication review is due",
  "dp.next.review.body": "A quick review with your care team keeps your treatment on track. Book it when you are ready.",
  "dp.next.review.cta": "See my review",
  "dp.next.lesson.title": "This week's lesson is ready",
  "dp.next.lesson.body": "A short read, under five minutes, with one thing to try.",
  "dp.next.lesson.cta": "Read it",
  "dp.next.caught_up.title": "You are all caught up",
  "dp.next.caught_up.body": "No tasks are waiting on you right now. Keep logging readings so your care team can keep an eye on things.",
  "dp.next.caught_up.cta": "Log another reading",

} as const;
