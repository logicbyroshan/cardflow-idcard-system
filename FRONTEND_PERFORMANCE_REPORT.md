# Frontend Performance & Network Optimization Report

**Generated:** 2026-02-23  
**Scope:** Templates, static assets, PWA setup, CDN usage, caching configuration

---

## Executive Summary

The project has a **solid foundation** — WhiteNoise with `CompressedManifestStaticFilesStorage` handles content-hashed filenames + gzip/brotli compression on static files, `defer` is used on most scripts, lazy-loading of heavy vendor libraries (XLSX, JSZip, Cropper, Flatpickr) is implemented, and `font-display: swap` is correctly set on all `@font-face` rules. However, there are **significant optimization opportunities** remaining, particularly around the mobile/PWA templates, the website admin section, template duplication, and the idcard-actions page.

### Severity Scale
- 🔴 **Critical** — Measurable user-facing performance degradation
- 🟠 **High** — Significant optimization opportunity
- 🟡 **Medium** — Improvement opportunity
- 🟢 **Low** — Minor polish

---

## 1. Render-Blocking Scripts & CSS

### 🔴 CRITICAL — `mobile_app/base.html` loads Tailwind CSS **via CDN build script** (render-blocking)

**File:** `templates/mobile_app/base.html`, Line 14  
```html
<script src="https://cdn.tailwindcss.com"></script>
```
- This is the **runtime Tailwind JIT compiler** (~110KB), loaded as a **synchronous render-blocking script** in `<head>`.
- It blocks initial paint while it downloads, parses, and compiles CSS.
- **Should never be used in production** — it's intended for prototyping only.
- Also in duplicated file: `PWA/templates/mobile_app/base.html`, Line 14.

**Fix:** Compile Tailwind to a static CSS file (you already have `tailwind.css` for the admin panel). Create a mobile-specific build output and load that instead.

---

### 🔴 CRITICAL — `website/admin/base.html` loads ALL core JS without `defer`

**File:** `templates/website/admin/base.html`, Lines 98-103  
```html
<script src="{% static 'js/core/api.js' %}?v=134"></script>
<script src="{% static 'js/core/toast.js' %}?v=134"></script>
<script src="{% static 'js/core/modal.js' %}?v=134"></script>
<script src="{% static 'js/core/utils.js' %}?v=134"></script>
<script src="{% static 'js/init.js' %}?v=134"></script>
<script src="{% static 'js/global-search.js' %}?v=134"></script>
```
- **6 synchronous render-blocking scripts** (total ~80KB uncompressed).
- Also: `alpine-state.js` (Line 21) is loaded **without `defer`** in this template, while every other page uses `defer`.

**Fix:** Add `defer` to all six scripts, matching the pattern used in `base.html` and all admin pages.

---

### 🟠 HIGH — `website/admin` child pages also load page scripts without `defer`

**Files and lines:**
- `templates/website/admin/reviews.html`, Line 152: `<script src="{% static 'js/website-admin/reviews.js' %}?v=134"></script>`
- `templates/website/admin/reels.html`, Line 121: `<script src="{% static 'js/website-admin/reels.js' %}?v=134"></script>` 
- `templates/website/admin/clients.html`, Line 113: `<script src="{% static 'js/website-admin/clients.js' %}?v=134"></script>`
- `templates/website/admin/portfolio.html`, Line 239: `<script src="{% static 'js/website-admin/portfolio.js' %}?v=134"></script>`

**Fix:** Add `defer` to all.

---

### 🟠 HIGH — Public website pages load scripts without `defer`

**Files:**
- `templates/website/why-choose-us.html`, Line 217: `<script src="{% static 'website/scripts/why-choose-us.js' %}"></script>`
- `templates/website/our-works.html`, Line 318: `<script src="{% static 'website/scripts/our-works.js' %}?v=134"></script>`
- `templates/website/testimonials.html`, Line 243: `<script src="{% static 'website/scripts/testimonials.js' %}"></script>`

**Fix:** Add `defer`.

---

### 🟠 HIGH — `mobile_app/camera.html` loads Cropper.js synchronously

**File:** `templates/mobile_app/camera.html`, Lines 8-9  
```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.js"></script>
```
- Both are render-blocking.

**Fix:** Add `defer` to the script. Consider using the local vendor copy (`/static/js/vendor/cropper.min.js`) for offline PWA support.

---

### 🟡 MEDIUM — CSS on every page: 4 render-blocking stylesheets minimum

Every admin page loads at minimum:
1. `fonts.css` (0.9KB)
2. `tailwind.css` (128KB)
3. `global-search.css` (7.6KB)
4. `vendor/fontawesome/all.min.css` (100KB)

Total: **~237KB of blocking CSS** before first paint. WhiteNoise will gzip these, reducing to ~30-40KB on wire, but they're still 4 separate HTTP requests with potential head-of-line blocking.

**Fix:** Consider:
- Bundling `fonts.css` + `global-search.css` into `tailwind.css` during build (they're tiny).
- Using `font-awesome` subsetting — the full `all.min.css` includes brands, regular, etc. If you only use `fa-solid`, you could load just `solid.min.css` + `fontawesome.min.css` (~30KB instead of 100KB).

---

## 2. Missing Image Optimization

### 🟡 MEDIUM — Sidebar logo missing `loading` / `decoding` attributes

**File:** `templates/partials/sidebar.html`, Line 8  
```html
<img src="{% static 'assets/logo.png' %}" alt="Adarsh ID Cards home" width="26" height="26">
```
- `width` and `height` are correctly set (good for CLS prevention). ✅
- `loading="lazy"` is not needed as this is above the fold. ✅ Correct as-is.
- Missing `decoding="async"` — minor improvement opportunity.

---

### 🟡 MEDIUM — `website/index.html` hero image missing dimensions

**File:** `templates/website/index.html`, Line 37  
```html
<img id="slider-img" src="{{ first_hero.image.url }}" alt="{{ first_hero.title|default:'Hero Slide' }}">
```
- No `width`/`height` attributes — causes **Cumulative Layout Shift (CLS)**.
- No `fetchpriority="high"` — this is the LCP element and should be prioritized.

---

### 🟡 MEDIUM — `website/our-works.html` — some images missing `loading="lazy"`

**File:** `templates/website/our-works.html`, Lines 99, 200  
```html
<img src="{{ reel.thumbnail.url }}" alt="{{ reel.title }}" class="reel-thumbnail">
<img src="{{ item.image.url }}" alt="{{ item.title }}" class="reel-thumbnail">
```
These below-the-fold images lack `loading="lazy"` (while others on Lines 241, 248 correctly have it).

---

## 3. Inline Scripts That Should Be External (for Caching)

### 🔴 CRITICAL — `manage-client.html` has ~1,200 lines of inline JavaScript

**File:** `templates/manage-client.html`, Lines ~830-2035  
This single file contains approximately **1,200 lines of JavaScript** embedded directly in `<script>` tags. This JS code:
- Cannot be cached independently by the browser.
- Is re-downloaded on every page visit (the HTML has `Cache-Control: no-store` for authenticated pages).
- Increases HTML document size dramatically (~80KB of JS in the HTML response).

**Fix:** Extract to `manage-client.js` and load with `defer`. This lets the JS be cached via WhiteNoise's content-hashed filenames with immutable cache headers.

---

### 🟠 HIGH — `idcard-actions.html` has ~70 lines of inline `<style>` for Flatpickr theming

**File:** `templates/idcard-actions.html`, Lines 37-107  
This Flatpickr theme CSS is inline and uncacheable. Should be in a small external CSS file.

---

### 🟡 MEDIUM — `htmx-config.html` has ~100 lines of inline JavaScript + 30 lines of inline CSS

**File:** `templates/partials/htmx-config.html`, Lines 16-130  
This partial is included on every page. The HTMX configuration code (~3KB) is inlined each time, meaning it's re-parsed on every page load and cannot be cached separately.

**Fix:** Extract to `core/htmx-config.js` and load with `defer`.

---

### 🟡 MEDIUM — `sidebar.html` has inline IIFE for flicker prevention

**File:** `templates/partials/sidebar.html`, Lines 131-138  
```html
<script>
(function(){
  var c = localStorage.getItem('sidebarCollapsed');
  if (c === 'true') { ... }
})();
</script>
```
This is **intentionally inline and synchronous** to prevent sidebar flicker before Alpine initializes. This is **acceptable** — keep as-is. ✅

---

## 4. Multiple Separate CSS/JS Files That Should Be Bundled

### 🟠 HIGH — `idcard-actions.html` loads 8+ separate JS files

**File:** `templates/idcard-actions.html` loads in the `<body>`:
- `js/core/api.js` (29KB)
- `js/core/toast.js`
- `js/core/modal.js`
- `js/core/utils.js`
- `js/init.js`
- `js/idcard-actions.js` (17KB)
- `js/idcard-actions-core.js` (22KB)
- `js/idcard-actions-table.js` (53KB)
- `js/idcard-actions-search.js` (29KB)
- `js/idcard-actions-modal.js` (65KB)
- `js/idcard-actions-edit.js` (20KB)
- `js/idcard-actions-upload.js` (45KB)
- `js/idcard-actions-download.js` (46KB)
- `js/idcard-actions-api.js` (29KB)
- `js/global-search.js` (16KB)

That's **15 separate JS requests** totaling **~450KB** uncompressed. On HTTP/1.1, this is a major waterfall problem. Even on HTTP/2, the overhead of 15 requests is significant.

Additionally, vendor libs are loaded eagerly on this page:
- `xlsx.full.min.js` (861KB!)
- `cropper.min.js` (37KB)
- `flatpickr.min.js` (50KB)

Despite the project having a `LazyLoad` module, the idcard-actions page **bypasses it entirely** (Line 29-32):
```html
<script defer src="{% static 'js/vendor/xlsx.full.min.js' %}"></script>
<script defer src="{% static 'js/vendor/cropper.min.js' %}"></script>
<script defer src="{% static 'js/vendor/flatpickr.min.js' %}"></script>
```

**Total JS on idcard-actions page: ~1.4MB uncompressed** (~250KB+ gzipped).

**Fix:**
1. Use the `LazyLoad` module on this page too — load XLSX/Cropper/Flatpickr only when the user actually needs them.
2. Consider bundling the 8 `idcard-actions-*.js` files into a single bundle using a build step.

---

### 🟡 MEDIUM — Core modules loaded as 4 separate files on every page

Every page loads:
- `js/core/api.js` + `js/core/toast.js` + `js/core/modal.js` + `js/core/utils.js` + `js/init.js`

These could be bundled into a single `core.bundle.js` to reduce request count.

---

## 5. Missing Preconnect / Prefetch / Preload Hints

### 🟠 HIGH — `mobile_app/base.html` loads from 4 different CDN origins with NO preconnect

**File:** `templates/mobile_app/base.html`, Lines 14-41  
Origins used:
- `cdn.tailwindcss.com`
- `cdn.jsdelivr.net`
- `cdnjs.cloudflare.com`
- `fonts.googleapis.com` / `fonts.gstatic.com`

**Zero `<link rel="preconnect">` hints.** Each new origin requires DNS lookup + TCP + TLS (~200-500ms).

**Fix:** Add before any CDN resources:
```html
<link rel="preconnect" href="https://cdn.tailwindcss.com">
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link rel="preconnect" href="https://cdnjs.cloudflare.com" crossorigin>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
```

---

### 🟡 MEDIUM — Admin pages have NO preconnect/preload hints

**Files:** `templates/base.html`, `templates/index.html`, etc.

These serve all assets from the same origin (good!), but could benefit from:
```html
<link rel="preload" href="{% static 'css/tailwind.css' %}" as="style">
<link rel="preload" href="{% static 'js/alpine-state.js' %}" as="script">
```
This would allow the browser to start fetching critical resources immediately instead of waiting for the HTML parser to discover them.

---

### 🟢 LOW — `website/admin/base.html` has preconnect for Google Fonts ✅
Line 10-11 correctly sets `<link rel="preconnect">` for Google Fonts. Good pattern.

---

## 6. Large DOM Sizes / Excessive Template Includes

### 🔴 CRITICAL — `manage-client.html` is 2,035 lines

This single template file is **2,035 lines** containing:
- Client table with all CRUD operations
- Add/Edit drawer with full permissions UI (~45 permission toggles)
- View modal
- Delete confirmation modal
- Status change modal
- Client staff drawer with nested staff management
- Toast and temp-password modal
- 1,200+ lines of inline JS
- Client-side search, filter, and pagination logic

This is an extremely large initial DOM. The browser must parse all 2,035 lines before rendering anything.

**Fix:** 
- Extract inline JS to `manage-client.js`
- Lazy-load the client staff drawer content via HTMX when needed
- Consider loading modals on demand

---

### 🟠 HIGH — `index.html` (dashboard) is 496 lines and includes 3 large modals

**File:** `templates/index.html`, Lines 363-496  
Three modals (Delete All, Upgrade All, Reupload) are always in the DOM even though they're rarely used. With Alpine's `x-show` they're hidden but still parsed.

**Fix:** Consider loading these modals via HTMX `hx-get` only when triggered, or use Alpine's `x-if` (which actually removes from DOM) instead of `x-show`.

---

### 🟡 MEDIUM — Template does NOT extend `base.html` (code duplication)

Major pages like `index.html`, `manage-client.html`, `manage-panel.html`, and `manage-staff.html` each have their own **full HTML document** with duplicated `<head>`, sidebar include, topbar, and script loading. Only `manage-staff.html` follows the `{% extends 'base.html' %}` pattern implicitly through shared structure.

Actually, looking more carefully: **none** of `index.html`, `manage-client.html`, or `manage-panel.html` use `{% extends 'base.html' %}`. They all duplicate the full page structure. Meanwhile `base.html` exists with proper `{% block %}` tags.

**Impact:** Any change to head resources, script loading order, or common UI must be replicated across 6+ standalone templates.

**Fix:** Refactor standalone templates to extend `base.html` using `{% extends %}` / `{% block %}` pattern.

---

## 7. Missing Compression Opportunities

### 🟢 Already handled — WhiteNoise `CompressedManifestStaticFilesStorage` ✅

**File:** `config/settings.py`, Line 260  
```python
"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"
```
This automatically generates `.gz` and `.br` (Brotli) compressed versions of all static files during `collectstatic`, and serves them with proper `Content-Encoding` headers. **This is the correct production setup.**

---

### 🟡 MEDIUM — HTML responses are not gzip-compressed

The `MIDDLEWARE` list in `config/settings.py` (Lines 73-96) does **not** include `django.middleware.gzip.GZipMiddleware`. HTML responses (which can be 50-200KB for large pages like `manage-client.html`) are sent uncompressed.

**Note:** If using Nginx as reverse proxy (per `deployment/nginx_example.conf`), Nginx typically handles HTML gzip. But if Django is serving directly (dev or bare gunicorn), HTML is uncompressed.

**Fix:** Either ensure Nginx's `gzip on` covers `text/html`, or add `GZipMiddleware` to Django (though Django docs recommend using the web server for this).

---

## 8. CDN Libraries Without `integrity` / `crossorigin`

### 🔴 CRITICAL — All CDN resources lack Subresource Integrity (SRI)

**File:** `templates/mobile_app/base.html`:
```html
<script src="https://cdn.tailwindcss.com"></script>                           <!-- Line 14 -->
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>  <!-- Line 35 -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">  <!-- Line 38 -->
```

**File:** `templates/website/admin/base.html`:
```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">  <!-- Line 19 -->
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.3/dist/cdn.min.js"></script>  <!-- Line 23 -->
```

**File:** `templates/mobile_app/camera.html`:
```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.css">  <!-- Line 8 -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.js"></script>  <!-- Line 9 -->
```

**None** of these have `integrity` or `crossorigin` attributes. If a CDN is compromised, arbitrary code could execute on your pages.

**Fix:** Add SRI hashes, e.g.:
```html
<script src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.3/dist/cdn.min.js"
        integrity="sha384-XXXXX" crossorigin="anonymous" defer></script>
```

---

### 🟠 HIGH — Alpine.js version pinning is inconsistent

- `mobile_app/base.html` Line 35: `alpinejs@3.x.x` (floating major version! Could break unpredictably)
- `website/admin/base.html` Line 23: `alpinejs@3.14.3` (pinned, correct)
- Admin pages: use local `vendor/alpine.min.js` (best approach)

**Fix:** Pin the mobile_app version and add SRI.

---

## 9. Unused CSS/JS Loaded on Pages That Don't Need Them

### 🟡 MEDIUM — `global-search.css` + `global-search.js` loaded on ALL pages

Every page loads the global search CSS (7.6KB) and JS (15.5KB), even pages that don't render the search UI (e.g., `manage-staff.html` — the topbar has no search button rendered).

---

### 🟡 MEDIUM — `idcard-actions.html` eagerly loads XLSX (861KB)

As noted in §4, the XLSX library is loaded on page load even though most users visiting the idcard-actions page won't use the XLSX export feature. The `LazyLoad` module exists but is not used here.

---

### 🟡 MEDIUM — `notification-bell.js` only loaded on `manage-panel.html`

The notification bell partial (`partials/notification-bell.html`) is only included on `manage-panel.html`, but `notification-bell.js` is only loaded there. This is correct — but worth noting that if the bell is added to other pages, the JS must be added too. A `base.html` approach would handle this automatically.

---

## 10. Missing Cache Headers / Versioning on Static Assets

### 🟢 Already excellent — WhiteNoise content-hashed filenames ✅

`CompressedManifestStaticFilesStorage` generates filenames like `tailwind.abc123.css` with `Cache-Control: max-age=315360000, immutable`. This is best practice.

---

### 🟠 HIGH — `website/admin/base.html` uses manual `?v=134` cache busting

**File:** `templates/website/admin/base.html`, Lines 14-21  
```html
<link rel="stylesheet" href="{% static 'css/tailwind.css' %}?v=134">
<link rel="stylesheet" href="{% static 'css/global-search.css' %}?v=134">
<link rel="stylesheet" href="{% static 'css/website-admin.css' %}?v=134">
<script src="{% static 'js/alpine-state.js' %}?v=134"></script>
```
The `?v=134` query parameter is **redundant** because WhiteNoise already handles versioning via content hashing. Worse, appending `?v=134` may cause WhiteNoise to **not match** the hashed filename, potentially serving the unhashed version without immutable cache headers.

**Fix:** Remove all `?v=134` suffixes. Trust WhiteNoise's manifest.

---

## 11. API Calls That Could Be Batched or Lazy-Loaded

### 🟡 MEDIUM — Dashboard makes ~3 separate API calls on load

**File:** `static/js/dashboard.js`  
The dashboard fetches:
1. Recent client updates (populates `#recentClientUpdatesBody`)
2. Bulk action client list (`#bulkClientSelect`)
3. Stats may already be server-rendered (confirmed: pending_cards etc. are template variables ✅)

The client updates and bulk client list could be combined into a single API endpoint returning both datasets, reducing requests from 2 to 1.

---

### 🟡 MEDIUM — `manage-client.html` renders ALL clients in DOM, then paginates client-side

**File:** `templates/manage-client.html`, Lines 1680-1710  
The pagination is entirely client-side — all rows are in the DOM, and JS shows/hides them. For large client lists (100+), this means:
- Full data is server-rendered into HTML
- DOM is large
- Client-side search scans all rows

The existing HTMX infrastructure could handle server-side pagination (as done in `manage-staff.html`), which would reduce initial HTML size dramatically.

---

## 12. HTML Errors & Anti-Patterns

### 🟡 MEDIUM — `index.html` missing `id="main-content"` for skip link

`base.html` (Line 28) provides an accessibility skip link:
```html
<a href="#main-content" ...>Skip to main content</a>
```
And `base.html` has `<main class="main" id="main-content">` (Line 32). But `index.html` does **not** extend `base.html`, and its `<main>` (Line 29) has `class="main"` but **no** `id="main-content"` — making the skip link non-functional on the dashboard page.

Same issue on `manage-client.html`, `manage-panel.html`.  
`manage-staff.html` also lacks this, but it also lacks the skip link.

---

### 🟡 MEDIUM — Duplicate `id="sidebarToggle"` inconsistency

- `base.html`: No `id` on sidebar toggle button (uses `@click` Alpine binding ✅)
- `index.html`, `manage-client.html`, `manage-panel.html`, `manage-staff.html`: All add `id="sidebarToggle"` to the button

Alpine's `@click="toggleSidebar()"` already handles the click. The `id="sidebarToggle"` is also bound via `alpine-state.js` `bindSidebarToggle()`. This means **two click handlers** could fire on pages with both the Alpine directive and the ID-based binding.

---

### 🟡 MEDIUM — `manage-panel.html` uses inline `onclick` handlers

**File:** `templates/manage-panel.html`, Lines 70, 79, 85  
```html
<button class="panel-tab active" data-tab="notifications" onclick="switchTab('notifications')">
```
Inline event handlers are a maintenance anti-pattern and prevent Content-Security-Policy `script-src` restrictions. The rest of the project uses `addEventListener` or Alpine `@click`.

---

### 🟢 LOW — `Permissions-Policy` blocks camera but PWA needs it

**File:** `core/middleware.py`, Line 524  
```python
'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
```
The mobile app (`templates/mobile_app/camera.html`) uses camera access for photo capture. The security middleware blocks `camera=()`. This may conflict unless the middleware's `SKIP_PREFIXES` also covers mobile app routes (it only skips `/static/` and `/media/`).

**Check:** Verify the mobile camera page still works in production. You may need to add the mobile app path to the skip list or set `camera=(self)`.

---

## Summary Table

| # | Finding | Severity | Impact Area | Effort |
|---|---------|----------|-------------|--------|
| 1 | Tailwind CDN JIT in mobile PWA | 🔴 Critical | Mobile load time | Medium |
| 2 | website/admin scripts missing `defer` | 🔴 Critical | Render blocking | Low |
| 3 | manage-client.html: 1200 lines inline JS | 🔴 Critical | Caching, parse time | Medium |
| 4 | CDN resources without SRI | 🔴 Critical | Security | Low |
| 5 | idcard-actions: 1.4MB JS, bypasses LazyLoad | 🟠 High | Page load time | Medium |
| 6 | No preconnect for mobile CDN origins | 🟠 High | Mobile load time | Low |
| 7 | Manual `?v=134` conflicts with WhiteNoise | 🟠 High | Caching | Low |
| 8 | Templates don't extend base.html | 🟠 High | Maintainability | High |
| 9 | Alpine version `@3.x.x` floating | 🟠 High | Reliability | Low |
| 10 | Public website scripts missing `defer` | 🟠 High | Render blocking | Low |
| 11 | Font Awesome full bundle (100KB) | 🟡 Medium | CSS size | Medium |
| 12 | manage-client client-side pagination | 🟡 Medium | Large DOM, no caching | Medium |
| 13 | Global search loaded on all pages | 🟡 Medium | Unnecessary bytes | Low |
| 14 | htmx-config inline JS (~3KB per page) | 🟡 Medium | Caching | Low |
| 15 | Dashboard API calls not batched | 🟡 Medium | Network requests | Low |
| 16 | Skip link broken on standalone pages | 🟡 Medium | Accessibility | Low |
| 17 | Inline onclick handlers in manage-panel | 🟡 Medium | CSP compatibility | Low |
| 18 | No preload hints on admin pages | 🟡 Medium | Resource discovery | Low |
| 19 | Missing image dimensions (hero) | 🟡 Medium | CLS | Low |

---

## Recommended Priority Actions

1. **Quick wins (< 1 hour):**
   - Add `defer` to all scripts in `website/admin/base.html` and child pages
   - Add `defer` to public website page scripts
   - Remove `?v=134` from website/admin templates
   - Pin Alpine.js version in `mobile_app/base.html`
   - Add `preconnect` hints for CDN origins
   - Add SRI hashes to CDN resources

2. **Medium effort (1-4 hours):**
   - Extract `manage-client.html` inline JS to external file
   - Extract `htmx-config.html` inline JS/CSS to external files
   - Use `LazyLoad` for XLSX/Cropper/Flatpickr on `idcard-actions.html`
   - Add `id="main-content"` to standalone template `<main>` elements

3. **Larger refactors (1-2 days):**
   - Refactor standalone templates to extend `base.html`
   - Compile Tailwind for mobile PWA (eliminate CDN JIT)
   - Bundle core JS modules into `core.bundle.js`
   - Consider Font Awesome subsetting
   - Migrate `manage-client.html` to server-side HTMX pagination
