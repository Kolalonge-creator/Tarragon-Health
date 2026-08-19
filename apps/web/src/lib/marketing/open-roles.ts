/** Currently open leadership seats, shown on the /careers page. */
export type OpenRole = {
  id: string;
  title: string;
  teaser: string;
  scope: string;
};

export const OPEN_ROLES: OpenRole[] = [
  {
    id: "head-engineering",
    title: "Head of Engineering",
    teaser: "Owns the platform and ML microservice",
    scope:
      "Owns the TypeScript platform and ML microservice, the system of record behind every reading, reminder, and escalation.",
  },
  {
    id: "head-partnerships",
    title: "Head of Partnerships",
    teaser: "Grows the lab, pharmacy, and specialist network",
    scope:
      "Grows and manages the lab, pharmacy, and specialist network that Care Coordination runs on.",
  },
  {
    id: "head-growth",
    title: "Head of Growth & Commercial",
    teaser: "Leads corporate wellness and HMO partnerships",
    scope:
      "Leads corporate wellness and HMO partnerships, turning the B2B & Institutional pipeline into revenue.",
  },
];
