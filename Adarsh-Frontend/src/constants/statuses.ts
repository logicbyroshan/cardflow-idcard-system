import { 
  Clock, 
  CheckCircle2, 
  ShieldCheck, 
  Download, 
  Trash2, 
  FileQuestion, 
  Check, 
  XCircle, 
  Printer,
  type LucideIcon 
} from "lucide-react"

export type StatusKey = 
  | "PENDING"
  | "VERIFIED"
  | "APPROVED"
  | "DOWNLOADED"
  | "DELETED"
  | "REQUESTED"
  | "CONFIRMED"
  | "REJECTED"
  | "PRINTED"

export interface StatusConfig {
  label: string
  color: string // Tailwind color class (e.g., text-blue-500)
  bgClass: string // Tailwind background class (e.g., bg-blue-500/10)
  borderClass: string // Tailwind border class
  badgeVariant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info"
  headerVariant: string
  icon: LucideIcon
}

export const STATUSES: Record<StatusKey, StatusConfig> = {
  PENDING: {
    label: "Pending",
    color: "text-warning",
    bgClass: "bg-warning/10",
    borderClass: "border-warning/20",
    badgeVariant: "warning",
    headerVariant: "border-l-4 border-l-warning",
    icon: Clock,
  },
  VERIFIED: {
    label: "Verified",
    color: "text-success",
    bgClass: "bg-success/10",
    borderClass: "border-success/20",
    badgeVariant: "success",
    headerVariant: "border-l-4 border-l-success",
    icon: CheckCircle2,
  },
  APPROVED: {
    label: "Approved",
    color: "text-primary",
    bgClass: "bg-primary/10",
    borderClass: "border-primary/20",
    badgeVariant: "default", // primary is default
    headerVariant: "border-l-4 border-l-primary",
    icon: ShieldCheck,
  },
  DOWNLOADED: {
    label: "Downloaded",
    color: "text-info",
    bgClass: "bg-info/10",
    borderClass: "border-info/20",
    badgeVariant: "info",
    headerVariant: "border-l-4 border-l-info",
    icon: Download,
  },
  DELETED: {
    label: "Deleted",
    color: "text-destructive",
    bgClass: "bg-destructive/10",
    borderClass: "border-destructive/20",
    badgeVariant: "destructive",
    headerVariant: "border-l-4 border-l-destructive",
    icon: Trash2,
  },
  REQUESTED: {
    label: "Requested",
    color: "text-warning",
    bgClass: "bg-warning/10",
    borderClass: "border-warning/20",
    badgeVariant: "warning",
    headerVariant: "border-l-4 border-l-warning",
    icon: FileQuestion,
  },
  CONFIRMED: {
    label: "Confirmed",
    color: "text-success",
    bgClass: "bg-success/10",
    borderClass: "border-success/20",
    badgeVariant: "success",
    headerVariant: "border-l-4 border-l-success",
    icon: Check,
  },
  REJECTED: {
    label: "Rejected",
    color: "text-destructive",
    bgClass: "bg-destructive/10",
    borderClass: "border-destructive/20",
    badgeVariant: "destructive",
    headerVariant: "border-l-4 border-l-destructive",
    icon: XCircle,
  },
  PRINTED: {
    label: "Printed",
    color: "text-info",
    bgClass: "bg-info/10",
    borderClass: "border-info/20",
    badgeVariant: "info",
    headerVariant: "border-l-4 border-l-info",
    icon: Printer,
  },
}
