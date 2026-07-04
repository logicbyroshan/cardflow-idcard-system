# Adarsh ID System Theme & Spacing Guide

This guide establishes the color systems, spacing tokens, and asset rules to maintain identity parity with existing production systems.

---

## 1. Dark-Mode Only Color Tokens

The theme is locked into a low-contrast dark-mode design system. The background is near-black, and panels are dark charcoal:

- **Canvas Background**: `#0A0A0A` (`hsl(0, 0%, 4%)`)
- **Panel/Card Surface**: `#171717` (`hsl(0, 0%, 9%)`)
- **Sidebar Surface**: `#111111` (`hsl(0, 0%, 7%)`)
- **Borders & Inputs**: `#262626` (`hsl(0, 0%, 15%)`)
- **Primary Accent**: `#2563EB` (`hsl(221.2, 83.2%, 53.3%)`)

---

## 2. Spacing & Whitespace Rules

Whitespace is treated as a premium constraint. We do not use large SaaS pad margins:

- **Outer Panel Padding**: **16px** (`p-4`)
- **Inner Form / Card Padding**: **12px** (`p-3`) or **8px** (`p-2`)
- **Form Gaps**: **12px** (`gap-3`) or **8px** (`gap-2`)
- **Panel Separation**: Use **1px solid `#262626` borders** instead of margins. Set `gap-0` on container groups to stick sections together.

---

## 3. Strict Icon Policy

To ensure high-density scannability and clean layout, we enforce a strict icon policy:

- **Meaningful Placement Only**: Icons are allowed only inside action button click triggers (e.g. `Plus` for "Add Card", `Trash` for "Delete") or navigation labels.
- **Remove Decorative Icons**: Do not add icons to status badges, text labels, or panel headers unless they act as active status toggles.
- **Badges**: Status badges must remain text-only, color-coded blocks (e.g., `APPROVED` is a blue block with white text, no leading checkbox icon).
