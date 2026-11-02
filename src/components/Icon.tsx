import type { CSSProperties } from 'react';
import {
  Archive,
  ArrowLeft,
  Award,
  Building2,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  ClipboardList,
  Database,
  Download,
  FileChartColumnIncreasing,
  Flag,
  History,
  Info as InfoIcon,
  LayoutDashboard,
  List,
  ListFilter,
  LockKeyhole,
  LockKeyholeOpen,
  MapPin,
  Menu,
  MessageCircleWarning,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';

export type IconName =
  | 'dashboard'
  | 'employees'
  | 'minutes'
  | 'visits'
  | 'observations'
  | 'evaluations'
  | 'reports'
  | 'settings'
  | 'plus'
  | 'search'
  | 'filter'
  | 'edit'
  | 'trash'
  | 'restore'
  | 'archive'
  | 'check'
  | 'close'
  | 'alert'
  | 'clock'
  | 'download'
  | 'upload'
  | 'print'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'menu'
  | 'building'
  | 'user'
  | 'calendar'
  | 'chart'
  | 'database'
  | 'shield'
  | 'info'
  | 'history'
  | 'lock'
  | 'unlock'
  | 'arrow-left'
  | 'list'
  | 'flag'
  | 'save';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}

const iconMap: Record<IconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  employees: UsersRound,
  minutes: ClipboardList,
  visits: MapPin,
  observations: MessageCircleWarning,
  evaluations: Award,
  reports: FileChartColumnIncreasing,
  settings: Settings2,
  plus: Plus,
  search: Search,
  filter: ListFilter,
  edit: Pencil,
  trash: Trash2,
  restore: RotateCcw,
  archive: Archive,
  check: Check,
  close: X,
  alert: CircleAlert,
  clock: Clock3,
  download: Download,
  upload: Upload,
  print: Printer,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  menu: Menu,
  building: Building2,
  user: UserRound,
  calendar: CalendarDays,
  chart: ChartNoAxesColumnIncreasing,
  database: Database,
  shield: ShieldCheck,
  info: InfoIcon,
  history: History,
  lock: LockKeyhole,
  unlock: LockKeyholeOpen,
  'arrow-left': ArrowLeft,
  list: List,
  flag: Flag,
  save: Save,
};

/** Shared Lucide icon primitive. Keeps existing icon names/API while applying a consistent, crisp stroke system. */
export function Icon({ name, size = 18, className, style, strokeWidth = 1.8 }: IconProps) {
  const Glyph = iconMap[name];
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    />
  );
}
