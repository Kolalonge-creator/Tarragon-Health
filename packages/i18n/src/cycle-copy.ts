/**
 * Words for the private cycle section, planning mode, the contraception education page, menopause and the cycle data controls (S66).
 *
 * EVERY STRING IN THIS FILE IS PROPOSED COPY AWAITING CMO REVIEW (decisions A13, A14, A15; docs/plans/S66-S70-cmo-signoff-pack.md). The
 * review metadata is CYCLE_COPY_REVIEW below and a test fails if a key in this file is missing from it, so a new string cannot slip in
 * unreviewed. Nobody but the CMO marks it reviewed; this file never does.
 *
 * Rules held by tests: no em dashes; "your care team", never "your doctor"; nothing that suggests avoiding a pregnancy by tracking;
 * the contraception page is a plain list with no ranking (methods are in alphabetical order), no dosing, and never presents fertility
 * awareness as contraception. English only (decision D-14).
 */
export const cycleCopy = {
  // --- the label that goes with every fertile-window estimate (A14). The constant the engine uses is NOT_CONTRACEPTION_LABEL in @tarragon/shared; a test keeps them equal.
  "cycle.not_contraception": "This is not contraception.",

  // --- planning a pregnancy mode (16.2, A14)
  "cycle.planning.title": "Planning a pregnancy",
  "cycle.planning.description":
    "Turn this on only if you are trying to conceive. It adds an estimated fertile window and an ovulation test log to your tracker. It stays off unless you switch it on, and you can switch it off any time.",
  "cycle.planning.on_label": "Planning mode is on",
  "cycle.planning.off_label": "Planning mode is off",
  "cycle.planning.turn_on": "Turn on planning mode",
  "cycle.planning.turn_off": "Turn off planning mode",
  "cycle.planning.off_note": "Your estimated fertile days are hidden while planning mode is off.",
  "cycle.planning.turn_off_note": "Switching it off hides the estimate from every screen and export. Your logged days stay exactly as they are.",
  "cycle.planning.estimate_line": "Estimated fertile window {from} to {to}. This is not contraception.",
  "cycle.planning.disclaimer": "This is not contraception. This is an estimate from your logged cycles. It cannot prevent a pregnancy and it cannot confirm whether you ovulated.",
  "cycle.planning.save_failed": "That could not be saved just now. Please try again.",

  // --- danger signs that stay OUTSIDE the lock (they hold no personal data)
  "cycle.danger.title": "Get help now if this is happening",
  "cycle.danger.intro": "If you have any of these, go to the nearest hospital or health centre now. Do not wait for an appointment.",
  "cycle.danger.item_1": "Bleeding so heavy that you soak through a pad or cloth every hour for several hours.",
  "cycle.danger.item_2": "Bleeding with feeling faint, dizzy or very weak.",
  "cycle.danger.item_3": "Strong pain low in your belly, especially on one side, or if you could be pregnant.",
  "cycle.danger.item_4": "Any bleeding when you could be pregnant and have severe pain or feel faint.",
  "cycle.danger.soon": "Bleeding after your periods have stopped for good needs to be checked soon. Tell your care team.",

  // --- who can see this (decision: a plain-language access screen showing the audit log)
  "cycle.access.title": "Who has looked at this",
  "cycle.access.intro":
    "Only you can see your cycle details. Members of your care team who look after you can open a summary of them when they need it. Each time that happens it is written down here.",
  "cycle.access.empty": "Nobody on your care team has opened your cycle summary.",
  "cycle.access.row": "{when}: {reader}",
  "cycle.access.refused": "{when}: {reader} tried and was not allowed.",
  "cycle.access.load_failed": "We could not load this list just now. This is not the same as nobody having looked. Please try again.",
  "cycle.access.not_shared": "Your cycle details are never shown to a sponsor, an employer or anyone in your Care Circle unless you give them access to this section.",

  // --- deleting what you entered (decision C)
  "cycle.delete.title": "Delete what you have entered",
  "cycle.delete.intro":
    "You can ask us to delete the cycle days, periods and menopause notes you entered yourself. There is a waiting period so that you can change your mind. Anything your care team recorded, or acted on, is kept sealed and is not deleted.",
  "cycle.delete.counts": "{cycles} periods, {logs} daily logs and {reminders} reminders would be deleted. {sealed} notes your care team acted on would be kept sealed.",
  "cycle.delete.ask": "Ask to delete",
  "cycle.delete.pending": "Deletion is set for {when}. Until then you can cancel.",
  "cycle.delete.cancel": "Cancel the deletion",
  "cycle.delete.receipt": "Deleted on {when}: {cycles} periods, {logs} daily logs, {reminders} reminders. {sealed} sealed notes kept.",
  "cycle.delete.failed": "That could not be done just now. Please try again.",

  // --- menopause (16.4, A15)
  "menopause.title": "Perimenopause and menopause",
  "menopause.intro": "Keep a simple record of how you feel so that you and your care team can see patterns over time. This is a log, not a score, and it is not a diagnosis.",
  "menopause.education_1": "Perimenopause is the time before your periods stop for good. Periods often become less regular, and hot flushes, poor sleep and low mood are common.",
  "menopause.education_2": "Menopause is when you have not had a period for 12 months in a row. Symptoms can carry on for some years.",
  "menopause.education_3": "Many things help with symptoms. Your care team can talk through what suits you. This page does not give advice about hormone treatment.",
  "menopause.bleeding_urgent": "Bleeding after your periods have stopped for good always needs to be checked. Your care team has been told. Please book a visit soon.",
  "menopause.symptom.hot_flashes": "Hot flushes",
  "menopause.symptom.night_sweats": "Night sweats",
  "menopause.symptom.sleep_disturbance": "Sleep",
  "menopause.symptom.mood_changes": "Mood",
  "menopause.symptom.vaginal_dryness": "Vaginal dryness",
  "menopause.symptom.vaginal_discomfort": "Vaginal discomfort",
  "menopause.symptom.irregular_bleeding": "Changes in my periods",
  "menopause.symptom.joint_aches": "Aches and pains",
  "menopause.symptom.brain_fog": "Trouble concentrating",
  "menopause.symptom.other": "Something else",

  // --- contraception education (16.3, A13)
  "contraception.edu.title": "Contraception: the options",
  "contraception.edu.intro":
    "This page lists the methods people use to prevent a pregnancy, in alphabetical order. It does not rank them. The right one depends on your health, your plans and what suits you, and your care team can talk it through with you.",
  "contraception.edu.not_tracking": "Tracking your cycle in this app is not contraception.",
  "contraception.edu.method.pill_combined": "Combined pill: a daily pill containing two hormones.",
  "contraception.edu.method.condoms": "Condoms (male and female): a barrier worn during sex. Condoms also protect against sexually transmitted infections; other methods do not.",
  "contraception.edu.method.implant": "Contraceptive implant: a small rod placed under the skin of the upper arm by a trained provider, and removed by one.",
  "contraception.edu.method.copper_iud": "Copper intrauterine device (IUD): a small device placed in the womb by a trained provider, and removed by one. It contains no hormone.",
  "contraception.edu.method.hormonal_iud": "Hormonal intrauterine device: a small device placed in the womb by a trained provider that releases a hormone locally.",
  "contraception.edu.method.injectable": "Injectable: an injection given by a provider at regular visits.",
  "contraception.edu.method.pill_progestogen": "Progestogen-only pill: a daily pill containing one hormone.",
  "contraception.edu.method.sterilisation": "Sterilisation (female or male): a procedure intended to be permanent.",
  "contraception.edu.cautions": "Some health conditions, and some medicines, mean a method needs more thought. Tell your care team about your health and your medicines before you choose.",
  "contraception.edu.emergency_title": "If you had sex without protection",
  "contraception.edu.emergency_body":
    "Emergency contraception can be used after sex without protection, or when a method failed. The sooner it is used, the better it works. A pharmacy or your care team can explain the choices and which suit you.",
  "contraception.edu.refer_title": "Talk to your care team",
  "contraception.edu.refer_body": "Your care team can answer your questions, check what is safe for you and help you get the method you choose.",
  "contraception.edu.refer_button": "Ask your care team about contraception",
  "contraception.edu.closed": "This page is not open yet. Your care team will let you know when it is.",
} as const;

/**
 * Review record for every key above. `status: "pending_cmo_review"` until the Chief Medical Officer signs the wording in the sign-off hub;
 * nothing in code flips it. The sources are the references the CMO pack names; every [verify] there still has to be checked against the
 * source document by the reviewer.
 */
export const CYCLE_COPY_REVIEW = {
  status: "pending_cmo_review",
  owner: "CMO",
  decisions: ["A13", "A14", "A15"],
  source: "docs/plans/S66-S70-cmo-signoff-pack.md",
  basis: ["WHO Medical Eligibility Criteria for Contraceptive Use [verify]", "Nigerian National Family Planning Guidelines [verify]", "NICE NG23 and International Menopause Society [verify]"],
  prefixes: ["cycle.", "menopause.", "contraception."],
} as const;
