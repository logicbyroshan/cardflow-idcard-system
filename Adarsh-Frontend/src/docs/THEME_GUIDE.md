# Theme Guide

This document is a quick-start reference for styling and designing new pages to fit the Adarsh brand guidelines.

## 1. Tailwind Color Classes
Only use Tailwind utility classes mapping to design system variables:

| CSS Variable | Tailwind Class | Usage |
|---|---|---|
| `--background` | `bg-background` | Whole page container background |
| `--sidebar` | `bg-sidebar` | Navigation sidebar background |
| `--panel` | `bg-panel` | Card, table rows, and dialogue container backgrounds |
| `--border` | `border-border` | Grids, dividing lines, inputs, and button borders |
| `--foreground`| `text-foreground` | Standard text content |
| `--muted` | `text-muted` | Descriptive subtexts, labels, and icons |

## 2. Accents
Color should only be applied when meaning exists. Do not use random colors or gradients.

* **Primary Action**: `text-primary` / `bg-primary` (Blue)
* **Approved / Confirmed state**: `text-success` (Green)
* **Pending / Warning state**: `text-warning` (Orange)
* **Danger / Rejected / Deleted state**: `text-destructive` (Red)
* **System Meta / Info state**: `text-info` (Purple)

## 3. Font Classes
Always apply typography helper classes for text styling (strictly bound within the 10px-20px scale):
* `.text-heading` (Large section title - 20px Max)
* `.text-subheading` (Sub-panel title - 16px)
* `.text-body` (Standard paragraph - 14px)
* `.text-table` (Inside table grids - 12px)
* `.text-badge` (Status badges - 10px, uppercase)
* `.text-button` (Button actions - 12px, uppercase)
* `.text-caption` (Helper subtext - 10px, muted)

## 4. ERP Grids & Layout Stack
* Use `divide-y divide-border` inside layout lists and sections.
* Use `border border-border` to wrap panels.
* Never use rounded corners beyond `rounded-md` (8px). Switch toggles must use `rounded-sm`.
* Avoid large padding values like `p-6` or `p-8` unless necessary. Favor `p-2` or `p-4` to maximize information density. Avoid margins or gaps between major layout sections.

## 5. Control Sizing & Spacing
* **Height Scale**: All interactive components (inputs, select triggers, search bars, buttons) must follow the standard vertical scale:
  * Small: `h-6` (24px)
  * Medium (Default): `h-8` (32px)
  * Large: `h-10` (40px)
* **Button/Badge Padding Ratio**: Buttons and badges must have horizontal padding approximately 25% larger than their vertical spacing.
* **No icons inside status badges**: Status badges must rely only on background color, border color, and uppercase text.

## 6. Table Alignment Rules
* Center-align fixed-width data columns (ID, Status, Dates, Class, Section, Gender, Phone, Roll Numbers).
* Left-align variable-width data columns (Workspace, Name, Address, Description, Remarks).
* Dynamically fetch alignment configurations via the `getColumnAlignment` utility.
