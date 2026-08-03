# Adarsh ID System Design System Guidelines

This document provides the strict visual specifications that govern all components, layouts, and panels on the Adarsh ID Panel platform.

---

## 1. Border Radius Rules

To match the operational, high-density aesthetics of the production software, rounded corners are constrained as follows:

| Element Type | Border Radius (px) | Tailwind Mapping class |
| :--- | :--- | :--- |
| **Tables** | `0px` | `rounded-none` |
| **Inputs** | `4px` | `rounded-md` |
| **Buttons** | `4px` | `rounded-md` |
| **Dropdowns** | `4px` | `rounded-md` |
| **Selects** | `4px` | `rounded-md` |
| **Cards** | `6px` | `rounded-lg` |
| **Dialogs / Drawers** | `6px` | `rounded-lg` |

> [!WARNING]
> Avoid larger radii classes like `rounded-xl` or `rounded-2xl` or standard tailwind `rounded-lg` (which defaults to 8px). 
> The Tailwind configuration has mapped `rounded-lg` to `6px` and `rounded-md` to `4px`.

---

## 2. Control Height Rules

Interactive controls are aligned to strict operational heights to ensure a dense, compact tabular layout:

| Size Variant | Target Height (px) | Tailwind Class | Usage Context |
| :--- | :--- | :--- | :--- |
| **Small** | `32px` | `h-8` | Table action buttons, tag inputs, mini pagination |
| **Medium** | `36px` | `h-9` | Standard inputs, search fields, standard page actions |
| **Large** | `40px` | `h-10` | Auth forms, wizard controls, large primary dialog actions |

---

## 3. Typography Hierarchies

All text utilizes the `Saira Condensed` font family. Scales are capped at a maximum of 20px and minimum of 10px to maintain high data density.

- **Page Title** (`.text-heading`): **20px** (Bold, Uppercase)
- **Section Title** (`.text-subheading`): **18px** (Semi-bold, Uppercase)
- **Body Text** (`.text-body`): **14px** (Regular)
- **Dense Table Cell** (`.text-table`): **12px** (Medium)
- **Buttons / Badges** (`.text-button` / `.text-badge`): **12px** (Bold, Uppercase)
- **Caption / Meta Text** (`.text-caption`): **10px** (Regular, muted foreground)

---

## 4. Centralized Branding Rules

No hardcoded SVG paths or image URLs are allowed in client screens. All components must read asset variables from the centralized context:

1. **Path**: `src/assets/branding/BrandConfig.tsx`
2. **Context Provider**: `src/components/brand/BrandProvider.tsx`
3. **Consumer Hook**: `useBrand()`

Supported Branding Assets:
- `Icon`: Compact emblem used in topbars and collapsed contexts.
- `AuthLogo`: Full horizontal emblem with uppercase typography.
- `LoadingLogo`: Special pulsing graphic for boot transitions.
