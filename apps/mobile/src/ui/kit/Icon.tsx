import {
  Activity,
  AlertTriangle,
  Bell,
  Calendar,
  Check,
  ChevronRight,
  Clock,
  CloudUpload,
  Droplet,
  Heart,
  Home,
  Info,
  Lock,
  Menu,
  MessageCircle,
  Pill,
  Plus,
  Settings,
  ShieldCheck,
  User,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react-native";
import { useTheme, type Palette } from "../design";

/**
 * One rounded 2 px outline icon set (decision DG-4, brand guide section 7),
 * Lucide, ISC licence. Screens ask for an icon by purpose, not by library name,
 * so the set can change in one place. Add a name here before using it.
 */
export const ICONS = {
  home: Home,
  vitals: Activity,
  medication: Pill,
  messages: MessageCircle,
  notifications: Bell,
  settings: Settings,
  next: ChevronRight,
  add: Plus,
  done: Check,
  alert: AlertTriangle,
  offline: WifiOff,
  sending: CloudUpload,
  heart: Heart,
  glucose: Droplet,
  appointment: Calendar,
  person: User,
  safe: ShieldCheck,
  close: X,
  menu: Menu,
  info: Info,
  time: Clock,
  private: Lock,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export type IconTone = keyof Pick<
  Palette,
  "text" | "textMuted" | "textSubtle" | "brandText" | "warnText" | "dangerText" | "textOnBrand" | "textOnEmergency"
>;

interface IconProps {
  name: IconName;
  size?: number;
  tone?: IconTone;
}

/** Decorative by default (hidden from screen readers); put the meaning in the label of the control that holds it. */
export function Icon({ name, size = 20, tone = "text" }: IconProps) {
  const { colors } = useTheme();
  const Glyph = ICONS[name];
  return <Glyph size={size} color={colors[tone]} strokeWidth={2} accessibilityElementsHidden importantForAccessibility="no" />;
}
