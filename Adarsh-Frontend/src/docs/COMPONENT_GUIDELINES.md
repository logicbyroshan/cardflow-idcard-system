# Component Guidelines

To maintain consistency and durability, adhere to these rules when creating or using React components.

## 1. Wrapping Shadcn Primitives
* Never import and use raw Radix or raw Shadcn primitives directly inside feature folders.
* All UI primitives reside in `src/components/ui/` and must support our specific design tokens (e.g., Saira Condensed font, custom border radii, and background states).
* Add custom hooks or properties (like `isLoading` in `Button.tsx`) to the base UI primitives to make features simpler to write.
* **Button labels & Badges**: Must use uppercase lettering (`text-button uppercase` / `text-badge uppercase`).

## 2. Reusable Form Wrappers
* Form inputs must wrap hook form registration and validation logic.
* Use `FormInput`, `FormSelect`, `FormTextarea`, `FormCheckbox`, and `FormSwitch` from `src/components/forms/`.
* They automatically listen to the active `FormProvider` context, validate using Zod, and render helper/error messages.
* Form layout elements should use a tight `space-y-1` scale rather than large gaps.

## 3. Data Tables & Grids
* Tables should use `@tanstack/react-table` models.
* Use `BaseTable` for rendering rows and virtualization.
* Use `TableToolbar` for searches and filter controls.
* Use `TablePagination` for dense pagination selectors.
* **Table Alignment**: Center headers and cells for fixed-width columns (Class, Section, Status, Dates, Numbers) and left-align headers and cells for variable-width columns (Names, Addresses, Descriptions). Ensure headers match cell alignments dynamically using the `getColumnAlignment` utility.
* **Table Density**: Header/cell padding must use a dense `py-1.5 px-2` spacing with the `text-table` typography class.

## 4. Layout Stacking & Panels
* Do not separate layout panels or sections using margin gaps.
* Stack sections inside a single container using `divide-y divide-border border border-border bg-panel`.
* Internal spacing should exist entirely within each section as padding (e.g., `p-4`), ensuring zero space is wasted.

## 5. Height System & Control Alignment
* Ensure all interactive controls (buttons, inputs, select triggers, search bars, pagination controls, badges) share a unified height system:
  * Small: `h-6` (24px)
  * Medium (Default): `h-8` (32px)
  * Large: `h-10` (40px)
* Select dropdown menus and dropdown list items must be compact (`py-1 text-xs`).

## 6. Separation of Concerns
* No inline business queries or database calls should exist inside presentation components.
* Business queries and mutations should be encapsulated in custom hooks within their respective feature folders.
