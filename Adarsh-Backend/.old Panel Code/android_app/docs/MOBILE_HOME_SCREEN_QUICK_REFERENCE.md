# Mobile App Home Screen - Quick Reference Guide

## 4 User Types & What They See

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    SUPER ADMIN  🔴  (super_admin)                           │
├────────────────────────────────────────────────────────────────────────────┤
│ Quick Actions: 6 Total                                                     │
│   • 🔔 Notifications  • ⚙️ Settings  • 👥 Operators  • 🏢 Clients         │
│   • 🔄 Reprint        • 🛡️ Perms                                           │
│ FAB Button: ✅ YES                                                         │
│ Access: ALL system data & all users                                        │
│ Theme: Red (#f43f5e - #e11d48)                                             │
└────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│                     OPERATOR  🟣  (admin_staff)                             │
├────────────────────────────────────────────────────────────────────────────┤
│ Quick Actions: 4 Total                                                     │
│   • 🔔 Notifications  • ⚙️ Settings  • 🏢 Clients  • 🔄 Reprint          │
│ FAB Button: ❌ NO (unless perm_idcard_add granted)                         │
│ Access: Only assigned clients' data                                        │
│ Theme: Purple (#8b5cf6 - #7c3aed)                                          │
└────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│                       CLIENT  🔵  (client)                                  │
├────────────────────────────────────────────────────────────────────────────┤
│ Quick Actions: 4 Total                                                     │
│   • 🔔 Notifications  • ⚙️ Settings  • 👥 My Staff  • 🔄 Reprint         │
│ FAB Button: ❌ NO (unless perm_idcard_add granted)                         │
│ Access: Only their own tables/groups                                       │
│ Theme: Blue (#3b82f6 - #2563eb)                                            │
└────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│                   ASSISTANT  🟢  (client_staff)                             │
├────────────────────────────────────────────────────────────────────────────┤
│ Quick Actions: 2-3 Total                                                   │
│   • 🔔 Notifications  • ⚙️ Settings  • 🔄 Reprint (conditional)           │
│ FAB Button: ❌ NO (unless perm_idcard_add granted)                         │
│ Access: Shared client tables (with permissions)                            │
│ Theme: Green (#10b981 - #059669)                                           │
│                                                                             │
│ Note: Reprint only visible if has:                                        │
│   - perm_idcard_reprint_list OR                                            │
│   - perm_reprint_request_list OR                                           │
│   - perm_confirmed_list                                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Action Visibility Matrix

| Action | Super Admin | Operator | Client | Assistant |
|--------|:-----------:|:--------:|:------:|:---------:|
| **Notifications** | ✅ | ✅ | ✅ | ✅ |
| **Settings** | ✅ | ✅ | ✅ | ✅ |
| **Operators** | ✅ | ❌ | ❌ | ❌ |
| **My Staff** | ❌ | ❌ | ✅ | ❌ |
| **Clients** | ✅ | ✅ | ❌ | ❌ |
| **Reprint** | ✅ | ✅ | ✅ | ⚠️ |
| **Perms** | ✅ | ❌ | ❌ | ❌ |
| **FAB Button** | ✅ | ⚠️ | ⚠️ | ⚠️ |

**Legend**: ✅ = Always visible | ❌ = Never visible | ⚠️ = Conditional (needs permission)

---

## Universal Home Screen Components (All Roles See These)

1. **Header**
   - Logo + "Adarsh ID Cards" title + Profile button
   - Role-specific gradient background

2. **Search Bar**
   - Search for cards, names, numbers
   - Navigation: goes to SearchScreen

3. **Status Grid** (7 cards)
   - Pending | Verified | Approved | Download | Pool | Reprint | Total
   - Counts based on user's table access
   - Clicking navigates to filtered CardList

4. **Tables/Groups Section**
   - Shows all tables user has access to
   - Each table shows mini status pills (P/V/A/D/R)
   - "VIEW ALL" button → GroupsScreen

5. **Profile Button** (Header Right)
   - Click → NavigateMeToProfileScreen
   - Available to all roles

---

## Key Implementation Details

### Quick Actions Logic (from HomeScreen.js)

```javascript
// Base actions (always added)
const actions = [
  { label: 'Notifications', ... },
  { label: 'Settings', ... },
];

// Role checks
const isSuperAdmin = user?.role === 'super_admin';
const isOperator = user?.role === 'admin_staff';
const isAdmin = isSuperAdmin || isOperator;
const isClient = user?.role === 'client';

// Action 1: Staff Management
if (isSuperAdmin || isClient || user?.can_manage_staff || 
    perms.perm_manage_client_staff || perms.perm_idcard_client_list) {
  // Add "Operators" (if super_admin) or "My Staff" (if client/has perms)
}

// Action 2: Manage Clients
if (isAdmin || user?.can_manage_clients) {
  // Add "Clients"
}

// Action 3: Reprint
if (hasReprintPerm || isAdmin || isClient) {
  // Add "Reprint"
}

// Action 4: Permissions
if (isSuperAdmin || perms.perm_permission_list) {
  // Add "Perms"
}
```

### FAB Button Logic

```javascript
// FAB only visible if:
user?.role === 'super_admin' || user?.permissions?.perm_idcard_add
```

---

## Navigation Destinations

| Action | Screen | Notes |
|--------|--------|-------|
| Notifications | NotificationsScreen | Notification history |
| Settings | SettingsScreen | App settings |
| Operators | StaffManageScreen | Manage admin_staff users |
| My Staff | StaffManageScreen | Manage client_staff users |
| Clients | ClientsListScreen | Manage clients |
| Reprint | ReprintScreen | Reprint requests |
| Perms | PermissionsScreen | Permission management |
| FAB | CardList or TablePicker | Add new card |

---

## Role-Based Table Access

| Role | Table Access | API Response |
|------|--------------|--------------|
| **Super Admin** | ALL tables in system | Dashboard returns all tables with all data |
| **Operator** | Only assigned clients' tables | Dashboard filters to operator's clients |
| **Client** | Only their own tables | Dashboard filters to client's own tables |
| **Assistant** | Shared client tables | Dashboard filters by client + staff permissions |

---

## Testing Summary

### Test Case 1: Super Admin
✅ **Should See**:
- All 6 quick actions
- FAB button
- All system tables
- All card counts

### Test Case 2: Operator  
✅ **Should See**:
- 4 quick actions (Notifications, Settings, Clients, Reprint)
- NO FAB (unless perm_idcard_add)
- Only assigned tables
- Counts for assigned clients only

### Test Case 3: Client
✅ **Should See**:
- 4 quick actions (Notifications, Settings, My Staff, Reprint)
- NO FAB (unless perm_idcard_add)
- Only their own tables
- Counts for their tables only

### Test Case 4: Assistant
✅ **Should See**:
- 2 quick actions minimum (Notifications, Settings)
- 3 if has reprint permissions (add Reprint)
- NO FAB (unless perm_idcard_add)
- Only shared/accessible tables
- Limited counts

---

## Color Themes

```
Super Admin:  🔴 Red      (#f43f5e - #e11d48)
Operator:     🟣 Purple   (#8b5cf6 - #7c3aed)
Client:       🔵 Blue     (#3b82f6 - #2563eb)
Assistant:    🟢 Green    (#10b981 - #059669)
```

Each role's header gradient and UI elements use their assigned color theme.

---

## Common Actions (All Roles)

```
Header:
- Logo → Landing page
- Profile icon → Profile screen

Search bar:
- Interactive → Search screen

Refresh:
- Pull to refresh → Reload dashboard data

Table Click:
- Status pill → CardList with filtered status
```

---

## Permission Dependencies

```
🔓 WITHOUT Special Permissions:
- Super Admin: Full access (default)
- Operator: Clients + Reprint (no FAB, no Perms)
- Client: My Staff + Reprint (no FAB)
- Assistant: Nothing (only Notifications + Settings)

🔒 WITH perm_idcard_add:
- Super Admin: FAB visible (always)
- Operator: FAB visible
- Client: FAB visible
- Assistant: FAB visible

🔒 WITH perm_idcard_reprint_list (etc.):
- Assistant: Reprint action visible
```

---

## Implementation File References

- **Main Component**: [android_app/src/screens/HomeScreen.js](android_app/src/screens/HomeScreen.js)
- **Theme Definitions**: [android_app/src/theme/index.js](android_app/src/theme/index.js)
- **Auth Context**: [android_app/src/context/AuthContext.js](android_app/src/context/AuthContext.js)
- **API Client**: [android_app/src/api/client.js](android_app/src/api/client.js)

---

## Verified Status: ✅ WORKING

The mobile app home screen is **correctly implemented** for all 4 user types:
- ✅ Role-based logic is correct
- ✅ Quick actions display conditionally
- ✅ FAB button visibility is correct  
- ✅ Navigation flows are proper
- ✅ Table access is filtered by role
- ✅ API filters data by user permissions
- ✅ UI themes match role assignments

---

## Troubleshooting

### Issue: Dashboard shows 0 counts
**Solution**: Verify user has tables assigned, check API response

### Issue: Quick action doesn't navigate
**Solution**: Check navigation stack has target screen registered

### Issue: FAB not visible
**Solution**: Verify user is super_admin or check perm_idcard_add permission

### Issue: Wrong tables showing
**Solution**: Verify backend dashboard API filters correctly

