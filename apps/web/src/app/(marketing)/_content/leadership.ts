/**
 * Leadership data, shared by the About page's LeadershipGrid (a client
 * component) and the homepage's clinical oversight section (a server
 * component). Kept in a plain module so both can import the values.
 */

/**
 * TarragonHealth's team, styled after Function Health's leadership grid:
 * click a card, a bio opens in a panel on the right. Open roles live on
 * their own /careers page, not here — this grid is people only. Add a
 * `person` entry here the moment a role is actually filled.
 */
export type PersonMember = {
  kind: "person";
  id: string;
  name: string;
  title: string;
  credentials?: string;
  photoSrc?: string;
  photoAlt?: string;
  bio: string;
  quote?: string;
  linkedinUrl?: string;
};

export type TeamMember = PersonMember;

export const TEAM: TeamMember[] = [
  {
    kind: "person",
    id: "kola-longe",
    name: "Dr Kola Longe",
    title: "Founder & CEO",
    credentials: "MBChB · FEBEM · FRCEM · MSt (University of Cambridge)",
    photoSrc: "/marketing/founder-kola-longe.jpg",
    photoAlt: "Dr Kola Longe, Founder & CEO of TarragonHealth",
    bio: "A physician and healthcare leader with experience across Nigeria and the United Kingdom, Kola works at the intersection of clinical medicine, healthcare leadership, and technology. He earned his MBChB from Obafemi Awolowo University, Ile-Ife, and specialised in Emergency Medicine, becoming a Fellow of the Royal College of Emergency Medicine and a Fellow of the European Board of Emergency Medicine. He holds a Master of Studies in Clinical Medicine from the University of Cambridge, and is a certified Project Management Professional and Program Management Professional through the Project Management Institute, pairing clinical insight with structured programme delivery and organisational leadership. Through TarragonHealth, Kola is building a more proactive model of healthcare, one that closes the gap between doctor's appointments, where early warning signs are often missed and preventable conditions go unnoticed. Using technology, data, and patient-centred design, TarragonHealth connects prevention, early detection, and ongoing care, helping people identify risks earlier, reach the right care sooner, and stay engaged with their health over time. As Founder and CEO, Kola leads TarragonHealth's clinical strategy, product vision, and growth, keeping every product grounded in real clinical need while staying accessible, scalable, and commercially sustainable.",
    quote:
      "Healthcare should not begin and end with a doctor's appointment. At TarragonHealth, our mission is to close the gap between visits, helping people detect disease earlier, prevent avoidable illness, and take greater control of their health throughout their lives.",
    linkedinUrl: "https://www.linkedin.com/in/dr-kola-longe-408b15121/",
  },
  {
    kind: "person",
    id: "maxwell-dayok",
    name: "Dr Maxwell Dayok",
    title: "Chief Medical Officer",
    credentials: "MBBS · MPH · FMCFM · FRCEM",
    photoSrc: "/marketing/cmo-maxwell-dayok.jpg",
    photoAlt: "Dr Maxwell Dayok, Chief Medical Officer at TarragonHealth",
    bio: "Dr Maxwell Dayok is Chief Medical Officer at TarragonHealth, with over 20 years of clinical practice spanning Nigeria and the United Kingdom in Emergency Medicine, Family Medicine, and Public Health. He qualified with an MBBS from the University of Jos, Nigeria, and holds an MPH from Ahmadu Bello University. He is a Fellow of the Royal College of Emergency Medicine (FRCEM) and a Fellow of the West African College of Physicians in Family Medicine (FMCFM), and practises as a Consultant in Family Medicine. He also holds a Postgraduate Certificate in Medical and Healthcare Education from Anglia Ruskin University. Dr Dayok built his early career within Nigeria's healthcare system before relocating to the UK, giving him first-hand experience of both systems and the populations they serve. That range, acute care, primary care, and prevention, across two very different health economies, shapes his approach at TarragonHealth. As CMO, he provides clinical leadership and oversight across the organisation, working with the leadership and product teams to ensure TarragonHealth's products and strategies are safe, evidence-based, and centred on the patient. His focus: prevention, early detection, and continuity of care.",
    quote:
      "The future of healthcare is not simply about treating illness when it appears, but about identifying risk early, preventing disease where possible, and ensuring that every patient has access to timely, evidence-based care. At TarragonHealth, we are building a healthcare model that makes prevention and early intervention an integral part of everyday life.",
    linkedinUrl: "https://www.linkedin.com/in/pankyes-maxwell-dayok-88b727134/",
  },
  {
    kind: "person",
    id: "adefola-adetunbi",
    name: "Dr Adefola Adetunbi",
    title: "Head of Clinical Operations",
    credentials: "MBChB · MPH · Leadership & Management in Health",
    photoSrc: "/marketing/head-clinical-ops-adefola-adetunbi.jpg",
    photoAlt: "Dr Adefola Adetunbi, Head of Clinical Operations at TarragonHealth",
    bio: "Dr Adefola Adetunbi is a physician and healthcare leader serving as Head of Clinical Operations at TarragonHealth, with experience spanning clinical practice, public health, and service operations across Nigeria and the United Kingdom. He obtained his MBChB from Obafemi Awolowo University, Ile-Ife, and holds an MPH from York St John University, London, alongside Leadership and Management in Health training from the University of Washington. Having practised within both the Nigerian and UK healthcare systems, he brings a cross-system understanding of the clinical, operational, and patient-facing challenges that shape healthcare delivery in each. As Head of Clinical Operations, he builds and leads TarragonHealth's clinical delivery model: the frameworks for recruiting, onboarding, training, scheduling, supporting, and governing clinicians. He works with the leadership, clinical, and technology teams on protocols, review pathways, quality assurance, and automation, creating the infrastructure that lets TarragonHealth expand access to medical expertise without compromising clinical standards.",
    quote:
      "Healthcare innovation only matters when it improves care for real patients. Our responsibility at TarragonHealth is to build clinical systems that can scale across different healthcare environments while maintaining the quality, safety, and human judgement that patients deserve.",
    linkedinUrl: "https://www.linkedin.com/in/adefola-richmond-adetunbi-a85b14121/",
  },
];
