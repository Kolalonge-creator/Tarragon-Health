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
  Truck,
  LayoutDashboard,
  IdCard,
  Activity,
  Syringe,
  ClipboardCheck,
  Inbox,
  MessageSquare,
  BarChart3,
  Settings,
  Megaphone,
  MapPin,
  UserCog,
  Menu,
  X,
  LogOut,
  ChevronRight,
  ArrowRightLeft,
  Phone,
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
  logistics: Truck,
  reminderPreference: Phone,
} as const satisfies Record<string, LucideIcon>;

/** Navigation + app-shell chrome icons — same sanctioned-surface rule as
 * SEMANTIC_ICON (never import lucide-react directly outside this file).
 * These are structural/wayfinding icons, kept in their own map so the brand
 * guide's semantic slots above stay a clean 1:1 with its table. */
export const NAV_ICON = {
  dashboard: LayoutDashboard,
  passport: IdCard,
  lifestyle: Activity,
  vaccination: Syringe,
  review: ClipboardCheck,
  inbox: Inbox,
  messages: MessageSquare,
  analytics: BarChart3,
  settings: Settings,
  broadcast: Megaphone,
  region: MapPin,
  members: UserCog,
  referral: ArrowRightLeft,
  menu: Menu,
  close: X,
  signOut: LogOut,
  chevronRight: ChevronRight,
} as const satisfies Record<string, LucideIcon>;

/** Combined lookup for places that must reference icons by NAME (a plain
 * string) instead of by component — e.g. nav config built in a Server
 * Component and passed across the RSC boundary to the client AppShell, where
 * component functions are not serialisable. Key sets of the two maps are
 * disjoint, so the spread is collision-free. */
export const APP_ICON = {
  ...SEMANTIC_ICON,
  ...NAV_ICON,
} as const;

export type AppIconName = keyof typeof APP_ICON;
