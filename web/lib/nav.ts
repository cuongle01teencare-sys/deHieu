import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertTriangle,
  Bell,
  BookOpen,
  Bot,
  Coins,
  GitMerge,
  History,
  LayoutDashboard,
  Palette,
  Radio,
  ScrollText,
  Settings2,
  Tags,
  Waypoints,
  Zap,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Nhãn ngắn cho tab dưới (mobile). */
  short?: string;
}

/** Sidebar: nhãn nhóm nhỏ, mờ; không hộp quanh mục. */
export const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { icon: LayoutDashboard, label: 'Tổng quan', href: '/' },
      { icon: Waypoints, label: 'Luồng dữ liệu', href: '/ingest' },
    ],
  },
  {
    label: 'Trận đấu',
    items: [
      { icon: Activity, label: 'Trận đấu', href: '/tran-dau' },
      { icon: GitMerge, label: 'Ghép trượt', href: '/ghep-truot' },
      { icon: Zap, label: 'Kèo', href: '/keo' },
    ],
  },
  {
    label: 'Vận hành',
    items: [
      { icon: Radio, label: 'Publisher & Node', href: '/publisher', short: 'Publisher' },
      { icon: Bot, label: 'Consumer', href: '/consumer' },
      { icon: Coins, label: 'Auto trade', href: '/giao-dich' },
    ],
  },
  {
    label: 'Giám sát',
    items: [
      { icon: AlertTriangle, label: 'Sự cố', href: '/su-co' },
      { icon: ScrollText, label: 'Audit', href: '/audit' },
      { icon: History, label: 'Lịch sử odds', href: '/lich-su-odds' },
    ],
  },
  {
    label: 'Cấu hình',
    items: [
      { icon: Settings2, label: 'Cài đặt arbitrage', href: '/cai-dat' },
      { icon: Tags, label: 'Bí danh đội', href: '/bi-danh' },
      { icon: BookOpen, label: 'Tài liệu hệ thống', href: '/tai-lieu' },
    ],
  },
];

/** Không nằm trong sidebar nhưng có route (menu tài khoản, ⌘K, "Thêm"). */
export const EXTRA_ITEMS: NavItem[] = [
  { icon: Bell, label: 'Thông báo', href: '/thong-bao' },
  { icon: Palette, label: 'Hệ thống thiết kế', href: '/thiet-ke' },
];

export const NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), ...EXTRA_ITEMS];

/** Tab dưới trên mobile (tối đa 5; mục 5 = "Thêm"). */
export const MOBILE_TABS = ['/', '/su-co', '/keo', '/tran-dau'];

export const findNav = (pathname: string): NavItem | undefined =>
  NAV_ITEMS.find((i) => (i.href === '/' ? pathname === '/' : pathname === i.href || pathname.startsWith(`${i.href}/`)));
