# Mobile App Home Screen - What Each Role Sees

## Overview
The mobile app home screen is role-based with dynamic quick actions. Here's exactly what each user type (Super Admin, Operator, Client, Assistant) will see.

---

## 🔴 SUPER ADMIN (super_admin)
### Theme: Red/Crimson (#f43f5e → #e11d48)
### Access Level: System Administrator - Full Access

#### What They See:
```
┌─────────────────────────────────────┐
│  [LOGO]  Adarsh ID Cards  [PROFILE]│
└─────────────────────────────────────┘
│ 🔍 Search for cards, names, numbers...│
├─────────────────────────────────────┤
│          STATUS GRID (3x2)           │
│ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│ │   📋 P  │ │   ✓ V  │ │   ✓✓ A │ │
│ │    127  │ │    45  │ │    89  │ │
│ │ PENDING │ │VERIFIED│ │APPROVED│ │
│ └──────────┘ └──────────┘ └────────┘ │
│ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│ │   ⬇️ D  │ │   🔴 Po  │ │   🔄 R │ │
│ │     34  │ │     12  │ │     8  │ │
│ │DOWNLOAD │ │  POOL  │ │ REPRINT│ │
│ └──────────┘ └──────────┘ └────────┘ │
├─────────────────────────────────────┤
│     MY GROUPS/TABLES      [VIEW ALL] │
│ ┌─────────────────────────────────┐ │
│ │ 📋 Table 1                      │ │
│ │ [PEN:5] [VER:3] [APP:2] ...     │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│         QUICK ACTIONS               │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐│
│ │  🔔  │ │  ⚙️  │ │  👥 │ │  🏢 ││
│ │ Notif│ │ Settn│ │ Oper│ │Cltns││
│ └──────┘ └──────┘ └──────┘ └──────┘│
│ ┌──────┐ ┌──────┐                   │
│ │  🔄  │ │  🛡️  │                   │
│ │Reprnt│ │ Perms│                   │
│ └──────┘ └──────┘                   │
├─────────────────────────────────────┤
│         [+] FAB (Add Card) ✅       │
└─────────────────────────────────────┘
```

#### Quick Actions:
1. ✅ **Notifications** - View system notifications
2. ✅ **Settings** - App settings
3. ✅ **Operators** - Manage admin_staff users (Super Admin only)
4. ✅ **Clients** - Manage all clients
5. ✅ **Reprint** - Access all reprint requests
6. ✅ **Perms** - Manage permissions

#### FAB Button: ✅ YES
- Can add cards to any table
- If 1 table: Goes directly to CardList with add mode
- If multiple tables: Shows TablePicker first

#### Status Grid: Full Access
- Sees all counts from system dashboard

#### Navigation: Can access all tables in the system

---

## 🟣 OPERATOR (admin_staff)
### Theme: Purple (#8b5cf6 → #7c3aed)
### Access Level: Staff Administrator - Limited to Assigned Clients

#### What They See:
```
┌─────────────────────────────────────┐
│  [LOGO]  Adarsh ID Cards  [PROFILE]│
└─────────────────────────────────────┘
│ 🔍 Search for cards, names, numbers...│
├─────────────────────────────────────┤
│          STATUS GRID (3x2)           │
│ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│ │   📋 P  │ │   ✓ V  │ │   ✓✓ A │ │
│ │     45  │ │    23  │ │    34  │ │
│ │ PENDING │ │VERIFIED│ │APPROVED│ │
│ └──────────┘ └──────────┘ └────────┘ │
│ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│ │   ⬇️ D  │ │   🔴 Po  │ │   🔄 R │ │
│ │     12  │ │      5  │ │      3  │ │
│ │DOWNLOAD │ │  POOL  │ │ REPRINT│ │
│ └──────────┘ └──────────┘ └────────┘ │
├─────────────────────────────────────┤
│     MY GROUPS/TABLES      [VIEW ALL] │
│ ┌─────────────────────────────────┐ │
│ │ 📋 Assigned Client Table 1      │ │
│ │ [PEN:5] [VER:3] [APP:2] ...     │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│         QUICK ACTIONS               │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐│
│ │  🔔  │ │  ⚙️  │ │  🏢 │ │  🔄 ││
│ │ Notif│ │ Settn│ │Cltns│ │Reprnt││
│ └──────┘ └──────┘ └──────┘ └──────┘│
└─────────────────────────────────────┘
(No FAB button)
```

#### Quick Actions:
1. ✅ **Notifications** - View notifications
2. ✅ **Settings** - App settings
3. ❌ **Operators** - NOT visible (only Super Admin manages operators)
4. ✅ **Clients** - Manage assigned clients
5. ✅ **Reprint** - Access reprint requests
6. ❌ **Perms** - NOT visible (Super Admin only)

#### FAB Button: ❌ NO
- Unless specifically granted `perm_idcard_add` permission
- Cannot add cards directly

#### Status Grid: Limited
- Only shows counts for their assigned clients' tables

#### Navigation: Only accessible tables assigned to this operator

---

## 🔵 CLIENT (client)
### Theme: Blue (#3b82f6 → #2563eb)
### Access Level: Business Account Owner - Their Tables Only

#### What They See:
```
┌─────────────────────────────────────┐
│  [LOGO]  Adarsh ID Cards  [PROFILE]│
└─────────────────────────────────────┘
│ 🔍 Search for cards, names, numbers...│
├─────────────────────────────────────┤
│          STATUS GRID (3x2)           │
│ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│ │   📋 P  │ │   ✓ V  │ │   ✓✓ A │ │
│ │     78  │ │    56  │ │    92  │ │
│ │ PENDING │ │VERIFIED│ │APPROVED│ │
│ └──────────┘ └──────────┘ └────────┘ │
│ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│ │   ⬇️ D  │ │   🔴 Po  │ │   🔄 R │ │
│ │     28  │ │      9  │ │      6  │ │
│ │DOWNLOAD │ │  POOL  │ │ REPRINT│ │
│ └──────────┘ └──────────┘ └────────┘ │
├─────────────────────────────────────┤
│     MY GROUPS/TABLES      [VIEW ALL] │
│ ┌─────────────────────────────────┐ │
│ │ 📋 Client Table 1               │ │
│ │ [PEN:5] [VER:3] [APP:2] ...     │ │
│ ├─────────────────────────────────┤ │
│ │ 📋 Client Table 2               │ │
│ │ [PEN:3] [VER:1] [APP:0] ...     │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│         QUICK ACTIONS               │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐│
│ │  🔔  │ │  ⚙️  │ │  👥 │ │  🔄 ││
│ │ Notif│ │ Settn│ │Staff│ │Reprnt││
│ └──────┘ └──────┘ └──────┘ └──────┘│
└─────────────────────────────────────┘
(No FAB button)
```

#### Quick Actions:
1. ✅ **Notifications** - View notifications
2. ✅ **Settings** - App settings
3. ✅ **My Staff** - Manage client_staff users (their staff only)
4. ❌ **Clients** - NOT visible (they ARE the client)
5. ✅ **Reprint** - Access their reprint requests
6. ❌ **Perms** - NOT visible

#### FAB Button: ❌ NO
- Unless specifically granted `perm_idcard_add` permission
- Cannot add cards directly

#### Status Grid: Their Tables Only
- Only shows counts for their own tables/groups

#### Navigation: Only their own tables

---

## 🟢 ASSISTANT (client_staff)
### Theme: Green (#10b981 → #059669)
### Access Level: Client Staff - Shared Permissions from Client

#### What They See:
```
┌─────────────────────────────────────┐
│  [LOGO]  Adarsh ID Cards  [PROFILE]│
└─────────────────────────────────────┘
│ 🔍 Search for cards, names, numbers...│
├─────────────────────────────────────┤
│          STATUS GRID (3x2)           │
│ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│ │   📋 P  │ │   ✓ V  │ │   ✓✓ A │ │
│ │     12  │ │     8  │ │    15  │ │
│ │ PENDING │ │VERIFIED│ │APPROVED│ │
│ └──────────┘ └──────────┘ └────────┘ │
│ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│ │   ⬇️ D  │ │   🔴 Po  │ │   🔄 R │ │
│ │      4  │ │      2  │ │      1  │ │
│ │DOWNLOAD │ │  POOL  │ │ REPRINT│ │
│ └──────────┘ └──────────┘ └────────┘ │
├─────────────────────────────────────┤
│     MY GROUPS/TABLES      [VIEW ALL] │
│ ┌─────────────────────────────────┐ │
│ │ 📋 Shared Table (Read-Only?)    │ │
│ │ [PEN:2] [VER:1] [APP:3] ...     │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│         QUICK ACTIONS               │
│ ┌──────┐ ┌──────┐ ┌──────┐          │
│ │  🔔  │ │  ⚙️  │ │  🔄 │ (if perm)│
│ │ Notif│ │ Settn│ │Reprnt│          │
│ └──────┘ └──────┘ └──────┘          │
└─────────────────────────────────────┘
(No FAB button)
```

#### Quick Actions:
1. ✅ **Notifications** - View notifications
2. ✅ **Settings** - App settings
3. ❌ **My Staff** - NOT visible (cannot manage other staff)
4. ❌ **Clients** - NOT visible
5. ⚠️ **Reprint** - CONDITIONAL (only if has permission):
   - `perm_idcard_reprint_list` OR
   - `perm_reprint_request_list` OR
   - `perm_confirmed_list`
6. ❌ **Perms** - NOT visible

#### FAB Button: ❌ NO
- Unless specifically granted `perm_idcard_add` permission
- Cannot add cards directly

#### Status Grid: Shared/Limited
- Only shows counts for tables they have access to

#### Navigation: Only shared client tables (with appropriate permissions)

---

## Comparison Table

| Feature | Super Admin | Operator | Client | Assistant |
|---------|------------|----------|--------|-----------|
| **Theme** | Red 🔴 | Purple 🟣 | Blue 🔵 | Green 🟢 |
| **Notifications** | ✅ | ✅ | ✅ | ✅ |
| **Settings** | ✅ | ✅ | ✅ | ✅ |
| **Operators** | ✅ | ❌ | ❌ | ❌ |
| **Clients** | ✅ | ✅ | ❌ | ❌ |
| **My Staff/Operators** | Operators | ❌ | My Staff | ❌ |
| **Reprint** | ✅ | ✅ | ✅ | ⚠️ (perms) |
| **Permissions** | ✅ | ❌ | ❌ | ❌ |
| **FAB (Add Button)** | ✅ | ⚠️ (perm) | ⚠️ (perm) | ⚠️ (perm) |
| **Access Scope** | All system | Assigned clients | Own tables | Client's tables |

---

## Quick Actions Details

### Navigation Destinations:
- **Notifications** → NotificationsScreen
- **Settings** → SettingsScreen
- **Operators/My Staff** → StaffManageScreen
- **Clients** → ClientsListScreen
- **Reprint** → ReprintScreen
- **Perms** → PermissionsScreen

### Smart Navigation:
- **Status Cards**: Click any status to filter cards
  - If only 1 table has that status → Goes directly to CardList
  - If multiple tables → Shows TablePicker first
  
- **FAB Button**: Add new card
  - If only 1 table → Direct to CardList with `showAdd: true`
  - If multiple tables → Shows TablePicker with `action: 'add'`

---

## Testing Checklist

To verify all 4 roles work correctly:

- [ ] **Super Admin**: All 6 quick actions visible, FAB present, see all tables/counts
- [ ] **Operator**: Only Notifications, Settings, Clients, Reprint (4 actions), no FAB unless granted perm
- [ ] **Client**: Notifications, Settings, My Staff, Reprint (4 actions), no FAB unless granted perm
- [ ] **Assistant**: At least Notifications & Settings, Reprint only if permitted, no FAB unless granted perm
- [ ] **Status Grid**: All roles see correct counts based on their table access
- [ ] **Quick Action Clicks**: Navigate to correct screens
- [ ] **FAB**: Only Super Admin can see and use (or users with perm_idcard_add)
- [ ] **Tables Section**: Each role sees only their accessible tables
- [ ] **Profile Icon**: Click to navigate to ProfileScreen for all roles
- [ ] **Search Bar**: Visible but navigation handled separately

---

## Permission Dependencies

```
Super Admin (super_admin) role → Full Access (no extra permissions needed)

Operator (admin_staff) role:
├── Clients action → Automatic (is admin)
├── Reprint action → Automatic (is admin)
└── FAB Button → Needs perm_idcard_add

Client (client) role:
├── My Staff action → Automatic (is client) OR perm_manage_client_staff
├── Reprint action → Automatic (is client)
└── FAB Button → Needs perm_idcard_add

Assistant (client_staff) role:
├── Reprint action → perm_idcard_reprint_list OR perm_reprint_request_list OR perm_confirmed_list
└── FAB Button → Needs perm_idcard_add
```

---

## API Endpoint Used
- **GET /app/api/dashboard/** - Returns card counts and tables list
  - Response includes: `{ pending, verified, approved, download, pool, reprint, total, tables: [] }`
  - Filtered by user's role and permissions automatically by backend

---

## Known Implementation Details

1. **Role Themes**: Each role has distinct color theme for visual differentiation
2. **Dynamic Quick Actions**: Built using useMemo to recalculate when user/permissions change
3. **Smart Status Navigation**: Optimized UX to skip table picker if only 1 table has status
4. **FAB Visibility**: Controlled by `super_admin` role OR `perm_idcard_add` permission
5. **Reprint Conditional**: Assistant role only sees Reprint if they have specific permissions
