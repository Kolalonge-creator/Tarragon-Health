/**
 * "Tarragon Community" on the marketing site (decision COM-29: "Community" in the app, "Tarragon Community" here).
 * Every line maps to live behaviour (docs/COMMUNITY_SPEC.md): any signed-in adult can join for free
 * (`community_join_group` checks age, not plan); members get a made-up name per group; contact details are blocked
 * and selling, cure claims and medicine instructions are held for a moderator; crisis language is withheld and the
 * author shown emergency guidance. Do not add direct messages, doctor sessions or pictures here unless they are live
 * for every group.
 */
export const COMMUNITY_SECTION = {
  eyebrow: "Tarragon Community",
  title: "Support groups for people living with blood pressure, diabetes and more",
  description:
    "Talk with other adults who know what it is like to check your readings, take tablets every day and keep going. The groups are free to join with a Tarragon account.",
} as const;

export const COMMUNITY_GROUPS = ["High blood pressure", "Diabetes", "Healthy weight and habits", "General health"] as const;

export const COMMUNITY_POINTS = [
  {
    title: "A made-up name in every group",
    body: "Other members never see your real name, phone number or email. Your membership is not shown anywhere else on Tarragon.",
  },
  {
    title: "Moderated by our team",
    body: "Phone numbers, links and social media names are stopped before they post. Selling, miracle-treatment claims and advice to change medicine wait for a moderator.",
  },
  {
    title: "Help when a post sounds urgent",
    body: "If something you write suggests you may be in danger, the post is kept private, you are shown what to do straight away, and our safety team is told.",
  },
] as const;

export const COMMUNITY_NOTE =
  "The groups are for sharing day-to-day experience. They are not medical advice and not a way to reach your care team. For that, message your care team in the app.";
