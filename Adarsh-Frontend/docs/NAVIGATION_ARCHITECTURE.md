# Navigation Architecture Specifications

This document defines the structure, hierarchy, and security authorization matrix of the Adarsh ID Panel navigation layout.

---

## 1. Role-Based Access Matrix
Navigation menu items are strictly governed by static role permissions. The following matrix dictates item visibility in the Sidebar navigation:

| Menu Item | Admin | Operator | Pro User | Client | Assistant |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Dashboard** | Yes | Yes | Yes | Yes | Yes |
| **Management** | Yes | No | Yes | No | No |
| **Data Tables** | Yes | Yes | Yes | No | Yes |
| **Workflow** | Yes | Yes | Yes | No | No |
| **Imports** | Yes | No | Yes | No | No |
| **Exports** | Yes | No | Yes | No | No |
| **Notifications** | Yes | Yes | Yes | Yes | Yes |
| **Reprints Queue** | Yes | Yes | Yes | No | Yes |
| **Operations Engine**| Yes | Yes | Yes | No | No |
| **Sandbox Suite** | Yes | No | Yes | No | No |
| **Pro Platform** | No | No | Yes | No | No |
| **Settings** | Yes | No | Yes | No | No |

---

## 2. Configuration Schema
The menu structure is located in [navigation.ts](file:///c:/Users/iamro/Desktop/Adarsh-ID-Panel/Adarsh-Frontend/src/constants/navigation.ts).
Each node satisfies the `NavigationItem` interface:

```typescript
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
```

---

## 3. Submenu Collapsible States
Submenu folders in the Sidebar expand vertically on-click, animating downward to show child pages. Submenu paths are prefix-matched (`location.pathname.startsWith(item.path)`) to retain active parent highlighting.
