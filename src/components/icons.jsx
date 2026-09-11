// lucide-react 的統一入口(取代 Material Symbols subset 字型)。
//
// 為什麼保留 MSym 這個名字與 props 形狀:全站 271 個呼叫點、29 處動態 name
// 與 5 張間接來源表(navConfig 的 icon、THEME_META、TaskRow 的 m.icon…)全部
// 不必改——這一包換的是實作,不是介面。名字沿用 Material Symbols 的 ligature
// 名也是刻意的:那些名字已經散在 navConfig/agentRole/aiInsights 等資料層,
// 改名等於同時改資料與呼叫端,失敗面大得多。
//
// 為什麼不是 SF Symbols:它的授權只涵蓋 Apple 平台,不能上 web。lucide 的
// 1.5px 描邊＋圓端點是 web 上最接近 SF 的觀感(設計規範 §4)。
//
// absoluteStrokeWidth:lucide 預設會讓描邊隨 size 縮放,13–16px 的小圖示會
// 變得太細、在 1x 螢幕糊掉。鎖成絕對值才符合規範講的「1.5px 描邊」。
import {
  ArrowDown, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUp, ArrowUpRight, BadgeCheck, Ban, Bell, Bot,
  Calculator, Calendar, CalendarCog, CalendarX, Camera, Check, ChevronDown, ChevronLeft,
  ChevronRight, Circle, CircleAlert, CircleCheck, CircleCheckBig, CircleHelp, CircleX,
  ClipboardCheck, Clock, CloudSun, CloudUpload, CopyPlus, Download, Eye, FileCheck, FilePen,
  FileSearch, FileText, FileUp, Flag, FlaskConical, Folder, FolderOpen, HardHat, History, Hourglass,
  Image as ImageIcon, Images, Inbox, Info, Landmark, LayoutGrid, Link as LinkIcon, List, ListChecks, LoaderCircle,
  ListFilter, Lock, Mail, MailCheck, MapPin, Maximize2, Menu, MessageSquareWarning, Moon, NotebookPen, PanelLeftClose,
  PanelLeftOpen, Paperclip, Pencil, PenTool, Plus, Printer, Receipt, RefreshCw, Scale, Search,
  Send, Shield, ShieldAlert, ShieldCheck, ShieldUser, Sigma, SlidersHorizontal, Sparkles,
  Square, SquareCheck, Sun, SunMoon, Trash2, TriangleAlert, Type, Undo2, Upload, Wrench, X, Zap,
} from 'lucide-react'

// Material Symbols ligature 名 → lucide 元件。88 個都對照 lucide 1.44 的實際
// 匯出驗證過(版本之間會改名,不可憑記憶寫)。新增圖示=在這裡加一行。
const ICONS = {
  account_balance: Landmark,
  add: Plus,
  admin_panel_settings: ShieldUser,
  arrow_back: ArrowLeft,
  arrow_downward: ArrowDown,
  arrow_drop_down: ChevronDown,
  arrow_forward: ArrowRight,
  arrow_upward: ArrowUp,
  arrow_outward: ArrowUpRight,
  attach_file: Paperclip,
  auto_awesome: Sparkles,
  balance: Scale,
  block: Ban,
  bolt: Zap,
  brightness_auto: SunMoon,
  build: Wrench,
  calculate: Calculator,
  cancel: CircleX,
  check: Check,
  check_circle: CircleCheck,
  checklist: ListChecks,
  chevron_left: ChevronLeft,
  chevron_right: ChevronRight,
  close: X,
  cloud_upload: CloudUpload,
  compare_arrows: ArrowLeftRight,
  crop_square: Square,
  dark_mode: Moon,
  delete: Trash2,
  delete_forever: Trash2,
  description: FileText,
  download: Download,
  draft: FilePen,
  draw: PenTool,
  edit: Pencil,
  edit_calendar: CalendarCog,
  edit_note: NotebookPen,
  engineering: HardHat,
  error: CircleAlert,
  event: Calendar,
  event_busy: CalendarX,
  expand_more: ChevronDown,
  fact_check: ClipboardCheck,
  feedback: MessageSquareWarning,
  filter_list: ListFilter,
  find_in_page: FileSearch,
  flag: Flag,
  folder: Folder,
  folder_open: FolderOpen,
  function: Sigma,
  gpp_maybe: ShieldAlert,
  grid_view: LayoutGrid,
  help: CircleHelp,
  history: History,
  image: ImageIcon,
  hourglass_top: Hourglass,
  inbox: Inbox,
  info: Info,
  left_panel_close: PanelLeftClose,
  left_panel_open: PanelLeftOpen,
  library_add: CopyPlus,
  light_mode: Sun,
  link: LinkIcon,
  list_alt: List,
  location_on: MapPin,
  mail: Mail,
  lock: Lock,
  mark_email_read: MailCheck,
  menu: Menu,
  notifications: Bell,
  open_in_full: Maximize2,
  partly_cloudy_day: CloudSun,
  payments: Receipt,
  photo_camera: Camera,
  photo_library: Images,
  print: Printer,
  progress_activity: LoaderCircle,
  radio_button_unchecked: Circle,
  rate_review: FileCheck,
  refresh: RefreshCw,
  report: TriangleAlert,
  schedule: Clock,
  science: FlaskConical,
  search: Search,
  send: Send,
  shield: Shield,
  smart_toy: Bot,
  task: SquareCheck,
  task_alt: CircleCheckBig,
  title: Type,
  tune: SlidersHorizontal,
  undo: Undo2,
  upload: Upload,
  upload_file: FileUp,
  verified: BadgeCheck,
  verified_user: ShieldCheck,
  visibility: Eye,
  warning: TriangleAlert,
}

// 漏對映的退路:舊的 subset 字型漏字會靜默渲染成原始英文字,這裡改成
// 「畫一個中性圓圈 + dev 警告」——版面不會塌,但看得出來是缺的。
// 刻意不用 Shield 之類長得像真圖示的東西當退路:那會讓漏對映看起來正常
// (實測就發生過 shield 漏對映卻剛好畫出盾牌,只有 console 警告才抓得到)。
export const ICON_NAMES = Object.keys(ICONS)

export function MSym({ name, size = 20, fill = false, className = '', style, ...props }) {
  const Icon = ICONS[name] || Circle
  if (!ICONS[name] && import.meta.env?.DEV) {
    console.warn(`[MSym] 圖示「${name}」沒有 lucide 對映,請在 src/components/icons.jsx 的 ICONS 補一行`)
  }
  return (
    <Icon
      aria-hidden
      // data-i 只為了好 grep(舊實作靠它做 ::before content,現在純屬除錯用)
      data-i={name}
      size={size}
      // 選取態:Material Symbols 的 FILL 軸 lucide 沒有對應。Apple 的選取態
      // 本來就是「淺色底 + 主色圖示」而不是填滿字形(側欄已經這樣做),
      // 所以 fill 退化成描邊加重一階,不另外做填色版本。
      strokeWidth={fill ? 2.25 : 1.5}
      absoluteStrokeWidth
      className={`shrink-0 ${className}`}
      style={style}
      {...props}
    />
  )
}
