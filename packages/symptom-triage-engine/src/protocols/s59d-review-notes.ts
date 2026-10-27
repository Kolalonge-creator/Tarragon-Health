/**
 * Review notes for the S59d draft pathways: the sources behind each pathway, what could not be verified, and the clinical
 * questions only the Chief Medical Officer can answer. This is DATA for the reviewer, shown beside every rule on the sign-off
 * panel and mirrored in docs/research/S59d-pathway-coverage.md (a test fails if a pathway, source or question id is missing from
 * the document). Nothing here is clinical advice and nothing here signs anything.
 *
 * `read` says how far the source was actually read in the session that drafted this: "page_read" means the page text was
 * fetched and the claim checked against it; "recalled_not_opened" means the document is named from knowledge and was NOT opened,
 * so the CMO must check the claim against it before signing. No citation here is invented; where a link could not be confirmed
 * none is given.
 */
export type SourceRead = "page_read" | "recalled_not_opened";

export interface ReviewSource {
  citation: string;
  url?: string;
  read: SourceRead;
  /** What the pathway takes from it. */
  supports: string;
}

export interface CmoQuestion {
  id: string;
  text: string;
}

export interface PathwayReviewNotes {
  sources: ReviewSource[];
  unverified: string[];
  cmoQuestions: CmoQuestion[];
}

export const S59D_REVIEW_NOTES: Readonly<Record<string, PathwayReviewNotes>> = {
  fever: {
    sources: [
      {
        citation: "WHO malaria fact sheet",
        url: "https://www.who.int/news-room/fact-sheets/detail/malaria",
        read: "page_read",
        supports:
          "Severe features (extreme tiredness, impaired consciousness, multiple convulsions, difficulty breathing, dark or bloody urine, jaundice, abnormal bleeding) go to emergency; every suspected case is confirmed with a parasite test (rapid test or microscopy) before treatment.",
      },
      {
        citation: "Nigeria National Malaria Elimination Programme, national guidelines for diagnosis and treatment of malaria",
        read: "recalled_not_opened",
        supports: "Test before treat for any fever; treatment is for a clinician or accredited provider. The edition and wording were not opened.",
      },
      {
        citation: "WHO guidelines for malaria (severe malaria features, prostration, persistent vomiting, pregnancy)",
        url: "https://www.who.int/teams/global-malaria-programme/guidelines-for-malaria",
        read: "recalled_not_opened",
        supports: "Prostration, severe pallor and repeated vomiting as reasons for same-day assessment; pregnancy raises the risk.",
      },
      {
        citation: "WHO typhoid fever material and Nigerian treatment guidelines (typhoid complications: perforation, intestinal bleeding)",
        read: "recalled_not_opened",
        supports: "A board-like belly or blood in the stool with fever as emergencies; fever of 3 days or more as a prompt to test for typhoid as well as malaria.",
      },
    ],
    unverified: [
      "The 3-day line for 'prolonged fever' (the v2 draft said 5). It is the common typhoid prompt, not a figure taken from an opened guideline.",
      "No Nigerian typhoid seasonality was found, so there is no typhoid season hook.",
      "The 40 C emergency line is carried over unchanged from the v2 draft.",
      "Whether fever in a person with sickle cell disease should be urgent or emergency (many sickle cell protocols treat 38 C or more as an emergency).",
      "What 'recent travel' should mean for someone moving within Nigeria.",
    ],
    cmoQuestions: [
      { id: "F1", text: "Is 3 days the right line for a prolonged fever, and should a recurring fever stay in the same rule?" },
      { id: "F2", text: "A fever with no malaria test yet now ends in 'routine: get tested', and self-care is reachable only after a negative test. Is routine the right category, or should an untested fever be urgent after a set number of days?" },
      { id: "F3", text: "Should a positive malaria test always be urgent with a clinician, or can a Member be guided to an approved treatment pathway?" },
      { id: "F4", text: "Fever with sickle cell disease: urgent (drafted) or emergency?" },
      { id: "F5", text: "Confirm the travel, rainy-season and Lassa hooks in symptom.risk_tightening version 3 (months, states, minimum categories)." },
    ],
  },
  pregnancy_danger_signs: {
    sources: [
      {
        citation: "CDC Hear Her, urgent maternal warning signs",
        read: "recalled_not_opened",
        supports:
          "Headache that will not go away, dizziness or fainting, changes in vision, fever, trouble breathing, chest pain or fast heartbeat, severe belly pain, vaginal bleeding or fluid, baby moving less, swelling. The page link tried (cdc.gov/hearher) returned 404, so no link is given.",
      },
      {
        citation: "WHO recommendations on antenatal care for a positive pregnancy experience: danger signs",
        read: "recalled_not_opened",
        supports: "Vaginal bleeding, convulsions, severe headache with blurred vision, fever and too weak to get out of bed, severe abdominal pain, fast or difficult breathing.",
      },
      {
        citation: "NICE NG133, hypertension in pregnancy (pre-eclampsia features)",
        read: "recalled_not_opened",
        supports: "Severe headache and visual disturbance as features of severe pre-eclampsia (already cited for the context hook in S59b).",
      },
      {
        citation: "RCOG green-top guideline on reduced fetal movements",
        read: "recalled_not_opened",
        supports: "A baby moving less than usual needs same-day assessment.",
      },
    ],
    unverified: [
      "Whether any vaginal bleeding should be emergency rather than urgent (WHO lists vaginal bleeding as a danger sign to go to a facility at once; light early spotting is common).",
      "Gestation is not asked, so early-pregnancy rules (ectopic risk with one-sided pain) are not separate.",
      "Postnatal warning signs are not covered.",
      "No wording was checked against a Nigerian maternal health protocol.",
    ],
    cmoQuestions: [
      { id: "P1", text: "Light bleeding in pregnancy: urgent (drafted) or emergency?" },
      { id: "P2", text: "Reduced baby movement: urgent (drafted) or emergency?" },
      { id: "P3", text: "Any headache in pregnancy is urgent here. Is that too wide, or right for pre-eclampsia screening?" },
      { id: "P4", text: "Do you want a postnatal pathway and a separate early-pregnancy pathway?" },
      { id: "P5", text: "Pregnancy is sensitive data. The pathway is meant to be run by the pregnant person for themselves. Confirm that it must not be offered when someone else runs a check for them (OQ-S59d-05)." },
    ],
  },
  hypertension_complication: {
    sources: [
      {
        citation: "ESC/ESH and ACC/AHA definitions of hypertensive emergency (180 systolic or 120 diastolic with organ damage)",
        read: "recalled_not_opened",
        supports: "The 180 and 120 lines, an emergency only with a warning sign, urgent without one.",
      },
      {
        citation: "FAST and BE-FAST stroke signs (American Stroke Association)",
        read: "recalled_not_opened",
        supports: "Face drooping, arm weakness or numbness, speech difficulty, sight loss, balance loss as emergencies.",
      },
      {
        citation: "NICE NG133, hypertension in pregnancy",
        read: "recalled_not_opened",
        supports: "Pregnant with high blood pressure and a headache or visual change as an emergency.",
      },
    ],
    unverified: [
      "Whether a very high reading with no symptoms is urgent or whether the line should be higher or require a repeat reading after rest.",
      "Home cuff accuracy: the readings are typed in by the person.",
      "Nigerian hypertension guidance (Nigerian Hypertension Society or the national standard treatment guidelines) was not opened.",
    ],
    cmoQuestions: [
      { id: "H1", text: "Confirm 180 and 120 as the lines, and whether a repeat reading after five minutes of rest should be asked first." },
      { id: "H2", text: "Is a very high reading with no symptoms urgent (drafted)?" },
      { id: "H3", text: "The recent blood pressure from the record can only raise the result (symptom.context_tightening version 3). Confirm the look-back window." },
    ],
  },
  diabetes_complication: {
    sources: [
      {
        citation: "ADA Standards of Care in Diabetes, glycaemic goals and hypoglycaemia (level 1 below 3.9 mmol/L, level 2 below 3.0, level 3 severe with altered mental or physical state)",
        url: "https://diabetesjournals.org/care/issue",
        read: "recalled_not_opened",
        supports: "The low sugar lines and confusion, a fit or being unable to swallow as an emergency. The article link tried returned 403, so only the journal index is given.",
      },
      {
        citation: "ADA/EASD consensus on hyperglycaemic crises in adults with diabetes (DKA and hyperosmolar hyperglycaemic state)",
        read: "recalled_not_opened",
        supports: "DKA from about 11 mmol/L with ketones and vomiting, deep fast breathing or drowsiness; the hyperosmolar state from about 33.3 mmol/L.",
      },
      {
        citation: "IWGDF/IDSA guidelines on diabetic foot infection",
        read: "recalled_not_opened",
        supports: "A new foot ulcer or infection needs prompt review; infection with fever (a systemic sign) is severe. Black or dead skin as an emergency.",
      },
    ],
    unverified: [
      "The 20 mmol/L line for a high sugar reading with thirst is a common 'seek advice' line but no source was opened.",
      "Ketone meter thresholds are not coded; the pathway asks only whether ketones were found.",
      "Treatment advice for a low sugar (15 g of fast sugar) is not part of the pathway; it belongs in the safety-net advice, which is another piece of work (OQ-S59d-07).",
      "Nigerian diabetes guidance was not opened.",
    ],
    cmoQuestions: [
      { id: "D1", text: "A low sugar reading or low sugar signs with no confusion are urgent here. Is that right for someone who has just treated it?" },
      { id: "D2", text: "Confirm 11 (DKA with vomiting), 20 (urgent with thirst) and 33.3 (emergency) as the high sugar lines." },
      { id: "D3", text: "A new foot sore without a fever is urgent. Same day or within a working day?" },
      { id: "D4", text: "Do you want sulphonylurea or insulin use asked, because they change hypoglycaemia risk?" },
    ],
  },
};
