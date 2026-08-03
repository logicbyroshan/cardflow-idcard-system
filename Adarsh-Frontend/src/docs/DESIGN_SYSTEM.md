# Design System Specification

This document details the design tokens, layout constraints, and typography rules of the Adarsh ID platform.

## 1. Palette & Colors
The application operates in **Dark Mode Only** for low-fatigue operations.

* **Base Colors**:
  * Background: `#0A0A0A`
  * Sidebar: `#111111`
  * Panel: `#171717`
  * Border / Input: `#262626`
  * Text (Primary): `#FAFAFA`
  * Muted (Secondary): `#A3A3A3`

* **Semantic Accent Colors**:
  * Primary: Blue (`#2563EB`)
  * Success: Green (`#16A34A`)
  * Warning: Orange (`#EA580C`)
  * Danger: Red (`#EF4444`)
  * Info: Purple (`#7C3AED`)

## 2. Typography
All elements must use the **Saira Condensed** font. The typography follows a strict high-density scale:
* **Heading**: 20px uppercase bold (Maximum size)
  * CSS Class: `.text-heading`
* **SubHeading**: 16px uppercase semi-bold
  * CSS Class: `.text-subheading`
* **Body**: 14px normal
  * CSS Class: `.text-body`
* **Table**: 12px medium
  * CSS Class: `.text-table`
* **Badge**: 10px uppercase bold (spaced)
  * CSS Class: `.text-badge`
* **Button**: 12px uppercase bold
  * CSS Class: `.text-button`
* **Caption**: 10px normal (muted)
  * CSS Class: `.text-caption`

## 3. Spacing Scale
We enforce a dense layout with limited padding/margin keys:
* `0` = 0px
* `2` = 2px
* `4` = 4px
* `8` = 8px
* `12` = 12px
* `16` = 16px

Large blank spaces or gaps between panels are strictly forbidden. Padding should exist entirely **inside** sections. Separate panels using 1px borders (`border-border`) and dividers/rules (`divide-y divide-border`) rather than gaps/margins.

## 4. Radius Policy
* Tables: `0` (squared corners for high density)
* Inputs: `4px`
* Buttons: `4px`
* Cards / Panels: `8px`
* Dialogs / Modals: `8px`
* Toggles / Switch: `rounded-sm` / `2px` (subtle radius matching design language)

## 5. Height System
A unified vertical height system aligns all primary controls:
* **Small**: `h-6` (24px) - For small badges, compact buttons
* **Medium (Default)**: `h-8` (32px) - For standard buttons, text inputs, select triggers, toolbar search, pagination buttons
* **Large**: `h-10` (40px) - For large layout headers, topbar, sidebar title, and primary buttons

## 6. Icon Usage Policy
To maximize screen density and reduce visual noise:
* **No icons inside status badges**: Status must be represented only by color, label, and border.
* **Reduce icons globally**: Avoid icons in small action chips, dense table cells, and compact toolbars unless genuinely necessary.

## 7. Table Alignment System
To ensure scannability and structural alignment:
* **Center-align** headers and cell contents for fixed-width columns (Class, Section, Gender, Status, Date, Time, Roll Number, Phone, Count, IDs, short codes, and numeric fields).
* **Left-align** headers and cell contents for variable-width columns (Name, Address, Description, Remarks, Organization, Client).
* Dynamically determined via the reusable `getColumnAlignment` utility.
