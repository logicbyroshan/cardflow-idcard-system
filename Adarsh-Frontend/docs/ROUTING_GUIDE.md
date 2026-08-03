# Routing & Page Layout Guide

This guide details the routing foundation and the layout shells available for rendering pages in the Adarsh ID Panel platform.

---

## 1. Route Map
All views are registered as child routes of `AppLayout` inside [AppRouter.tsx](file:///c:/Users/iamro/Desktop/Adarsh-ID-Panel/Adarsh-Frontend/src/app/router/AppRouter.tsx).

- `/` (Redirects to `/dashboard`)
- `/dashboard`: Renders standard analytical widgets (`DashboardLayout`).
- `/management`: Double-column records browser (`ManagementLayout`).
- `/tables`: High-density grid and roster tables (`TableLayout`).
- `/settings`: Split-panel system configurations trigger tab-page (`SettingsLayout`).
- All other utility routes: Render under a standard single-column wrapper (`StandardLayout`).

---

## 2. Shell Layout Variants
Developers should wrap their views in the appropriate layout wrapper inside `src/components/layout/variants/`:

- **`DashboardLayout`**: Use for charts, metrics, and high-level analytical boxes.
- **`TableLayout`**: Use for roster grids, providing slots for action toolbars and footer paginations.
- **`SettingsLayout`**: Use for complex forms and settings divided into tab menus.
- **`ManagementLayout`**: Use for master-detail pages (e.g. operators roster, staff management).
- **`StandardLayout`**: General-purpose centered container.

---

## 3. Development-Only Route
The `/design-lab` canvas path is nested under the shell and is only highlighted/linked in the sidebar in development mode:
```typescript
{import.meta.env.DEV && (
  // Render Design Lab Link in Sidebar
)}
```
