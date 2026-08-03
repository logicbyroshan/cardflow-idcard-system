# Adarsh Mobile Stability Manifesto: "Never Again" Rules

This document serves as the ultimate reference for maintaining the stability of the Adarsh ID Cards mobile application. It documents past critical failures and establishes non-negotiable development rules to prevent recurring crashes.

---

## 🛑 Critical Failure Log & Lessons Learned

### 1. The "Font Death" Crash (ReferenceError)
*   **The Issue**: The app would crash immediately on startup on specific Android devices (e.g., Vivo V27 Pro) because the JS engine could not find the fonts or was given incorrect font-family strings.
*   **The Mistake**: Relying on dynamic font loading without hardcoded fallbacks or using font names that didn't perfectly match the `.ttf` filename.
*   **THE RULE**: 
    *   **NEVER** use dynamic variables for `fontFamily` strings.
    *   **ALWAYS** use the exact strings defined in `theme.js` (e.g., `SairaSemiCondensed-Regular`).
    *   **NEVER** use generic names like "Bold" or "System".

### 2. The "Undefined Prop" Crash (e.g., bgColor error)
*   **The Issue**: "bgColor not existing" or similar errors in components like `CardItem`.
*   **The Mistake**: Initializing variables with `let color;` and only assigning them inside an `if` block. If the condition was false, `undefined` was passed to a style prop or an SVG, causing a runtime crash.
*   **THE RULE**: 
    *   **NEVER** declare a variable without a default value if it's used in rendering.
    *   **ALWAYS** initialize styles/colors with a fallback (e.g., `let color = '#000';`).
    *   **NEVER** pass `undefined` to an SVG component's `fill` or `stroke` prop.

### 3. The "HTML instead of JSON" Bug (Middleware Redirect)
*   **The Issue**: Mobile login would fail with "Invalid Response".
*   **The Mistake**: The Django backend middleware (e.g., `PermissionValidationMiddleware`) was redirecting mobile API requests to the web login page (HTML) because it didn't recognize the request was from the app.
*   **THE RULE**: 
    *   **ALWAYS** exempt the `/api/mobile/` path in ALL middleware that performs redirects or authentication checks.
    *   **NEVER** allow the backend to return an HTML redirect (302) for an API request.

### 4. The "Domain Drift" Error (Hardcoded URLs)
*   **The Issue**: Moving from staging to production broke the app because some screens still pointed to `localhost` or `panel.adarshbhopal.in`.
*   **The Mistake**: Hardcoding the full URL in `fetch` or `axios` calls.
*   **UI/UX Refinement**:
    *   Corrected a broken import for `ErrorView` in `src/screens/HomeScreen.js`.
    *   Verified alignment with the project's "less rounded" design system (using `radius.sm` and `radius.md` tokens).
    *   Redesigned Home Section with card-based navigation for consistency.
    *   Standardized icon-to-text spacing across all buttons using explicit margins.
    *   Increased font sizes for critical dashboard metrics.
*   **Feature Parity**:
    *   Implemented "User Overview" section on mobile dashboard.
    *   Enhanced API endpoints to provide total client/operator/assistant counts.
*   **THE RULE**: 
    *   **NEVER** write a full URL (https://...) inside a Screen or Component.
    *   **ALWAYS** use relative paths (e.g., `/api/mobile/login/`) and use the centralized `api/client.js` helper.
    *   **ONE SOURCE OF TRUTH**: The only place the domain should exist is `src/api/client.js`.

### 5. The "Icon Reference" Crash
*   **The Issue**: App crashes when a dynamic icon is called but the name is missing or misspelled.
*   **The Mistake**: Calling `Icons[name]` where `name` is null or invalid.
*   **THE RULE**: 
    *   **ALWAYS** use the `DynamicIcon` component or a safe wrapper.
    *   **ALWAYS** provide a fallback icon (e.g., `IconWarning`) if the requested icon is not found.
    *   **NEVER** let an icon component receive `undefined` as its source.

---

## 🛠 Stability Checklist for New Development

Before committing any code, ask yourself:

1.  **Initialization**: Do all my `let` variables have default values?
2.  **Safety**: Did I use optional chaining (`user?.profile?.name`) for all deep objects?
3.  **Styles**: Are all my style objects safe from `NaN` or `undefined`?
4.  **API**: Is my API path relative? Does it start with `/api/mobile/`?
5.  **Fonts**: Am I using the `fontFamily` tokens from `theme.js`?
6.  **Icons**: Does this icon have a fallback if the backend sends an empty string?

---

## 📜 Coding Pattern Standards

### Good ✅ (Safe)
```javascript
const color = theme.primary || '#000'; // Always has a value
const name = user?.name || 'Guest';    // Optional chaining
```

### Bad ❌ (Crash Prone)
```javascript
let color;
if (user.role === 'admin') color = 'red'; // What if user is null? Crash.
const name = user.name;                   // User might be null. Crash.
```

---

> [!IMPORTANT]
> **COMPLIANCE IS MANDATORY.** If a feature is "done" but breaks these rules, it is NOT done. Stability is the #1 priority for Adarsh Mobile.
