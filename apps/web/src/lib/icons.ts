import {
  HeartPulse,
  Droplet,
  Pill,
  TestTube,
  Users,
  Headphones,
  ShieldCheck,
  Link2,
  FileText,
  ShoppingBag,
  Building2,
  Grid3x3,
  Calendar,
  ClipboardList,
  Sparkles,
  Lock,
  CreditCard,
  Percent,
  type LucideIcon,
} from "lucide-react";

/** BRAND_GUIDE.md §7 semantic icon mapping — the only sanctioned import
 * surface for dashboard icons. Never import from "lucide-react" directly
 * outside this file. The 12 documented slots are `bp` through `hmo`;
 * `booking`, `carePlan`, and `aiCoach` are practical additions for
 * dashboard cards the brand guide's table doesn't explicitly cover. */
export const SEMANTIC_ICON = {
  bp: HeartPulse,
  diabetes: Droplet,
  medication: Pill,
  labs: TestTube,
  parentCare: Users,
  clinicianFollowUp: Headphones,
  preventive: ShieldCheck,
  family: Link2,
  escalation: FileText,
  pharmacy: ShoppingBag,
  corporate: Building2,
  hmo: Grid3x3,
  booking: Calendar,
  carePlan: ClipboardList,
  aiCoach: Sparkles,
  upgrade: Lock,
  billing: CreditCard,
  commission: Percent,
} as const satisfies Record<string, LucideIcon>;
