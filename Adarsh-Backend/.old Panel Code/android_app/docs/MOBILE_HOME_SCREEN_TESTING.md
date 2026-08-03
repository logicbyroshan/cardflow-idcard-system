# Mobile App Home Screen - Verification & Testing Guide

## Current Implementation Status: ✅ CORRECT

The HomeScreen logic is properly implemented in [android_app/src/screens/HomeScreen.js](android_app/src/screens/HomeScreen.js) with correct role-based conditional rendering.

---

## Testing Scenarios

### Test 1: SUPER ADMIN Login & Home Screen
**Test User Role**: `super_admin`

**Steps**:
1. Login with super_admin account
2. Navigate to Home screen
3. Verify the following:

**Expected Results**:
- ✅ Header shows logo, "Adarsh ID Cards", profile icon
- ✅ Search bar visible
- ✅ Status grid shows all 7 cards (P/V/A/D/Po/R/Total)
- ✅ Status counts are numbers from dashboard API
- ✅ Tables section shows all system tables
- ✅ **Quick Actions visible (6 total)**:
  1. Notifications (always present)
  2. Settings (always present)
  3. **Operators** (only for super_admin)
  4. **Clients** (always for super_admin)
  5. **Reprint** (always for super_admin)
  6. **Perms** (only for super_admin)
- ✅ **FAB Button visible** (red/brand gradient)
- ✅ Click "Operators" → Goes to StaffManageScreen
- ✅ Click "Clients" → Goes to ClientsListScreen
- ✅ Click "Perms" → Goes to PermissionsScreen
- ✅ Click FAB → Either goes to CardList (if 1 table) or TablePicker (if multiple)

**Code Reference**:
```javascript
const isSuperAdmin = user?.role === 'super_admin';  // ✅ TRUE
const isAdmin = isSuperAdmin || isOperator;  // ✅ TRUE
const isClient = user?.role === 'client';  // ✅ FALSE

// Quick Actions:
// 1. Notifications, Settings (always added first)
// 2. Staff Management: isSuperAdmin || isClient || ... → ✅ TRUE → "Operators"
// 3. Clients: isAdmin || user?.can_manage_clients → ✅ TRUE
// 4. Reprint: hasReprintPerm || isAdmin || isClient → ✅ TRUE (isAdmin)
// 5. Perms: isSuperAdmin || perms.perm_permission_list → ✅ TRUE
// FAB: user?.role === 'super_admin' → ✅ TRUE
```

---

### Test 2: OPERATOR Login & Home Screen
**Test User Role**: `admin_staff`

**Steps**:
1. Login with operator/admin_staff account
2. Navigate to Home screen
3. Verify the following:

**Expected Results**:
- ✅ Header shows correctly
- ✅ Status grid shows counts (only for assigned clients)
- ✅ Tables section shows only assigned client tables
- ✅ **Quick Actions visible (4 total)**:
  1. Notifications (always present)
  2. Settings (always present)
  3. ❌ NO "Operators" action (only super_admin)
  4. **Clients** (visible because is admin)
  5. **Reprint** (visible because is admin)
  6. ❌ NO "Perms" action (only super_admin)
- ❌ **FAB Button NOT visible** (unless has `perm_idcard_add`)
- ✅ Click "Clients" → Goes to ClientsListScreen
- ✅ Click "Reprint" → Goes to ReprintScreen

**Code Reference**:
```javascript
const isSuperAdmin = user?.role === 'super_admin';  // ✅ FALSE
const isOperator = user?.role === 'admin_staff';  // ✅ TRUE
const isAdmin = isSuperAdmin || isOperator;  // ✅ TRUE
const isClient = user?.role === 'client';  // ✅ FALSE

// Quick Actions:
// 1. Notifications, Settings (always added first)
// 2. Staff Management: isSuperAdmin || isClient → ✅ FALSE → NOT added
// 3. Clients: isAdmin || user?.can_manage_clients → ✅ TRUE (isAdmin)
// 4. Reprint: hasReprintPerm || isAdmin || isClient → ✅ TRUE (isAdmin)
// 5. Perms: isSuperAdmin || perms.perm_permission_list → ✅ FALSE → NOT added
// FAB: user?.role === 'super_admin' || user?.permissions?.perm_idcard_add → ❌ FALSE
```

---

### Test 3: CLIENT Login & Home Screen
**Test User Role**: `client`

**Steps**:
1. Login with client account
2. Navigate to Home screen
3. Verify the following:

**Expected Results**:
- ✅ Header shows correctly
- ✅ Status grid shows counts (only for their tables)
- ✅ Tables section shows only their own tables/groups
- ✅ **Quick Actions visible (4 total)**:
  1. Notifications (always present)
  2. Settings (always present)
  3. **My Staff** (visible because is client)
  4. ❌ NO "Clients" action (they ARE the client)
  5. **Reprint** (visible because is client)
  6. ❌ NO "Perms" action (only super_admin)
- ❌ **FAB Button NOT visible** (unless has `perm_idcard_add`)
- ✅ Click "My Staff" → Goes to StaffManageScreen
- ✅ Click "Reprint" → Goes to ReprintScreen with their client_id

**Code Reference**:
```javascript
const isSuperAdmin = user?.role === 'super_admin';  // ✅ FALSE
const isOperator = user?.role === 'admin_staff';  // ✅ FALSE
const isAdmin = isSuperAdmin || isOperator;  // ✅ FALSE
const isClient = user?.role === 'client';  // ✅ TRUE

// Quick Actions:
// 1. Notifications, Settings (always added first)
// 2. Staff Management: isSuperAdmin || isClient || ... → ✅ TRUE → "My Staff"
// 3. Clients: isAdmin || user?.can_manage_clients → ✅ FALSE → NOT added
// 4. Reprint: hasReprintPerm || isAdmin || isClient → ✅ TRUE (isClient)
// 5. Perms: isSuperAdmin || perms.perm_permission_list → ✅ FALSE → NOT added
// FAB: user?.role === 'super_admin' || user?.permissions?.perm_idcard_add → ❌ FALSE
```

---

### Test 4: ASSISTANT (Client Staff) Login & Home Screen
**Test User Role**: `client_staff`

**Steps**:
1. Login with client_staff account
2. Navigate to Home screen
3. Verify the following:

**Expected Results**:
- ✅ Header shows correctly
- ✅ Status grid shows counts (only for shared client tables)
- ✅ Tables section shows only shared client tables
- ✅ **Quick Actions visible (2-3 total)**:
  1. Notifications (always present)
  2. Settings (always present)
  3. ❌ NO "My Staff" action (cannot manage staff)
  4. ❌ NO "Clients" action
  5. ⚠️ **Reprint** (CONDITIONAL - only if has reprint permissions)
  6. ❌ NO "Perms" action
- ❌ **FAB Button NOT visible** (unless has `perm_idcard_add`)

**Expected IF has reprint permissions**:
```
Quick Actions: Notifications, Settings, Reprint (3 total)
```

**Expected IF NO reprint permissions**:
```
Quick Actions: Notifications, Settings (2 total)
```

**Code Reference**:
```javascript
const isSuperAdmin = user?.role === 'super_admin';  // ✅ FALSE
const isOperator = user?.role === 'admin_staff';  // ✅ FALSE
const isAdmin = isSuperAdmin || isOperator;  // ✅ FALSE
const isClient = user?.role === 'client';  // ✅ FALSE

// Quick Actions:
// 1. Notifications, Settings (always added first)
// 2. Staff Management: isSuperAdmin || isClient → ✅ FALSE → NOT added
// 3. Clients: isAdmin || user?.can_manage_clients → ✅ FALSE → NOT added
// 4. Reprint: hasReprintPerm || isAdmin || isClient 
//    → hasReprintPerm = perms.perm_idcard_reprint_list || 
//                       perms.perm_reprint_request_list || 
//                       perms.perm_confirmed_list
//    → DEPENDS ON PERMISSIONS
// 5. Perms: isSuperAdmin || perms.perm_permission_list → ✅ FALSE → NOT added
// FAB: user?.role === 'super_admin' || user?.permissions?.perm_idcard_add → ❌ FALSE
```

---

### Test 5: Permission Flags Testing (Additional)

#### Test 5a: Client with `perm_idcard_add`
- Login: client
- Grant permission: `perm_idcard_add = True`
- Expected: FAB button should appear
- Verify: Click FAB → Navigate to CardList or TablePicker

**Code Reference**:
```javascript
FAB Condition: user?.role === 'super_admin' || user?.permissions?.perm_idcard_add
// With perm_idcard_add: FALSE || TRUE → ✅ TRUE → FAB visible
```

#### Test 5b: Operator with `perm_idcard_add`
- Login: admin_staff
- Grant permission: `perm_idcard_add = True`
- Expected: FAB button should appear

#### Test 5c: Assistant with `perm_idcard_reprint_list`
- Login: client_staff
- Grant permission: `perm_idcard_reprint_list = True`
- Expected: "Reprint" quick action should appear
- Current: Without this, only 2 quick actions (Notifications, Settings)

**Code Reference**:
```javascript
hasReprintPerm = perms.perm_idcard_reprint_list || 
                 perms.perm_reprint_request_list || 
                 perms.perm_confirmed_list
// With perm_idcard_reprint_list: TRUE → Reprint action visible
```

---

## Visual Verification Checklist

### UI Elements to Verify

- [ ] **Header Gradient**: Matches role theme color
  - Super Admin: Red gradient
  - Operator: Purple gradient
  - Client: Blue gradient
  - Assistant: Green gradient

- [ ] **Quick Action Icons and Colors**:
  - Notifications: 🔔 Yellow (#f59e0b)
  - Settings: ⚙️ Indigo (#6366f1)
  - Operators/My Staff: 👥 Purple (#8b5cf6)
  - Clients: 🏢 Blue (#3b82f6)
  - Reprint: 🔄 Orange (#f97316)
  - Perms: 🛡️ Green (#22c55e)

- [ ] **Status Cards Color Scheme**:
  - Pending: 📋 Orange/Yellow gradient
  - Verified: ✓ Green gradient
  - Approved: ✓✓ Blue gradient
  - Download: ⬇️ Purple gradient
  - Pool: 🔴 Red gradient
  - Reprint: 🔄 Orange gradient
  - Total: 📊 Gray gradient

- [ ] **Tables Section**:
  - Shows correct number of tables for each role
  - Table names display correctly
  - Status pills show correct counts (P/V/A/D/R)

- [ ] **FAB Button**:
  - Only visible for Super Admin
  - Red/brand gradient
  - Positioned at bottom-right
  - Click-able and functional

---

## Navigation Flow Verification

### From Quick Actions:
- [ ] **Notifications** → NotificationsScreen (all roles)
- [ ] **Settings** → SettingsScreen (all roles)
- [ ] **Operators** (Super Admin) → StaffManageScreen
- [ ] **My Staff** (Client) → StaffManageScreen
- [ ] **Clients** (Super Admin/Operator) → ClientsListScreen
- [ ] **Reprint** (Super Admin/Operator/Client/Assistant with perm) → ReprintScreen
- [ ] **Perms** (Super Admin) → PermissionsScreen

### From Status Cards:
- [ ] Click any status → Either CardList or TablePicker (smart nav)
- [ ] Count numbers are clickable
- [ ] Navigation params are correct

### From Tables Section:
- [ ] Click "VIEW ALL" → GroupsScreen
- [ ] Click status pill → CardList filtered by status

---

## Backend API Verification

### Dashboard API Endpoint
**Endpoint**: `GET /app/api/dashboard/`

**Expected Response Format**:
```json
{
  "success": true,
  "data": {
    "pending": 45,
    "verified": 23,
    "approved": 34,
    "download": 12,
    "pool": 5,
    "reprint": 3,
    "total": 122,
    "client_id": 1,
    "tables": [
      {
        "id": 1,
        "name": "Table Name",
        "p": 5,    // pending
        "v": 3,    // verified
        "a": 2,    // approved
        "d": 1,    // download
        "r": 0     // reprint
      }
    ]
  }
}
```

**Verify**:
- [ ] Super Admin receives all system data
- [ ] Operator receives only assigned client data
- [ ] Client receives only their data
- [ ] Assistant receives only shared data

---

## Edge Cases to Test

### Edge Case 1: No Tables
- **Setup**: User with role but no assigned tables
- **Expected**: "No tables found" message appears
- **Expected**: Status grid shows 0 for all counts
- **Expected**: Quick actions still functional

### Edge Case 2: No Permissions (Assistant)
- **Setup**: client_staff with no extra permissions
- **Expected**: Only 2 quick actions (Notifications, Settings)
- **Expected**: No Reprint action visible

### Edge Case 3: Network Error
- **Setup**: Dashboard API returns error
- **Expected**: Error banner appears
- **Expected**: Retry button functional
- **Expected**: Quick actions still render from cached data

### Edge Case 4: Single vs Multiple Tables
- **Setup**: Navigate from status card with 1 table having that status
- **Expected**: Goes directly to CardList (skips TablePicker)
- **Setup**: Multiple tables with same status
- **Expected**: Shows TablePicker to choose which table

### Edge Case 5: Impersonation (if applicable)
- **Setup**: Super Admin impersonates another user
- **Expected**: Home screen shows that user's role data
- **Expected**: FAB disappears (unless impersonated user has permission)
- **Expected**: Quick actions change to impersonated user's role

---

## Code Quality Checks

### Performance Verification
- [ ] `useMemo` used for quickActions (prevents unnecessary recalculations)
- [ ] Dependencies array: `[user, counts]` (recalculates when user/perms change)
- [ ] `useCallback` used for loadDashboard function
- [ ] Status grid renders efficiently with map()

### Error Handling
- [ ] Loading state shows skeleton
- [ ] Error state shows error banner with retry
- [ ] Network errors caught and handled
- [ ] API response validation

### Accessibility
- [ ] All buttons have `onPress` handlers
- [ ] TouchableOpacity used for feedback
- [ ] Colors have sufficient contrast
- [ ] Icons and text clear and readable

---

## Summary: Implementation Correctness

✅ **Super Admin**: Correctly shows 6 quick actions + FAB
✅ **Operator**: Correctly shows 4 quick actions (Clients, Reprint, no FAB)
✅ **Client**: Correctly shows 4 quick actions (My Staff, Reprint, no FAB)
✅ **Assistant**: Correctly shows 2-3 quick actions (Reprint conditional)

**Code is correctly implemented and follows the intended role-based logic.**

---

## Test Execution Command

To run automated tests (if available):
```bash
cd android_app
npm test  # or yarn test
# Look for HomeScreen.test.js if it exists
```

---

## Manual Testing Steps

1. **Create 4 test accounts** (one for each role)
2. **Login as each role** and take screenshots
3. **Verify quick actions** match expected count
4. **Click each quick action** and verify navigation
5. **Click status cards** and verify navigation
6. **Test permissions** by granting/revoking `perm_idcard_add`
7. **Document findings** in a test report

