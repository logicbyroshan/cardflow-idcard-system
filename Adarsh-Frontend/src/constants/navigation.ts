import { 
  Users,
  UserCog,
  LayoutDashboard,
  Zap,
  Table,
  GitBranch,
  UploadCloud,
  DownloadCloud,
  Printer,
  Bell,
  Terminal,
  Cpu,
  Settings as SettingsIcon
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavigationItem {
  label: string
  path: string
  icon: LucideIcon
  roles: ('admin' | 'operator' | 'pro_user' | 'client' | 'assistant')[]
  submenu?: {
    label: string
    path: string
    roles: ('admin' | 'operator' | 'pro_user' | 'client' | 'assistant')[]
  }[]
}

export interface NavigationGroup {
  groupName: string
  items: NavigationItem[]
}

export const navigationConfig: NavigationGroup[] = [
  {
    groupName: 'USER MANAGEMENT',
    items: [
      {
        label: 'Manage Clients',
        path: '/management/roster',
        icon: Users,
        roles: ['admin', 'pro_user']
      },
      {
        label: 'Manage Operators',
        path: '/management/staff',
        icon: UserCog,
        roles: ['admin', 'pro_user']
      }
    ]
  },
  {
    groupName: 'SITE MANAGEMENT',
    items: [
      {
        label: 'Manage Panel',
        path: '/dashboard',
        icon: LayoutDashboard,
        roles: ['admin', 'operator', 'pro_user', 'client', 'assistant']
      },
      {
        label: 'Pro Features',
        path: '/pro',
        icon: Zap,
        roles: ['pro_user', 'admin']
      }
    ]
  },
  {
    groupName: 'ID CARD MANAGEMENT',
    items: [
      {
        label: 'Tables',
        path: '/tables/cards',
        icon: Table,
        roles: ['admin', 'operator', 'pro_user', 'assistant']
      },
      {
        label: 'Workflow',
        path: '/workflow',
        icon: GitBranch,
        roles: ['admin', 'operator', 'pro_user']
      },
      {
        label: 'Imports',
        path: '/imports',
        icon: UploadCloud,
        roles: ['admin', 'pro_user']
      },
      {
        label: 'Exports',
        path: '/exports',
        icon: DownloadCloud,
        roles: ['admin', 'pro_user']
      },
      {
        label: 'Reprints',
        path: '/reprints',
        icon: Printer,
        roles: ['admin', 'operator', 'pro_user', 'assistant']
      }
    ]
  },
  {
    groupName: 'OPERATIONS',
    items: [
      {
        label: 'Notifications',
        path: '/notifications',
        icon: Bell,
        roles: ['admin', 'operator', 'pro_user', 'client', 'assistant']
      },
      {
        label: 'Sandbox',
        path: '/sandbox',
        icon: Terminal,
        roles: ['admin', 'pro_user']
      },
      {
        label: 'Operations',
        path: '/operations',
        icon: Cpu,
        roles: ['admin', 'operator', 'pro_user']
      }
    ]
  },
  {
    groupName: 'SETTINGS',
    items: [
      {
        label: 'Settings',
        path: '/settings',
        icon: SettingsIcon,
        roles: ['admin', 'pro_user']
      }
    ]
  }
]

export default navigationConfig
